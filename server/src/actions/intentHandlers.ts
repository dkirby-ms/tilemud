import type { ActionDurabilityService, DurabilityMetadata } from "../services/actionDurabilityService.js";
import type { ActionSequenceService, SequenceEvaluationResult } from "../services/actionSequenceService.js";
import type { PlayerSessionStore } from "../models/playerSession.js";
import type { MetricsService } from "../services/metricsService.js";
import type {
  EventAck,
  EventError,
  EventStateDelta,
  IntentActionPayload,
  IntentChatPayload,
  IntentMovePayload
} from "../contracts/realtimeSchemas.js";
import type { ActionEventRecord, ActionEventType } from "../models/actionEvent.js";
import { TileMudError } from "../models/errorCodes.js";

type WorldSnapshot = NonNullable<EventStateDelta["payload"]["world"]>;
type StateEffect = NonNullable<NonNullable<EventStateDelta["payload"]["effects"]>[number]>;

export interface ChatRateLimitState {
  windowStartMs: number;
  count: number;
}

export interface PlayerIntentAdapter {
  sessionId: string;
  userId: string;
  characterId: string;
  displayName: string;
  getPosition(): { x: number; y: number };
  setPosition(position: { x: number; y: number }): void;
  getStats(): Record<string, unknown>;
  getInventory(): Record<string, unknown>;
  getLastSequence(): number;
  setLastSequence(sequence: number): void;
  getChatWindow(): ChatRateLimitState | null;
  setChatWindow(state: ChatRateLimitState | null): void;
}

export interface IntentProcessingContext<TPayload> {
  player: PlayerIntentAdapter;
  sequence: number;
  payload: TPayload;
  now: Date;
  worldSnapshot?: WorldSnapshot;
  latencyMs?: number;
}

export interface IntentHandlerDependencies {
  sequenceService: ActionSequenceService;
  durabilityService: ActionDurabilityService;
  sessions: PlayerSessionStore;
  metrics?: MetricsService;
}

export type IntentAckPayload = Extract<EventAck["payload"], { status: string }>;
type IntentAckStatus = IntentAckPayload["status"];
type SuccessfulIntentAckStatus = Extract<IntentAckStatus, "applied" | "duplicate">;
export type IntentErrorPayload = EventError["payload"];
export type IntentStateDeltaPayload = EventStateDelta["payload"];

export type IntentProcessingOutcome =
  | {
      kind: "success";
      status: SuccessfulIntentAckStatus;
      ack: IntentAckPayload;
      stateDelta?: IntentStateDeltaPayload;
    }
  | {
      kind: "error";
      error: IntentErrorPayload;
    };

const CHAT_RATE_LIMIT_MAX = 5;
const CHAT_RATE_LIMIT_WINDOW_MS = 10_000;

const MOVE_DIRECTION_DELTAS: Record<string, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 }
};

export class RealtimeIntentProcessor {
  private readonly sequenceService: ActionSequenceService;
  private readonly durabilityService: ActionDurabilityService;
  private readonly sessions: PlayerSessionStore;
  private readonly metrics?: MetricsService;

  constructor(dependencies: IntentHandlerDependencies) {
    this.sequenceService = dependencies.sequenceService;
    this.durabilityService = dependencies.durabilityService;
    this.sessions = dependencies.sessions;
    this.metrics = dependencies.metrics;
  }

  async processMove(context: IntentProcessingContext<IntentMovePayload>): Promise<IntentProcessingOutcome> {
    const evaluation = this.sequenceService.evaluate({
      sessionId: context.player.sessionId,
      sequence: context.sequence
    });

    if (evaluation.status === "accept") {
      const nextPosition = this.computeNextPosition(context.payload.direction, context.payload.magnitude);
      const targetPosition = {
        x: context.player.getPosition().x + nextPosition.x,
        y: context.player.getPosition().y + nextPosition.y
      };

      context.player.setPosition(targetPosition);
      this.onSequenceAcknowledged(context.player, context.sequence);

      const ack = this.createIntentAck("intent.move", context.sequence, "applied", context.now, context.latencyMs);
      const delta = this.createStateDelta(context, {
        includeCharacter: true
      });

      return {
        kind: "success",
        status: "applied",
        ack,
        stateDelta: delta
      } satisfies IntentProcessingOutcome;
    }

    if (evaluation.status === "duplicate") {
      const ack = this.createIntentAck("intent.move", context.sequence, "duplicate", context.now, context.latencyMs);
      return {
        kind: "success",
        status: "duplicate",
        ack
      } satisfies IntentProcessingOutcome;
    }

    return {
      kind: "error",
      error: this.mapSequenceRejection("intent.move", context.sequence, evaluation)
    } satisfies IntentProcessingOutcome;
  }

