import { Room, type Client } from "colyseus";
import { MapSchema, Schema, defineTypes } from "@colyseus/schema";
import { z } from "zod";
import type { PlayerSessionStore } from "../models/playerSession.js";
import type { CharacterProfile, CharacterProfileRepository } from "../models/characterProfile.js";
import type { MetricsService } from "../services/metricsService.js";
import type { RateLimiterService } from "../services/rateLimiter.js";
import type { ActionSequenceService } from "../services/actionSequenceService.js";
import type { ActionDurabilityService } from "../services/actionDurabilityService.js";
import type { ReconnectService } from "../services/reconnectService.js";
import type { ReconnectTokenStore } from "../models/reconnectToken.js";
import type { DegradedSignalService } from "../services/degradedSignalService.js";
import {
  RealtimeIntentProcessor,
  type ChatRateLimitState,
  type IntentProcessingContext,
  type IntentProcessingOutcome,
  type PlayerIntentAdapter
} from "../actions/intentHandlers.js";
import {
  realtimeIntentSchemas,
  type IntentActionPayload,
  type IntentChatPayload,
  type IntentMovePayload,
  type EventStateDelta
} from "../contracts/realtimeSchemas.js";
import { VersionMismatchGuard, type VersionMismatchGuardResult } from "./versionMismatchGuard.js";
import { DegradedEmitter } from "./degradedEmitter.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

const joinPayloadSchema = z
  .object({
    sessionId: z.string().min(1, "sessionId_required"),
    userId: z.string().min(1, "userId_required"),
    reconnectToken: z.string().optional().nullable(),
    clientVersion: z.string().min(1).optional(),
    lastSequenceNumber: z.number().int().nonnegative().optional()
  })
  .strict();

interface ConnectedPlayer {
  clientId: string;
  sessionId: string;
  userId: string;
  characterId: string;
  profile: CharacterProfile;
  lastSequence: number;
  joinedAt: Date;
  lastIntentAt: Date;
  chatWindow: ChatRateLimitState | null;
}

class GameRoomPlayerState extends Schema {
  public sessionId!: string;
  public userId!: string;
  public characterId!: string;
}

defineTypes(GameRoomPlayerState, {
  sessionId: "string",
  userId: "string",
  characterId: "string"
});

class GameRoomState extends Schema {
  declare players: MapSchema<GameRoomPlayerState>;

  constructor() {
    super();
    this.players = new MapSchema<GameRoomPlayerState>();
  }
}

defineTypes(GameRoomState, {
  players: { map: GameRoomPlayerState }
});

export interface GameRoomDependencies {
  sessions: PlayerSessionStore;
  characterProfiles: CharacterProfileRepository;
  metrics: MetricsService;
  versionService: import("../services/versionService.js").VersionService;
  sequenceService: ActionSequenceService;
  durabilityService: ActionDurabilityService;
  rateLimiter?: RateLimiterService;
  reconnectService?: ReconnectService;
  reconnectTokens?: ReconnectTokenStore;
  degradedSignalService?: DegradedSignalService;
  now?: () => Date;
  logger?: LoggerLike;
  versionGuard?: VersionMismatchGuard;
}

export interface GameRoomOptions {
  services: GameRoomDependencies;
}

type NormalizedGameRoomDependencies = GameRoomDependencies &
  Required<Pick<GameRoomDependencies, "logger">> & {
    now: () => Date;
    versionGuard: VersionMismatchGuard;
  };

export class GameRoom extends Room<GameRoomState> {
  private readonly stateDeltaChannel = "event.state_delta" as const;
  private dependencies!: NormalizedGameRoomDependencies;
  private readonly players = new Map<string, ConnectedPlayer>();
  private intentProcessor!: RealtimeIntentProcessor;
  private versionGuard!: VersionMismatchGuard;
  private degradedEmitter?: DegradedEmitter;

