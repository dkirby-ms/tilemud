import type { RedisClientType } from "redis";
import {
  type PlayerReconnectState,
  type ReconnectSession,
  type ReconnectResult
} from "../models/reconnectSession.js";
import { TileMudError } from "../models/errorCodes.js";
import type { PlayerSessionState, PlayerSessionStore } from "../models/playerSession.js";
import type { ReconnectToken, ReconnectTokenStore } from "../models/reconnectToken.js";
import type { CharacterProfile, CharacterProfileRepository } from "../models/characterProfile.js";
import type { ActionDurabilityService } from "./actionDurabilityService.js";
import type { ActionEventRecord, ActionEventType } from "../models/actionEvent.js";
import type { MetricsService } from "./metricsService.js";
import { getAppLogger, type AppLogger } from "../logging/logger.js";

export interface ReconnectServiceDependencies {
  redis: RedisClientType;
  defaultGracePeriodMs?: number;
  keyPrefix?: string;
  clock?: () => number;
  metrics?: MetricsService;
  logger?: AppLogger;
}

export interface CreateReconnectSessionInput {
  playerId: string;
  instanceId: string;
  sessionId: string;
  playerState: PlayerReconnectState;
  gracePeriodMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AttemptReconnectInput {
  playerId: string;
  instanceId: string;
  newSessionId: string;
  requestId?: string;
}

export interface UpdatePlayerStateInput {
  playerId: string;
  instanceId: string;
  patch: Partial<PlayerReconnectState>;
}

export interface ExtendGracePeriodInput {
  playerId: string;
  instanceId: string;
  additionalMs: number;
}

export interface SessionStats {
  totalActive: number;
  byInstance: Record<string, number>;
  oldestDisconnectionMs: number;
  averageGracePeriodMs: number;
}

interface PlayerSessionMapping {
  instanceId: string;
  sessionId: string;
}

function isReconnectSession(value: unknown): value is ReconnectSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as ReconnectSession;
  return (
    typeof session.playerId === "string" &&
    typeof session.instanceId === "string" &&
    typeof session.sessionId === "string" &&
    typeof session.disconnectedAt === "number" &&
    typeof session.gracePeriodMs === "number"
  );
}

export class ReconnectService {
  private readonly redis: RedisClientType;
  private readonly defaultGracePeriodMs: number;
  private readonly clock: () => number;
  private readonly basePrefix: string;
  private readonly sessionKeyPrefix: string;
  private readonly playerKeyPrefix: string;
  private readonly metrics?: MetricsService;
  private readonly logger: AppLogger;

  constructor(dependencies: ReconnectServiceDependencies) {
    this.redis = dependencies.redis;
    this.defaultGracePeriodMs = dependencies.defaultGracePeriodMs ?? 60_000;
    this.clock = dependencies.clock ?? (() => Date.now());

    this.basePrefix = dependencies.keyPrefix ?? "reconnect:";
    this.sessionKeyPrefix = `${this.basePrefix}session:`;
    this.playerKeyPrefix = `${this.basePrefix}player:`;
    this.metrics = dependencies.metrics;
    const rootLogger = dependencies.logger ?? getAppLogger();
    this.logger = rootLogger.child?.({ module: "reconnectService" }) ?? rootLogger;
  }

  async createSession(input: CreateReconnectSessionInput): Promise<ReconnectSession> {
    const now = this.now();
    const gracePeriodMs = input.gracePeriodMs ?? this.defaultGracePeriodMs;

    const session: ReconnectSession = {
      playerId: input.playerId,
      instanceId: input.instanceId,
      sessionId: input.sessionId,
      disconnectedAt: now,
      gracePeriodMs,
      playerState: input.playerState,
      metadata: input.metadata
    };

    await this.persistSession(session, gracePeriodMs);

    this.logger.info?.("reconnect.session.created", {
      playerId: input.playerId,
      instanceId: input.instanceId,
      sessionId: input.sessionId,
      gracePeriodMs
    });

    return session;
  }

  async getSession(playerId: string, instanceId: string): Promise<ReconnectSession | null> {
    const sessionKey = this.buildSessionKey(playerId, instanceId);
    const raw = await this.redis.get(sessionKey);

    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as ReconnectSession;
    } catch {
      await this.removeSession(playerId, instanceId);
      return null;
    }

    if (!isReconnectSession(parsed)) {
      await this.removeSession(playerId, instanceId);
      return null;
    }

    const session = parsed;
    if (this.isExpired(session)) {
      await this.removeSession(playerId, instanceId);
      return null;
    }