  async processChat(context: IntentProcessingContext<IntentChatPayload>): Promise<IntentProcessingOutcome> {
    const evaluation = this.sequenceService.evaluate({
      sessionId: context.player.sessionId,
      sequence: context.sequence
    });

    if (evaluation.status === "accept") {
      const rateLimitError = this.enforceChatRateLimit(context.player, context.sequence, context.now);
      if (rateLimitError) {
        return { kind: "error", error: rateLimitError } satisfies IntentProcessingOutcome;
      }

      this.onSequenceAcknowledged(context.player, context.sequence);

      const ack = this.createIntentAck("intent.chat", context.sequence, "applied", context.now, context.latencyMs, {
        message: "chat_delivered"
      });

      return {
        kind: "success",
        status: "applied",
        ack
      } satisfies IntentProcessingOutcome;
    }

    if (evaluation.status === "duplicate") {
      const ack = this.createIntentAck("intent.chat", context.sequence, "duplicate", context.now, context.latencyMs);
      return {
        kind: "success",
        status: "duplicate",
        ack
      } satisfies IntentProcessingOutcome;
    }

    return {
      kind: "error",
      error: this.mapSequenceRejection("intent.chat", context.sequence, evaluation)
    } satisfies IntentProcessingOutcome;
  }

  async processAction(context: IntentProcessingContext<IntentActionPayload>): Promise<IntentProcessingOutcome> {
    const evaluation = this.sequenceService.evaluate({
      sessionId: context.player.sessionId,
      sequence: context.sequence
    });

    if (evaluation.status === "accept") {
      try {
        const normalizedType = normalizeActionKind(context.payload.kind);

        const { metadata } = await this.durabilityService.persistAction({
          sessionId: context.player.sessionId,
          userId: context.player.userId,
          characterId: context.player.characterId,
          sequenceNumber: context.sequence,
          actionType: normalizedType,
          payload: this.normalizeActionPayload(context.payload)
        });

        this.onSequenceAcknowledged(context.player, context.sequence);

        const ack = this.createIntentAck("intent.action", context.sequence, "applied", context.now, context.latencyMs, {
          durability: metadata
        });

        const delta = this.createStateDelta(context, {
          effects: [
            {
              type: context.payload.kind ?? "system",
              actionId: context.payload.actionId,
              target: structuredClone(context.payload.target ?? null),
              metadata: structuredClone(context.payload.metadata ?? {})
            } satisfies StateEffect
          ]
        });

        return {
          kind: "success",
          status: "applied",
          ack,
          stateDelta: delta
        } satisfies IntentProcessingOutcome;
      } catch (error) {
        const parsed = this.mapActionPersistenceError(error, context, context.sequence);
        return { kind: "error", error: parsed } satisfies IntentProcessingOutcome;
      }
    }

    if (evaluation.status === "duplicate") {
      const record = await this.durabilityService.getBySessionAndSequence(
        context.player.sessionId,
        context.sequence
      );

      const durability = record ? mapRecordToDurability(record, true) : undefined;
      const ack = this.createIntentAck("intent.action", context.sequence, "duplicate", context.now, context.latencyMs, {
        durability
      });

      return {
        kind: "success",
        status: "duplicate",
        ack
      } satisfies IntentProcessingOutcome;
    }

    return {
      kind: "error",
      error: this.mapSequenceRejection("intent.action", context.sequence, evaluation)
    } satisfies IntentProcessingOutcome;
  }

  private onSequenceAcknowledged(player: PlayerIntentAdapter, sequence: number): void {
    this.sequenceService.acknowledge({ sessionId: player.sessionId, sequence });
    this.sessions.recordActionSequence(player.sessionId, sequence);
    player.setLastSequence(Math.max(player.getLastSequence(), sequence));
  }

  private createIntentAck(
    intentType: string,
    sequence: number,
    status: SuccessfulIntentAckStatus,
    now: Date,
    latencyMs?: number,
    options: { durability?: DurabilityMetadata; message?: string } = {}
  ): IntentAckPayload {
    const payload: IntentAckPayload = {
      intentType,
      sequence,
      status,
      acknowledgedAt: now.toISOString()
    };

    if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
      payload.latencyMs = Math.max(0, Math.round(latencyMs));
    }

    if (options.durability) {
      const durability = structuredClone(options.durability) as DurabilityMetadata;
      if (status === "duplicate") {
        durability.duplicate = true;
      }
      payload.durability = durability;
    }

    const message = options.message ?? (status === "duplicate" ? "duplicate_acknowledged" : undefined);
    if (message) {
      payload.message = message;
    }