  async onCreate(options: GameRoomOptions): Promise<void> {
    this.dependencies = normalizeGameRoomDependencies(options.services);
    this.versionGuard = this.dependencies.versionGuard;
    this.intentProcessor = new RealtimeIntentProcessor({
      sequenceService: this.dependencies.sequenceService,
      durabilityService: this.dependencies.durabilityService,
      sessions: this.dependencies.sessions,
      metrics: this.dependencies.metrics
    });

    if (this.dependencies.degradedSignalService) {
      this.degradedEmitter = new DegradedEmitter({
        service: this.dependencies.degradedSignalService,
        room: this,
        logger: this.dependencies.logger,
        now: this.dependencies.now
      });
      this.degradedEmitter.start();
    }

    this.setState(new GameRoomState());
    this.maxClients = 120;
    this.autoDispose = false;
    this.registerIntentHandlers();
  }

  async onJoin(client: Client, rawJoinPayload: unknown): Promise<void> {
    const joinPayload = this.parseJoinPayload(rawJoinPayload);
    const now = this.dependencies.now();

    this.dependencies.metrics.recordConnectAttempt();

    const session = this.dependencies.sessions.get(joinPayload.sessionId);
    if (!session) {
      await this.handleJoinFailure(client, "SESSION_NOT_FOUND", "Session not found for realtime join", "AUTH");
      return;
    }

    if (session.userId !== joinPayload.userId) {
      await this.handleJoinFailure(client, "SESSION_USER_MISMATCH", "Session user mismatch", "AUTH");
      return;
    }

    const baselineSession = this.dependencies.sessions.recordHeartbeat(session.sessionId, now) ?? session;
    this.dependencies.sessions.setStatus(baselineSession.sessionId, "active");

    const versionResult = this.versionGuard.check(joinPayload.clientVersion ?? session.protocolVersion, {
      sessionId: baselineSession.sessionId,
      userId: baselineSession.userId,
      clientId: client.sessionId
    });
    if (!versionResult.compatible) {
      await this.handleVersionMismatch(client, versionResult);
      return;
    }

    const profile = await this.ensureCharacterProfile(baselineSession.characterId, baselineSession.userId);
    const handshakeSequence = baselineSession.lastSequenceNumber ?? 0;
    const handshakeAck = this.createHandshakeAckPayload(baselineSession.sessionId, handshakeSequence, now);
    const stateDelta = this.createInitialStateDelta(profile, handshakeSequence, now);

    client.send("event.ack", handshakeAck);
    client.send("event.state_delta", stateDelta);

    const connected: ConnectedPlayer = {
      clientId: client.sessionId,
      sessionId: baselineSession.sessionId,
      userId: baselineSession.userId,
      characterId: baselineSession.characterId,
      profile,
      lastSequence: handshakeSequence,
      joinedAt: now,
      lastIntentAt: now,
      chatWindow: null
    } satisfies ConnectedPlayer;

    this.players.set(client.sessionId, connected);
    this.state.players.set(baselineSession.sessionId, this.createPlayerState(connected));

    this.dependencies.metrics.recordConnectSuccess();
    this.dependencies.metrics.setActiveSessions(this.players.size);
    this.dependencies.logger.debug?.("game_room.handshake.complete", {
      sessionId: baselineSession.sessionId,
      userId: baselineSession.userId,
      clientId: client.sessionId
    });

    this.degradedEmitter?.emitSnapshot(client);
  }

  async onLeave(client: Client): Promise<void> {
    const player = this.players.get(client.sessionId);
    if (player) {
      this.players.delete(client.sessionId);
      this.state.players.delete(player.sessionId);
      this.dependencies.sessions.setStatus(player.sessionId, "terminating");
      this.dependencies.logger.debug?.("game_room.leave", {
        sessionId: player.sessionId,
        userId: player.userId,
        clientId: client.sessionId
      });
    }

    this.dependencies.metrics.setActiveSessions(this.players.size);
  }

  private registerIntentHandlers(): void {
    this.onMessage("intent.move", (client, payload) => {
      void this.handleIntent(client, "intent.move", payload);
    });

    this.onMessage("intent.chat", (client, payload) => {
      void this.handleIntent(client, "intent.chat", payload);
    });

    this.onMessage("intent.action", (client, payload) => {
      void this.handleIntent(client, "intent.action", payload);
    });
  }

