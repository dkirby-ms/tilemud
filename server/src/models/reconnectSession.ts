import type { Redis } from "ioredis";

// Reconnect session types
export interface ReconnectSession {
  playerId: string;
  instanceId: string;
  sessionId: string;
  disconnectedAt: number;
  gracePeriodMs: number;
  playerState: PlayerReconnectState;
  metadata?: Record<string, any>;
}

export interface PlayerReconnectState {
  lastActionTick: number;
  initiative: number;
  boardPosition?: { x: number; y: number };
  pendingActions?: any[];
  chatHistory?: Array<{ message: string; timestamp: number }>;
}

export interface ReconnectSessionOptions {
  redis: Redis;
  defaultGracePeriodMs: number;
  keyPrefix?: string;
}

export interface ReconnectResult {
  success: boolean;
  session?: ReconnectSession;
  reason?: string;
  newSessionRequired?: boolean;
}

// Reconnect session manager using Redis
export class ReconnectSessionManager {
  private redis: Redis;
  private defaultGracePeriodMs: number;
  private keyPrefix: string;

  constructor(options: ReconnectSessionOptions) {
    this.redis = options.redis;
    this.defaultGracePeriodMs = options.defaultGracePeriodMs;
    this.keyPrefix = options.keyPrefix || "reconnect_session:";
  }

  async createSession(
    playerId: string,
    instanceId: string,
    sessionId: string,
    playerState: PlayerReconnectState,
    gracePeriodMs?: number,
    metadata?: Record<string, any>
  ): Promise<ReconnectSession> {
    const session: ReconnectSession = {
      playerId,
      instanceId,
      sessionId,
      disconnectedAt: Date.now(),
      gracePeriodMs: gracePeriodMs || this.defaultGracePeriodMs,
      playerState,
      metadata
    };

    const key = this.buildSessionKey(playerId, instanceId);
    const expireSeconds = Math.ceil(session.gracePeriodMs / 1000);

    await this.redis.setex(
      key,
      expireSeconds,
      JSON.stringify(session)
    );

    // Also maintain a player -> session mapping for quick lookup
    const playerKey = this.buildPlayerKey(playerId);
    await this.redis.setex(
      playerKey,
      expireSeconds,
      JSON.stringify({ instanceId, sessionId })
    );

    return session;
  }

  async getSession(playerId: string, instanceId: string): Promise<ReconnectSession | null> {
    const key = this.buildSessionKey(playerId, instanceId);
    const sessionData = await this.redis.get(key);

    if (!sessionData) {
      return null;
    }

    try {
      const session = JSON.parse(sessionData) as ReconnectSession;
      
      // Check if session is still valid
      const now = Date.now();
      const expiresAt = session.disconnectedAt + session.gracePeriodMs;
      
      if (now > expiresAt) {
        // Session expired, clean it up
        await this.removeSession(playerId, instanceId);
        return null;
      }

      return session;
    } catch (error) {
      // Invalid JSON, clean up
      await this.removeSession(playerId, instanceId);
      return null;
    }
  }

  async attemptReconnect(
    playerId: string,
    instanceId: string,
    newSessionId: string
  ): Promise<ReconnectResult> {
    const session = await this.getSession(playerId, instanceId);

    if (!session) {
      return {
        success: false,
        reason: "No active reconnect session found",
        newSessionRequired: true
      };
    }

    const now = Date.now();
    const gracePeriodExpired = now > (session.disconnectedAt + session.gracePeriodMs);

    if (gracePeriodExpired) {
      await this.removeSession(playerId, instanceId);
      return {
        success: false,
        reason: "Grace period expired",
        newSessionRequired: true
      };
    }

    // Update session with new session ID
    session.sessionId = newSessionId;
    const key = this.buildSessionKey(playerId, instanceId);
    const remainingMs = (session.disconnectedAt + session.gracePeriodMs) - now;
    const expireSeconds = Math.ceil(remainingMs / 1000);

    await this.redis.setex(
      key,
      expireSeconds,
      JSON.stringify(session)
    );

    return {
      success: true,
      session
    };
  }

  async updatePlayerState(
    playerId: string,
    instanceId: string,
    playerState: Partial<PlayerReconnectState>
  ): Promise<boolean> {
    const session = await this.getSession(playerId, instanceId);

    if (!session) {
      return false;
    }

    session.playerState = { ...session.playerState, ...playerState };
    
    const key = this.buildSessionKey(playerId, instanceId);
    const now = Date.now();
    const remainingMs = (session.disconnectedAt + session.gracePeriodMs) - now;
    
    if (remainingMs <= 0) {
      return false;
    }

    const expireSeconds = Math.ceil(remainingMs / 1000);
    await this.redis.setex(
      key,
      expireSeconds,
      JSON.stringify(session)
    );

    return true;
  }

  async removeSession(playerId: string, instanceId: string): Promise<void> {
    const sessionKey = this.buildSessionKey(playerId, instanceId);
    const playerKey = this.buildPlayerKey(playerId);
    
    await this.redis.del(sessionKey, playerKey);
  }

  async getPlayerActiveSession(playerId: string): Promise<{ instanceId: string; sessionId: string } | null> {
    const playerKey = this.buildPlayerKey(playerId);
    const data = await this.redis.get(playerKey);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch {
      await this.redis.del(playerKey);
      return null;
    }
  }