    return payload;
  }

  private createStateDelta(
    context: IntentProcessingContext<unknown>,
    options: {
      includeCharacter?: boolean;
      effects?: StateEffect[];
    }
  ): IntentStateDeltaPayload {
    const delta: IntentStateDeltaPayload = {
      sequence: context.sequence,
      issuedAt: context.now.toISOString()
    };

    if (options.includeCharacter) {
      delta.character = this.createCharacterSnapshot(context.player);
    }

    if (context.worldSnapshot) {
      delta.world = structuredClone(context.worldSnapshot) as WorldSnapshot;
    }

    if (options.effects && options.effects.length > 0) {
      delta.effects = options.effects.map((effect) => structuredClone(effect)) as StateEffect[];
    }

    return delta;
  }

  private createCharacterSnapshot(player: PlayerIntentAdapter) {
    const position = player.getPosition();
    return {
      characterId: player.characterId,
      displayName: player.displayName,
      position: { x: position.x, y: position.y },
      stats: structuredClone(player.getStats()),
      inventory: structuredClone(player.getInventory())
    } satisfies NonNullable<IntentStateDeltaPayload["character"]>;
  }

  private mapSequenceRejection(
    intentType: string,
    sequence: number,
    evaluation: Exclude<SequenceEvaluationResult, { status: "accept" | "duplicate" }>
  ): IntentErrorPayload {
    const category = evaluation.status === "invalid" ? "VALIDATION" : "CONSISTENCY";
    const retryable = evaluation.status === "invalid" ? false : true;

    return {
      intentType,
      sequence,
      code: evaluation.errorCode,
      category,
      retryable,
      message: evaluation.message
    } satisfies IntentErrorPayload;
  }

  private enforceChatRateLimit(
    player: PlayerIntentAdapter,
    sequence: number,
    now: Date
  ): IntentErrorPayload | null {
    const nowMs = now.getTime();
    const window = player.getChatWindow();

    if (!window || nowMs - window.windowStartMs >= CHAT_RATE_LIMIT_WINDOW_MS) {
      player.setChatWindow({ windowStartMs: nowMs, count: 0 });
    }

    const currentWindow = player.getChatWindow();
    if (!currentWindow) {
      return null;
    }

    if (currentWindow.count >= CHAT_RATE_LIMIT_MAX) {
      const elapsed = nowMs - currentWindow.windowStartMs;
      const remainingMs = Math.max(0, CHAT_RATE_LIMIT_WINDOW_MS - elapsed);
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1_000));

      return {
        intentType: "intent.chat",
        sequence,
        code: "CHAT_RATE_LIMIT_EXCEEDED",
        category: "RATE_LIMIT",
        retryable: false,
        message: `Chat rate limit exceeded. Try again in ${retryAfterSeconds} second(s).`
      } satisfies IntentErrorPayload;
    }

    player.setChatWindow({
      windowStartMs: currentWindow.windowStartMs,
      count: currentWindow.count + 1
    });

    return null;
  }

  private computeNextPosition(direction: string, magnitude: number): { x: number; y: number } {
    const normalizedMagnitude = Math.max(1, Math.min(3, Math.floor(magnitude)));
    const delta = MOVE_DIRECTION_DELTAS[direction] ?? MOVE_DIRECTION_DELTAS.north;
    return {
      x: delta.x * normalizedMagnitude,
      y: delta.y * normalizedMagnitude
    };
  }

  private normalizeActionPayload(payload: IntentActionPayload): Record<string, unknown> {
    return {
      actionId: payload.actionId,
      kind: payload.kind ?? "system",
      target: structuredClone(payload.target ?? null),
      metadata: structuredClone(payload.metadata ?? {})
    } satisfies Record<string, unknown>;
  }

  private mapActionPersistenceError(
    error: unknown,
    context: IntentProcessingContext<IntentActionPayload>,
    sequence: number
  ): IntentErrorPayload {
    if (error instanceof TileMudError) {
      return {
        intentType: "intent.action",
        sequence,
        code: error.code,
        category: error.definition.category.toUpperCase() as IntentErrorPayload["category"],
        retryable: true,
        message: error.message
      } satisfies IntentErrorPayload;
    }

    return {
      intentType: "intent.action",
      sequence,
      code: "ACTION_PERSIST_FAILURE",
      category: "SYSTEM",
      retryable: true,
      message: error instanceof Error ? error.message : "Failed to persist action"
    } satisfies IntentErrorPayload;
  }
}

function normalizeActionKind(kind: IntentActionPayload["kind"] | undefined): ActionEventType {
  if (!kind) {
    return "system";
  }

  if (kind === "move" || kind === "chat" || kind === "ability" || kind === "system") {
    return kind;
  }

  return "system";
}

function mapRecordToDurability(record: ActionEventRecord, duplicate = false): DurabilityMetadata {
  return {
    persisted: true,
    actionEventId: record.actionId,
    persistedAt: record.persistedAt.toISOString(),
    duplicate: duplicate || undefined
  } satisfies DurabilityMetadata;
}