  private async handleIntent(
    client: Client,
    intentType: "intent.move" | "intent.chat" | "intent.action",
    rawPayload: unknown
  ): Promise<void> {
    const player = this.players.get(client.sessionId);
    if (!player) {
      const sequence = this.extractSequenceFromPayload(rawPayload);
      this.dependencies.logger.warn?.("game_room.intent.unknown_player", {
        intentType,
        clientId: client.sessionId,
        sequence
      });
      this.sendSystemError(client, intentType, sequence, new Error("PLAYER_NOT_CONNECTED"));
      return;
    }

    const schema = realtimeIntentSchemas[intentType];
    const parsedResult = schema.safeParse(rawPayload);
    if (!parsedResult.success) {
      const sequence = this.extractSequenceFromPayload(rawPayload);
      this.dependencies.logger.warn?.("game_room.intent.invalid_payload", {
        intentType,
        sessionId: player.sessionId,
        sequence,
        issues: parsedResult.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      });
      this.sendValidationError(client, intentType, sequence, parsedResult.error);
      player.lastIntentAt = this.dependencies.now();
      return;
    }

    const payload = parsedResult.data;
    const now = this.dependencies.now();
    const latencyMs = this.computeLatency(player, now);
    const adapter = this.createIntentAdapter(player);
    const worldSnapshot = this.buildWorldSnapshot();

    let outcome: IntentProcessingOutcome;
    try {
      switch (intentType) {
        case "intent.move": {
          const context: IntentProcessingContext<IntentMovePayload> = {
            player: adapter,
            sequence: payload.sequence,
            payload: payload as IntentMovePayload,
            now,
            worldSnapshot,
            latencyMs
          } satisfies IntentProcessingContext<IntentMovePayload>;
          outcome = await this.intentProcessor.processMove(context);
          break;
        }
        case "intent.chat": {
          const context: IntentProcessingContext<IntentChatPayload> = {
            player: adapter,
            sequence: payload.sequence,
            payload: payload as IntentChatPayload,
            now,
            worldSnapshot,
            latencyMs
          } satisfies IntentProcessingContext<IntentChatPayload>;
          outcome = await this.intentProcessor.processChat(context);
          break;
        }
        case "intent.action": {
          const context: IntentProcessingContext<IntentActionPayload> = {
            player: adapter,
            sequence: payload.sequence,
            payload: payload as IntentActionPayload,
            now,
            worldSnapshot,
            latencyMs
          } satisfies IntentProcessingContext<IntentActionPayload>;
          outcome = await this.intentProcessor.processAction(context);
          break;
        }
        default: {
          this.dependencies.logger.warn?.("game_room.intent.unhandled", {
            intentType,
            sessionId: player.sessionId
          });
          return;
        }
      }
    } catch (error) {
      this.dependencies.logger.error?.("game_room.intent.processing_failed", {
        intentType,
        sessionId: player.sessionId,
        sequence: payload.sequence,
        error: error instanceof Error ? error.message : String(error)
      });
      this.sendSystemError(client, intentType, payload.sequence, error);
      player.lastIntentAt = now;
      return;
    }

    player.lastIntentAt = now;
    this.dependencies.sessions.recordHeartbeat(player.sessionId, now);
    this.emitIntentOutcome(client, player, intentType, payload.sequence, outcome);
  }

  private createIntentAdapter(player: ConnectedPlayer): PlayerIntentAdapter {
    return {
      sessionId: player.sessionId,
      userId: player.userId,
      characterId: player.characterId,
      displayName: player.profile.displayName,
      getPosition: () => ({
        x: player.profile.positionX,
        y: player.profile.positionY
      }),
      setPosition: (position) => {
        player.profile.positionX = position.x;
        player.profile.positionY = position.y;
      },
      getStats: () => structuredClone(player.profile.stats ?? {}),
      getInventory: () => structuredClone(player.profile.inventory ?? {}),
      getLastSequence: () => player.lastSequence,
      setLastSequence: (sequence) => {
        player.lastSequence = Math.max(player.lastSequence, sequence);
      },
      getChatWindow: () => (player.chatWindow ? structuredClone(player.chatWindow) : null),
      setChatWindow: (state) => {
        player.chatWindow = state ? { ...state } : null;
      }
    } satisfies PlayerIntentAdapter;
  }