    return session;
  }

  async attemptReconnect(input: AttemptReconnectInput): Promise<ReconnectResult> {
    this.metrics?.recordReconnectAttempt();
    this.logger.info?.("reconnect.attempt", {
      playerId: input.playerId,
      instanceId: input.instanceId,
      newSessionId: input.newSessionId,
      requestId: input.requestId
    });

    const session = await this.getSession(input.playerId, input.instanceId);

    if (!session) {
      this.logger.warn?.("reconnect.attempt.expired", {
        playerId: input.playerId,
        instanceId: input.instanceId,
        requestId: input.requestId
      });
      throw new TileMudError(
        "GRACE_PERIOD_EXPIRED",
        { playerId: input.playerId, instanceId: input.instanceId },
        input.requestId
      );
    }

    if (this.isExpired(session)) {
      await this.removeSession(input.playerId, input.instanceId);
      this.logger.warn?.("reconnect.attempt.expired_after_fetch", {
        playerId: input.playerId,
        instanceId: input.instanceId,
        requestId: input.requestId
      });
      throw new TileMudError(
        "GRACE_PERIOD_EXPIRED",
        { playerId: input.playerId, instanceId: input.instanceId },
        input.requestId
      );
    }

    session.sessionId = input.newSessionId;
    const remainingMs = this.getRemainingMs(session);
    await this.persistSession(session, remainingMs);

    this.metrics?.recordReconnectSuccess();
    this.logger.info?.("reconnect.attempt.success", {
      playerId: input.playerId,
      instanceId: input.instanceId,
      newSessionId: input.newSessionId,
      requestId: input.requestId,
      remainingMs
    });

    return { success: true, session };
  }

  async updatePlayerState(input: UpdatePlayerStateInput): Promise<boolean> {
    const session = await this.getSession(input.playerId, input.instanceId);
    if (!session) {
      return false;
    }

    session.playerState = { ...session.playerState, ...input.patch };
    const remainingMs = this.getRemainingMs(session);
    if (remainingMs <= 0) {
      await this.removeSession(input.playerId, input.instanceId);
      return false;
    }

    await this.persistSession(session, remainingMs, false);
    return true;
  }

  async extendGracePeriod(input: ExtendGracePeriodInput): Promise<boolean> {
    const session = await this.getSession(input.playerId, input.instanceId);
    if (!session) {
      return false;
    }

    session.gracePeriodMs += Math.max(0, input.additionalMs);
    const remainingMs = this.getRemainingMs(session);
    await this.persistSession(session, remainingMs);
    return true;
  }

  async removeSession(playerId: string, instanceId: string): Promise<void> {
    const sessionKey = this.buildSessionKey(playerId, instanceId);
    const playerKey = this.buildPlayerKey(playerId);
    await this.redis.del(sessionKey);
    await this.redis.del(playerKey);
  }

  async getPlayerActiveSession(playerId: string): Promise<PlayerSessionMapping | null> {
    const playerKey = this.buildPlayerKey(playerId);
    const raw = await this.redis.get(playerKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as PlayerSessionMapping;
      if (parsed && typeof parsed.instanceId === "string" && typeof parsed.sessionId === "string") {
        return parsed;
      }
    } catch {
      // fall through
    }

    await this.redis.del(playerKey);
    return null;
  }

  async listActiveSessions(instanceId?: string): Promise<ReconnectSession[]> {
    const pattern = this.buildSessionPattern(instanceId);
    const keys = await this.redis.keys(pattern);
    const sessions: ReconnectSession[] = [];

    for (const key of keys) {
      const ids = this.parseSessionKey(key);
      if (!ids) {
        continue;
      }

      const session = await this.getSession(ids.playerId, ids.instanceId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  async cleanupExpiredSessions(): Promise<number> {
    const keys = await this.redis.keys(this.buildSessionPattern());
    let cleaned = 0;

    for (const key of keys) {
      const ids = this.parseSessionKey(key);
      if (!ids) {
        continue;
      }

      const session = await this.getSession(ids.playerId, ids.instanceId);
      if (!session) {
        cleaned += 1;
      }
    }

    return cleaned;
  }

  async getSessionStats(): Promise<SessionStats> {
    const sessions = await this.listActiveSessions();
    const byInstance: Record<string, number> = {};
    let totalGrace = 0;
    let oldest = this.now();

    for (const session of sessions) {
      byInstance[session.instanceId] = (byInstance[session.instanceId] ?? 0) + 1;
      totalGrace += session.gracePeriodMs;
      if (session.disconnectedAt < oldest) {
        oldest = session.disconnectedAt;
      }
    }

    return {
      totalActive: sessions.length,
      byInstance,
      oldestDisconnectionMs: sessions.length > 0 ? this.now() - oldest : 0,
      averageGracePeriodMs: sessions.length > 0 ? totalGrace / sessions.length : 0
    };
  }

  private async persistSession(
    session: ReconnectSession,
    ttlMs: number,
    updatePlayerMapping = true
  ): Promise<void> {
    const sessionKey = this.buildSessionKey(session.playerId, session.instanceId);
    const playerKey = this.buildPlayerKey(session.playerId);
    const ttlSeconds = this.computeTtlSeconds(ttlMs);

    await this.redis.setEx(sessionKey, ttlSeconds, JSON.stringify(session));

    if (updatePlayerMapping) {
      const mapping: PlayerSessionMapping = {
        instanceId: session.instanceId,
        sessionId: session.sessionId
      };
      await this.redis.setEx(playerKey, ttlSeconds, JSON.stringify(mapping));
    }
  }

  private buildSessionKey(playerId: string, instanceId: string): string {
    return `${this.sessionKeyPrefix}${playerId}:${instanceId}`;
  }

  private buildPlayerKey(playerId: string): string {
    return `${this.playerKeyPrefix}${playerId}`;
  }

  private buildSessionPattern(instanceId?: string): string {
    if (instanceId) {
      return `${this.sessionKeyPrefix}*:${instanceId}`;
    }
    return `${this.sessionKeyPrefix}*`;
  }

  private parseSessionKey(key: string): { playerId: string; instanceId: string } | null {
    if (!key.startsWith(this.sessionKeyPrefix)) {
      return null;
    }
    const remainder = key.slice(this.sessionKeyPrefix.length);
    const [playerId, instanceId] = remainder.split(":");
    if (!playerId || !instanceId) {
      return null;
    }
    return { playerId, instanceId };
  }

  private isExpired(session: ReconnectSession): boolean {
    return this.now() > session.disconnectedAt + session.gracePeriodMs;
  }

  private getRemainingMs(session: ReconnectSession): number {
    return Math.max(0, session.disconnectedAt + session.gracePeriodMs - this.now());
  }

  private computeTtlSeconds(ms: number): number {
    if (ms <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(ms / 1000));
  }

  private now(): number {
    return this.clock();
  }
}

const DEFAULT_DELTA_WINDOW = 50;

export interface PrepareReconnectOptions {
  reconnectToken: string;
  clientSequence?: number;
}

export interface SerializedActionEvent {
  actionId: string;
  sessionId: string;
  sequenceNumber: number;
  actionType: ActionEventType;
  payload: Record<string, unknown>;
  persistedAt: string;
}

export interface ReconnectDelta {
  fromSequence: number;
  toSequence: number;
  events: SerializedActionEvent[];
}

export interface ReconnectSnapshot {
  character: {
    characterId: string;
    displayName: string;
    position: { x: number; y: number };
    stats: Record<string, unknown>;
    inventory: Record<string, unknown>;
  } | null;
  world: Record<string, unknown>;
}

export interface PrepareReconnectResult {
  session: PlayerSessionState;
  lastSequenceNumber: number;
  reconnect: {
    token: string;
    expiresAt: string;
  };
  mode: "delta" | "snapshot";
  delta?: ReconnectDelta;
  snapshot?: ReconnectSnapshot;
}

export interface ReconnectFlowDependencies {
  sessions: PlayerSessionStore;
  reconnectTokens: ReconnectTokenStore;
  characterProfiles: CharacterProfileRepository;
  actionDurability: ActionDurabilityService;
  now?: () => Date;
  deltaWindow?: number;
  defaultWorldState?: () => Record<string, unknown>;
  reconnectTtlSeconds?: number;
}

export class ReconnectFlowService {
  private readonly sessions: PlayerSessionStore;
  private readonly reconnectTokens: ReconnectTokenStore;
  private readonly characterProfiles: CharacterProfileRepository;
  private readonly actionDurability: ActionDurabilityService;
  private readonly now: () => Date;
  private readonly deltaWindow: number;
  private readonly defaultWorldState: () => Record<string, unknown>;
  private readonly reconnectTtlSeconds?: number;

  constructor(dependencies: ReconnectFlowDependencies) {
    this.sessions = dependencies.sessions;
    this.reconnectTokens = dependencies.reconnectTokens;
    this.characterProfiles = dependencies.characterProfiles;
    this.actionDurability = dependencies.actionDurability;
    this.now = dependencies.now ?? (() => new Date());
    this.deltaWindow = dependencies.deltaWindow ?? DEFAULT_DELTA_WINDOW;
    this.defaultWorldState = dependencies.defaultWorldState ?? (() => ({ tiles: [] }));
    this.reconnectTtlSeconds = dependencies.reconnectTtlSeconds;
  }

  async prepareReconnect(options: PrepareReconnectOptions): Promise<PrepareReconnectResult> {
    if (!options.reconnectToken) {
      throw new Error("reconnect_token_missing");
    }

    const token = await this.reconnectTokens.consume(options.reconnectToken);
    if (!token) {
      throw new Error("reconnect_token_invalid");
    }

    const session = this.sessions.get(token.sessionId);
    if (!session) {
      throw new Error("session_not_found_for_reconnect");
    }

    const latestRecord = await this.actionDurability.getLatestForSession(session.sessionId);
    const latestSequence = Math.max(
      token.lastSequenceNumber,
      session.lastSequenceNumber,
      latestRecord?.sequenceNumber ?? 0
    );

    const clientSequence = isValidSequence(options.clientSequence)
      ? options.clientSequence!
      : token.lastSequenceNumber;

    const delta = await this.tryBuildDelta(session, clientSequence, latestSequence);
    const mode: "delta" | "snapshot" = delta ? "delta" : "snapshot";

    const snapshot = mode === "snapshot" ? await this.buildSnapshot(session) : undefined;

    const heartbeat = this.sessions.recordHeartbeat(session.sessionId, this.now()) ?? session;
    const withStatus = this.sessions.setStatus(heartbeat.sessionId, "active") ?? heartbeat;
    this.sessions.resetReconnectAttempts(withStatus.sessionId);
    const updatedSession = this.sessions.recordActionSequence(
      withStatus.sessionId,
      latestSequence
    ) ?? withStatus;

    const replacement = await this.reissueToken(token, latestSequence);

    return {
      session: updatedSession,
      lastSequenceNumber: latestSequence,
      reconnect: {
        token: replacement.token,
        expiresAt: replacement.expiresAt.toISOString()
      },
      mode,
      delta: delta ?? undefined,
      snapshot
    } satisfies PrepareReconnectResult;
  }

  private async reissueToken(original: ReconnectToken, lastSequenceNumber: number): Promise<ReconnectToken> {
    return this.reconnectTokens.issue({
      sessionId: original.sessionId,
      lastSequenceNumber,
      issuedAt: this.now(),
      ttlSeconds: this.reconnectTtlSeconds
    });
  }

  private async tryBuildDelta(
    session: PlayerSessionState,
    clientSequence: number,
    latestSequence: number
  ): Promise<ReconnectDelta | null> {
    if (latestSequence <= clientSequence) {
      return {
        fromSequence: clientSequence,
        toSequence: latestSequence,
        events: []
      } satisfies ReconnectDelta;
    }

    const gap = latestSequence - clientSequence;
    if (gap > this.deltaWindow) {
      return null;
    }

    const recent = await this.actionDurability.listRecentForCharacter(session.characterId, this.deltaWindow);
    const relevant = recent
      .filter((event) => event.sessionId === session.sessionId && event.sequenceNumber > clientSequence)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    if (relevant.length === 0) {
      return null;
    }

    const expectedSequences = relevant.map((event, index) => clientSequence + index + 1);
    const contiguous = relevant.every((event, index) => event.sequenceNumber === expectedSequences[index]);

    if (!contiguous) {
      return null;
    }

    // If we cannot cover the full gap, fall back to snapshot to avoid partial replay.
    if (relevant[relevant.length - 1].sequenceNumber !== latestSequence) {
      return null;
    }

    return {
      fromSequence: clientSequence,
      toSequence: latestSequence,
      events: relevant.map(serializeActionEvent)
    } satisfies ReconnectDelta;
  }

  private async buildSnapshot(session: PlayerSessionState): Promise<ReconnectSnapshot> {
    const profile = await this.characterProfiles.getProfile(session.characterId, session.userId).catch(() => null);
    const character = profile ? snapshotFromProfile(profile) : fallbackSnapshot(session);
    return {
      character,
      world: this.defaultWorldState()
    } satisfies ReconnectSnapshot;
  }
}

function serializeActionEvent(event: ActionEventRecord): SerializedActionEvent {
  return {
    actionId: event.actionId,
    sessionId: event.sessionId,
    sequenceNumber: event.sequenceNumber,
    actionType: event.actionType,
    payload: event.payload,
    persistedAt: event.persistedAt.toISOString()
  } satisfies SerializedActionEvent;
}

function snapshotFromProfile(profile: CharacterProfile): {
  characterId: string;
  displayName: string;
  position: { x: number; y: number };
  stats: Record<string, unknown>;
  inventory: Record<string, unknown>;
} {
  return {
    characterId: profile.characterId,
    displayName: profile.displayName,
    position: { x: profile.positionX, y: profile.positionY },
    stats: profile.stats ?? {},
    inventory: profile.inventory ?? {}
  };
}

function fallbackSnapshot(session: PlayerSessionState): {
  characterId: string;
  displayName: string;
  position: { x: number; y: number };
  stats: Record<string, unknown>;
  inventory: Record<string, unknown>;
} {
  return {
    characterId: session.characterId,
    displayName: `Adventurer-${session.userId.slice(0, 6)}`,
    position: { x: 0, y: 0 },
    stats: {},
    inventory: {}
  };
}

function isValidSequence(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
