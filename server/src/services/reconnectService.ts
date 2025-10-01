import type { RedisClientType } from "redis";
import {
  type PlayerReconnectState,
  type ReconnectSession,
  type ReconnectResult
} from "../models/reconnectSession.js";
import { TileMudError } from "../models/errorCodes.js";

export interface ReconnectServiceDependencies {
  redis: RedisClientType;
  defaultGracePeriodMs?: number;
  keyPrefix?: string;
  clock?: () => number;
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

  constructor(dependencies: ReconnectServiceDependencies) {
    this.redis = dependencies.redis;
    this.defaultGracePeriodMs = dependencies.defaultGracePeriodMs ?? 60_000;
    this.clock = dependencies.clock ?? (() => Date.now());

    this.basePrefix = dependencies.keyPrefix ?? "reconnect:";
    this.sessionKeyPrefix = `${this.basePrefix}session:`;
    this.playerKeyPrefix = `${this.basePrefix}player:`;
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
    const session = await this.getSession(input.playerId, input.instanceId);

    if (!session) {
      throw new TileMudError(
        "GRACE_PERIOD_EXPIRED",
        { playerId: input.playerId, instanceId: input.instanceId },
        input.requestId
      );
    }

    if (this.isExpired(session)) {
      await this.removeSession(input.playerId, input.instanceId);
      throw new TileMudError(
        "GRACE_PERIOD_EXPIRED",
        { playerId: input.playerId, instanceId: input.instanceId },
        input.requestId
      );
    }

    session.sessionId = input.newSessionId;
    const remainingMs = this.getRemainingMs(session);
    await this.persistSession(session, remainingMs);

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