  async extendGracePeriod(
    playerId: string,
    instanceId: string,
    additionalMs: number
  ): Promise<boolean> {
    const session = await this.getSession(playerId, instanceId);

    if (!session) {
      return false;
    }

    session.gracePeriodMs += additionalMs;
    
    const key = this.buildSessionKey(playerId, instanceId);
    const now = Date.now();
    const totalRemainingMs = (session.disconnectedAt + session.gracePeriodMs) - now;
    
    if (totalRemainingMs <= 0) {
      return false;
    }

    const expireSeconds = Math.ceil(totalRemainingMs / 1000);
    await this.redis.setex(
      key,
      expireSeconds,
      JSON.stringify(session)
    );

    return true;
  }

  async listActiveSessions(instanceId?: string): Promise<ReconnectSession[]> {
    let pattern: string;
    
    if (instanceId) {
      pattern = `${this.keyPrefix}*:${instanceId}`;
    } else {
      pattern = `${this.keyPrefix}*`;
    }

    const keys = await this.redis.keys(pattern);
    const sessions: ReconnectSession[] = [];

    for (const key of keys) {
      const sessionData = await this.redis.get(key);
      if (sessionData) {
        try {
          const session = JSON.parse(sessionData) as ReconnectSession;
          sessions.push(session);
        } catch {
          // Invalid session, clean it up
          await this.redis.del(key);
        }
      }
    }

    return sessions;
  }

  async cleanupExpiredSessions(): Promise<number> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);
    let cleanedCount = 0;

    for (const key of keys) {
      const sessionData = await this.redis.get(key);
      if (sessionData) {
        try {
          const session = JSON.parse(sessionData) as ReconnectSession;
          const now = Date.now();
          const expiresAt = session.disconnectedAt + session.gracePeriodMs;
          
          if (now > expiresAt) {
            await this.redis.del(key);
            cleanedCount++;
          }
        } catch {
          // Invalid session, clean it up
          await this.redis.del(key);
          cleanedCount++;
        }
      }
    }

    return cleanedCount;
  }

  async getSessionStats(): Promise<{
    totalActive: number;
    byInstance: Record<string, number>;
    oldestDisconnectionMs: number;
    averageGracePeriodMs: number;
  }> {
    const sessions = await this.listActiveSessions();
    const byInstance: Record<string, number> = {};
    let totalGracePeriod = 0;
    let oldestDisconnection = Date.now();

    for (const session of sessions) {
      byInstance[session.instanceId] = (byInstance[session.instanceId] || 0) + 1;
      totalGracePeriod += session.gracePeriodMs;
      oldestDisconnection = Math.min(oldestDisconnection, session.disconnectedAt);
    }

    return {
      totalActive: sessions.length,
      byInstance,
      oldestDisconnectionMs: sessions.length > 0 ? Date.now() - oldestDisconnection : 0,
      averageGracePeriodMs: sessions.length > 0 ? totalGracePeriod / sessions.length : 0
    };
  }

  private buildSessionKey(playerId: string, instanceId: string): string {
    return `${this.keyPrefix}${playerId}:${instanceId}`;
  }

  private buildPlayerKey(playerId: string): string {
    return `${this.keyPrefix}player:${playerId}`;
  }
}

// Pre-configured reconnect manager for different scenarios
export class GameReconnectManager {
  private manager: ReconnectSessionManager;

  constructor(redis: Redis) {
    this.manager = new ReconnectSessionManager({
      redis,
      defaultGracePeriodMs: 300000, // 5 minutes default
      keyPrefix: "game_reconnect:"
    });
  }

  // Quick reconnect for temporary disconnections (network blips)
  async createQuickReconnectSession(
    playerId: string,
    instanceId: string,
    sessionId: string,
    playerState: PlayerReconnectState
  ): Promise<ReconnectSession> {
    return this.manager.createSession(
      playerId,
      instanceId,
      sessionId,
      playerState,
      30000, // 30 seconds
      { type: "quick" }
    );
  }

  // Standard reconnect for normal disconnections
  async createStandardReconnectSession(
    playerId: string,
    instanceId: string,
    sessionId: string,
    playerState: PlayerReconnectState
  ): Promise<ReconnectSession> {
    return this.manager.createSession(
      playerId,
      instanceId,
      sessionId,
      playerState,
      300000, // 5 minutes
      { type: "standard" }
    );
  }

  // Extended reconnect for planned disconnections
  async createExtendedReconnectSession(
    playerId: string,
    instanceId: string,
    sessionId: string,
    playerState: PlayerReconnectState
  ): Promise<ReconnectSession> {
    return this.manager.createSession(
      playerId,
      instanceId,
      sessionId,
      playerState,
      900000, // 15 minutes
      { type: "extended" }
    );
  }

  // Delegate other methods to the manager
  async getSession(playerId: string, instanceId: string): Promise<ReconnectSession | null> {
    return this.manager.getSession(playerId, instanceId);
  }

  async attemptReconnect(playerId: string, instanceId: string, newSessionId: string): Promise<ReconnectResult> {
    return this.manager.attemptReconnect(playerId, instanceId, newSessionId);
  }

  async removeSession(playerId: string, instanceId: string): Promise<void> {
    return this.manager.removeSession(playerId, instanceId);
  }

  async updatePlayerState(
    playerId: string,
    instanceId: string,
    playerState: Partial<PlayerReconnectState>
  ): Promise<boolean> {
    return this.manager.updatePlayerState(playerId, instanceId, playerState);
  }
}

// Factory functions for dependency injection
export function createReconnectSessionManager(
  redis: Redis,
  options?: Partial<ReconnectSessionOptions>
): ReconnectSessionManager {
  return new ReconnectSessionManager({
    redis,
    defaultGracePeriodMs: 300000,
    keyPrefix: "reconnect_session:",
    ...options
  });
}

export function createGameReconnectManager(redis: Redis): GameReconnectManager {
  return new GameReconnectManager(redis);
}