import { Room, type Client } from "colyseus";
import { type ActionRequest, parseActionRequest, isTilePlacementAction } from "../actions/actionRequest.js";
import { ActionHandlerService, type ActionResolution } from "../actions/handlers.js";
import { ActionPipeline } from "../services/actionPipeline.js";
import type { RateLimiterService } from "../services/rateLimiter.js";
import type { SnapshotService, PlayerViewSnapshot } from "../services/snapshotService.js";
import type { OutcomeService } from "../services/outcomeService.js";
import type { MessageService } from "../services/messageService.js";
import type { RuleSetDetail, RuleSetService } from "../services/rulesetService.js";
import { BattleRoomState, PlayerSessionState, createBattleRoomState } from "../state/battleRoomState.js";
import type { ReconnectSession } from "../models/reconnectSession.js";
import { TileMudError } from "../models/errorCodes.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

interface ReconnectServiceLike {
  createSession(input: {
    playerId: string;
    instanceId: string;
    sessionId: string;
    playerState: { lastActionTick: number; initiative: number };
    gracePeriodMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<ReconnectSession>;
  attemptReconnect?: (input: {
    playerId: string;
    instanceId: string;
    newSessionId: string;
    requestId?: string;
  }) => Promise<unknown>;
  removeSession?: (playerId: string, instanceId: string) => Promise<void> | void;
}

interface OutcomeServiceLike {
  recordOutcome: OutcomeService["recordOutcome"];
}

interface MessageServiceLike {
  sendPrivateMessage: MessageService["sendPrivateMessage"];
}

export interface BattleRoomDependencies {
  rateLimiter: RateLimiterService;
  snapshotService: SnapshotService;
  outcomeService: OutcomeServiceLike;
  reconnectService: ReconnectServiceLike;
  messageService: MessageServiceLike;
  ruleSetService: Pick<RuleSetService, "requireRuleSetByVersion">;
  logger?: LoggerLike;
  now?: () => number;
  defaultGracePeriodMs?: number;
}

type NormalizedDependencies = Required<Pick<BattleRoomDependencies, "rateLimiter" | "snapshotService" | "outcomeService" | "reconnectService" | "messageService" | "ruleSetService">> & {
  logger: LoggerLike;
  now: () => number;
  defaultGracePeriodMs: number;
};

export interface BattleRoomMetadata {
  instanceId: string;
  rulesetVersion: string;
  maxPlayers: number;
  createdAt: string;
}

export interface BattleRoomCreateOptions {
  instanceId: string;
  rulesetVersion: string;
  services: BattleRoomDependencies;
  startedAt?: number;
  initialTick?: number;
}

const ACTION_MESSAGE = "action.submit";
const ACTION_QUEUED = "action.queued";
const ACTION_APPLIED = "action.applied";
const ACTION_REJECTED = "action.rejected";
const SNAPSHOT_REQUEST = "snapshot.request";
const SNAPSHOT_UPDATE = "snapshot.update";
const DEFAULT_BATCH_LIMIT = 32;

export class BattleRoom extends Room<BattleRoomState, BattleRoomMetadata> {
  private dependencies!: NormalizedDependencies;
  private ruleSet!: RuleSetDetail;
  private actionHandler!: ActionHandlerService;
  private actionPipeline!: ActionPipeline;
  private readonly clientToPlayer = new Map<string, string>();
  private readonly playerToClient = new Map<string, Client>();
  private processingQueue = false;

  async onCreate(options: BattleRoomCreateOptions): Promise<void> {
    this.dependencies = this.normalizeDependencies(options.services);
    this.ruleSet = await this.dependencies.ruleSetService.requireRuleSetByVersion(options.rulesetVersion);

    this.actionPipeline = new ActionPipeline({ rateLimiter: this.dependencies.rateLimiter });
    this.actionHandler = new ActionHandlerService({
      rulesetService: this.dependencies.ruleSetService,
      now: this.dependencies.now
    });

    const initialState = this.initializeState(options);
    this.setState(initialState);
    this.maxClients = this.ruleSet.metadata.maxPlayers;
    this.autoDispose = true;

    const metadata: BattleRoomMetadata = {
      instanceId: options.instanceId,
      rulesetVersion: options.rulesetVersion,
      maxPlayers: this.ruleSet.metadata.maxPlayers,
      createdAt: new Date(this.dependencies.now()).toISOString()
    };
    await this.setMetadata(metadata);

    this.onMessage(ACTION_MESSAGE, (client, payload) => {
      this.handleActionSubmit(client, payload).catch((error) => {
        this.logError("handleActionSubmit", error);
        this.sendActionRejection(client, {
          actionId: typeof (payload as { id?: string })?.id === "string" ? (payload as { id?: string }).id : undefined,
          reason: "internal",
          message: error instanceof Error ? error.message : "Unexpected error"
        });
      });
    });

    this.onMessage(SNAPSHOT_REQUEST, (client) => {
      try {
        this.sendSnapshot(client);
      } catch (error) {
        this.logError("snapshot.request", error);
      }
    });
  }

  async onJoin(client: Client, options?: { playerId?: string; displayName?: string; initiative?: number; lastActionTick?: number }): Promise<void> {
    const playerId = this.ensurePlayerId(options?.playerId);

    let player = this.state.players.get(playerId);
    if (!player) {
      if (this.state.playerCount >= this.maxClients) {
        throw new TileMudError("INSTANCE_CAPACITY_EXCEEDED", { instanceId: this.state.instanceId });
      }
      player = new PlayerSessionState();
      player.playerId = playerId;
      player.displayName = options?.displayName ?? playerId;
      player.initiative = options?.initiative ?? 0;
      player.lastActionTick = options?.lastActionTick ?? 0;
      player.status = "active";
      player.reconnectDeadline = null;
      this.state.players.set(playerId, player);
    } else {
      player.status = "active";
      player.displayName = options?.displayName ?? player.displayName;
      if (typeof options?.initiative === "number") {
        player.initiative = options.initiative;
      }
      player.reconnectDeadline = null;
      await this.dependencies.reconnectService.removeSession?.(playerId, this.state.instanceId);
    }

    this.clientToPlayer.set(client.sessionId, playerId);
    this.playerToClient.set(playerId, client);
    this.sendSnapshot(client, playerId);
  }

  async onLeave(client: Client, consented?: boolean): Promise<void> {
    const playerId = this.clientToPlayer.get(client.sessionId);
    if (!playerId) {
      return;
    }

    this.clientToPlayer.delete(client.sessionId);
    this.playerToClient.delete(playerId);

    const player = this.state.players.get(playerId);
    if (!player) {
      return;
    }

    if (consented) {
      // Intentional fire-and-forget; no need to await cleanup when user voluntarily leaves
      void this.dependencies.reconnectService.removeSession?.(playerId, this.state.instanceId);
      this.state.players.delete(playerId);
      return;
    }

    player.status = "disconnected";
    const gracePeriodMs = this.dependencies.defaultGracePeriodMs;
  const _now = this.dependencies.now(); // eslint-disable-line @typescript-eslint/no-unused-vars -- retained for future timeout logic

    const session = await this.dependencies.reconnectService.createSession({
      playerId,
      instanceId: this.state.instanceId,
      sessionId: client.sessionId,
      playerState: {
        lastActionTick: player.lastActionTick,
        initiative: player.initiative
      },
      gracePeriodMs
    });

    player.reconnectDeadline = session.disconnectedAt + session.gracePeriodMs;
  }

  async handleActionSubmit(client: Client, rawAction: unknown): Promise<void> {
    let parsed: ActionRequest;
    try {
      parsed = parseActionRequest(rawAction);
    } catch (error) {
      this.sendActionRejection(client, {
        reason: "format",
        message: error instanceof Error ? error.message : "Invalid action format"
      });
      return;
    }

    const playerId = this.clientToPlayer.get(client.sessionId);
    if (!playerId) {
      this.sendActionRejection(client, {
        actionId: parsed.id,
        reason: "state",
        message: "Player not joined"
      });
      return;
    }

    const normalizedAction: ActionRequest = isTilePlacementAction(parsed)
      ? {
          ...parsed,
          instanceId: this.state.instanceId,
          playerId
        }
      : {
          ...parsed,
          instanceId: this.state.instanceId
        };

    let enqueueResult;
    try {
      enqueueResult = await this.actionPipeline.enqueue(normalizedAction);
    } catch (error) {
      this.sendActionRejection(client, {
        actionId: normalizedAction.id,
        reason: "rate_limit",
        message: error instanceof Error ? error.message : "Rate limit"
      });
      return;
    }

    if (!enqueueResult.accepted) {
      this.sendActionRejection(client, {
        actionId: normalizedAction.id,
        reason: enqueueResult.reason ?? "unknown",
        message: "Action was not accepted"
      });
      return;
    }

    this.state.enqueueAction(normalizedAction);
    client.send(ACTION_QUEUED, {
      actionId: normalizedAction.id,
      rateLimit: enqueueResult.rateLimit ?? null
    });

    await this.processActionQueue();
  }

  private async processActionQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }
    this.processingQueue = true;

    try {
      // Drain all queued actions
      while (!this.actionPipeline.isEmpty) {
        const batch = this.actionPipeline.drainBatch(DEFAULT_BATCH_LIMIT);
        if (batch.length === 0) {
          break;
        }

        for (const entry of batch) {
          const resolution = await this.actionHandler.handle(entry.action, { state: this.state });
          this.removePendingAction(entry.action.id);
          this.notifyResolution(resolution);
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private notifyResolution(resolution: ActionResolution): void {
    if (resolution.status === "applied") {
      this.broadcast(ACTION_APPLIED, {
        actionId: resolution.action.id,
        tick: resolution.tick,
        effects: resolution.effects,
        requestId: resolution.requestId ?? null
      });
      return;
    }

    const errorPayload = this.serializeError(resolution.error);
    const actorPlayerId = isTilePlacementAction(resolution.action) ? resolution.action.playerId : undefined;
    const client = actorPlayerId ? this.playerToClient.get(actorPlayerId) : undefined;
    if (client) {
      client.send(ACTION_REJECTED, {
        actionId: resolution.action.id,
        reason: resolution.reason,
        error: errorPayload,
        requestId: resolution.requestId ?? null
      });
    } else {
      this.broadcast(ACTION_REJECTED, {
        actionId: resolution.action.id,
        reason: resolution.reason,
        error: errorPayload,
        requestId: resolution.requestId ?? null
      });
    }
  }

  private sendSnapshot(client: Client, playerId?: string): void {
    const targetPlayer = playerId ?? this.clientToPlayer.get(client.sessionId);
    if (!targetPlayer) {
      return;
    }

    const snapshot = this.dependencies.snapshotService.createSnapshot(this.state);
    let playerView: PlayerViewSnapshot;
    try {
      playerView = this.dependencies.snapshotService.extractPlayerView(snapshot, targetPlayer);
    } catch (error) {
      this.logError("extractPlayerView", error);
      return;
    }

    client.send(SNAPSHOT_UPDATE, playerView);
  }

  private initializeState(options: BattleRoomCreateOptions): BattleRoomState {
    const boardConfig = this.ruleSet.metadata.board;
    const state = createBattleRoomState({
      instanceId: options.instanceId,
      rulesetVersion: options.rulesetVersion,
      board: {
        width: boardConfig.width,
        height: boardConfig.height
      },
      startedAt: options.startedAt ?? this.dependencies.now(),
      initialTick: options.initialTick ?? 0
    });

    for (const tile of boardConfig.initialTiles) {
      try {
        state.board.applyTilePlacement({ x: tile.x, y: tile.y }, tile.tileType, state.tick, "system");
      } catch (error) {
        this.logError("initialTilePlacement", error);
      }
    }

    return state;
  }

  private normalizeDependencies(deps: BattleRoomDependencies): NormalizedDependencies {
    return {
      rateLimiter: deps.rateLimiter,
      snapshotService: deps.snapshotService,
      outcomeService: deps.outcomeService,
      reconnectService: deps.reconnectService,
      messageService: deps.messageService,
      ruleSetService: deps.ruleSetService,
      logger: deps.logger ?? console,
      now: deps.now ?? (() => Date.now()),
      defaultGracePeriodMs: deps.defaultGracePeriodMs ?? 60_000
    };
  }

  private ensurePlayerId(playerId?: string): string {
    if (!playerId || typeof playerId !== "string" || playerId.trim().length === 0) {
      throw new TileMudError("INVALID_TILE_PLACEMENT", { reason: "missing_player_id" });
    }
    return playerId;
  }

  private removePendingAction(actionId: string): void {
    const pending = this.state.pendingActions;
    const index = pending.findIndex((entry) => entry.actionId === actionId);
    if (index >= 0) {
      pending.splice(index, 1);
    }
  }

  private serializeError(error: unknown): { code?: string; message: string; details?: unknown } {
    if (error instanceof TileMudError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details
      };
    }
    return {
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }

  private sendActionRejection(client: Client, payload: { actionId?: string; reason: unknown; message: string }): void {
    client.send(ACTION_REJECTED, {
      actionId: payload.actionId ?? null,
      reason: payload.reason,
      error: { message: payload.message }
    });
  }

  private logError(scope: string, error: unknown): void {
    this.dependencies.logger.error?.(scope, error);
  }
}