  private emitIntentOutcome(
    client: Client,
    player: ConnectedPlayer,
    intentType: string,
    sequence: number,
    outcome: IntentProcessingOutcome
  ): void {
    if (outcome.kind === "success") {
      client.send("event.ack", outcome.ack);
      if (outcome.stateDelta) {
        client.send("event.state_delta", outcome.stateDelta);
        this.broadcastStateDelta(client, player, outcome.stateDelta);
      }

      const latencyMs = outcome.ack.latencyMs;
      if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
        this.dependencies.metrics.observeActionLatency(latencyMs);
      }

      this.dependencies.logger.debug?.("game_room.intent.applied", {
        intentType,
        sessionId: player.sessionId,
        sequence,
        status: outcome.status
      });

      return;
    }

    client.send("event.error", outcome.error);
    this.dependencies.logger.warn?.("game_room.intent.error", {
      intentType,
      sessionId: player.sessionId,
      sequence,
      code: outcome.error.code,
      category: outcome.error.category
    });
  }

  private broadcastStateDelta(originClient: Client, originPlayer: ConnectedPlayer, delta: EventStateDelta["payload"]): void {
    if (!this.clients?.length) {
      return;
    }

    for (const client of this.clients) {
      if (client.sessionId === originClient.sessionId) {
        continue;
      }

      client.send(this.stateDeltaChannel, structuredClone(delta));
    }

    this.dependencies.logger.debug?.("game_room.state_delta.broadcast", {
      originSessionId: originPlayer.sessionId,
      sequence: delta.sequence,
      recipients: this.clients.length - 1
    });
  }

  private sendValidationError(
    client: Client,
    intentType: string,
    sequence: number | undefined,
    error: z.ZodError
  ): void {
    const message = error.issues
      .map((issue) => `${issue.path.length ? issue.path.join(".") : intentType}: ${issue.message}`)
      .join("; ")
      .slice(0, 512);

    client.send("event.error", {
      intentType,
      sequence,
      code: "INTENT_PAYLOAD_INVALID",
      category: "VALIDATION",
      retryable: false,
      message: message || "Invalid intent payload"
    });
  }

  private sendSystemError(
    client: Client,
    intentType: string,
    sequence: number | undefined,
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : "Unexpected error while processing intent";
    client.send("event.error", {
      intentType,
      sequence,
      code: "INTENT_PROCESSING_FAILED",
      category: "SYSTEM",
      retryable: true,
      message
    });
  }

  private computeLatency(player: ConnectedPlayer, now: Date): number | undefined {
    if (!player.lastIntentAt) {
      return undefined;
    }

    const delta = now.getTime() - player.lastIntentAt.getTime();
    return Number.isFinite(delta) && delta >= 0 ? delta : undefined;
  }

  private extractSequenceFromPayload(rawPayload: unknown): number | undefined {
    if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
      const candidate = (rawPayload as { sequence?: unknown }).sequence;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private parseJoinPayload(raw: unknown) {
    try {
      return joinPayloadSchema.parse(raw);
    } catch (error) {
      this.dependencies.logger.warn?.("game_room.join_payload_invalid", { error });
      throw error;
    }
  }

  async onDispose(): Promise<void> {
    this.degradedEmitter?.stop();
  }

  private async handleJoinFailure(
    client: Client,
    code: string,
    message: string,
    category: "AUTH" | "SYSTEM" | "VALIDATION"
  ) {
    this.dependencies.logger.warn?.("game_room.join_failed", {
      clientId: client.sessionId,
      code,
      message,
      category
    });

    client.send("event.error", {
      intentType: undefined,
      sequence: undefined,
      code,
      category,
      retryable: false,
      message
    });

    try {
      await Promise.resolve(client.leave(4_401, message));
    } catch {
      // Intentionally swallow errors while disconnecting during handshake failures.
    }
  }

  private async handleVersionMismatch(client: Client, result: VersionMismatchGuardResult): Promise<void> {
    const { compatibility, eventPayload, disconnectCode = 4_408, disconnectReason = "version_mismatch" } = result;

    this.dependencies.logger.warn?.("game_room.version_mismatch", {
      clientId: client.sessionId,
      expectedVersion: compatibility.expectedVersion,
      receivedVersion: compatibility.receivedVersion,
      reason: compatibility.reason
    });

    setTimeout(() => {
      client.send("event.version_mismatch", eventPayload ?? {
        expectedVersion: compatibility.expectedVersion,
        receivedVersion: compatibility.receivedVersion ?? "unknown",
        message: compatibility.message
      });
    }, 0);

    setTimeout(() => {
      void Promise.resolve(client.leave(disconnectCode, disconnectReason)).catch(() => undefined);
    }, 50);
  }

  private createHandshakeAckPayload(sessionId: string, sequence: number, timestamp: Date) {
    return {
      reason: "handshake" as const,
      sessionId,
      sequence,
      version: this.dependencies.versionService.getVersionInfo().version,
      acknowledgedIntents: [],
      acknowledgedAt: timestamp.toISOString()
    };
  }

  private createInitialStateDelta(profile: CharacterProfile, sequence: number, timestamp: Date) {
    return {
      sequence,
      issuedAt: timestamp.toISOString(),
      character: {
        characterId: profile.characterId,
        displayName: profile.displayName,
        position: {
          x: profile.positionX,
          y: profile.positionY
        },
        stats: profile.stats ?? {},
        inventory: profile.inventory ?? {}
      },
      world: this.buildWorldSnapshot()
    };
  }

  private buildWorldSnapshot() {
    return {
      tiles: [] as Record<string, unknown>[]
    };
  }

  private createPlayerState(player: ConnectedPlayer): GameRoomPlayerState {
    const state = new GameRoomPlayerState();
    state.sessionId = player.sessionId;
    state.userId = player.userId;
    state.characterId = player.characterId;
    return state;
  }

  private async ensureCharacterProfile(characterId: string, userId: string): Promise<CharacterProfile> {
    const existing = await this.dependencies.characterProfiles.getProfile(characterId, userId);
    if (existing) {
      return existing;
    }

    const fallback = {
      characterId,
      userId,
      displayName: `Adventurer-${userId.slice(0, 8)}`,
      positionX: 0,
      positionY: 0,
      health: 100,
      inventory: {},
      stats: {}
    };

    return this.dependencies.characterProfiles.createProfile(fallback);
  }
}

function normalizeGameRoomDependencies(dependencies: GameRoomDependencies): NormalizedGameRoomDependencies {
  if (!dependencies) {
    throw new Error("Game room dependencies are required");
  }

  if (!dependencies.sessions) {
    throw new Error("Game room dependency \"sessions\" is required");
  }

  if (!dependencies.characterProfiles) {
    throw new Error("Game room dependency \"characterProfiles\" is required");
  }

  if (!dependencies.metrics) {
    throw new Error("Game room dependency \"metrics\" is required");
  }

  if (!dependencies.sequenceService) {
    throw new Error("Game room dependency \"sequenceService\" is required");
  }

  if (!dependencies.durabilityService) {
    throw new Error("Game room dependency \"durabilityService\" is required");
  }

  if (!dependencies.versionService) {
    throw new Error("Game room dependency \"versionService\" is required");
  }

  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const versionGuard = dependencies.versionGuard ??
    new VersionMismatchGuard({
      versionService: dependencies.versionService,
      metrics: dependencies.metrics,
      now,
      logger
    });

  return {
    ...dependencies,
    logger,
    now,
    versionGuard
  } satisfies NormalizedGameRoomDependencies;
}
