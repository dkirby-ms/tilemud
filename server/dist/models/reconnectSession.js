// Reconnect session manager using Redis
export class ReconnectSessionManager {
    redis;
    defaultGracePeriodMs;
    keyPrefix;
    constructor(options) {
        this.redis = options.redis;
        this.defaultGracePeriodMs = options.defaultGracePeriodMs;
        this.keyPrefix = options.keyPrefix || "reconnect_session:";
    }
    async createSession(playerId, instanceId, sessionId, playerState, gracePeriodMs, metadata) {
        const session = {
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
        await this.redis.setex(key, expireSeconds, JSON.stringify(session));
        // Also maintain a player -> session mapping for quick lookup
        const playerKey = this.buildPlayerKey(playerId);
        await this.redis.setex(playerKey, expireSeconds, JSON.stringify({ instanceId, sessionId }));
        return session;
    }
    async getSession(playerId, instanceId) {
        const key = this.buildSessionKey(playerId, instanceId);
        const sessionData = await this.redis.get(key);
        if (!sessionData) {
            return null;
        }
        try {
            const session = JSON.parse(sessionData);
            // Check if session is still valid
            const now = Date.now();
            const expiresAt = session.disconnectedAt + session.gracePeriodMs;
            if (now > expiresAt) {
                // Session expired, clean it up
                await this.removeSession(playerId, instanceId);
                return null;
            }
            return session;
        }
        catch (error) {
            // Invalid JSON, clean up
            await this.removeSession(playerId, instanceId);
            return null;
        }
    }
    async attemptReconnect(playerId, instanceId, newSessionId) {
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
        await this.redis.setex(key, expireSeconds, JSON.stringify(session));
        return {
            success: true,
            session
        };
    }
    async updatePlayerState(playerId, instanceId, playerState) {
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
        await this.redis.setex(key, expireSeconds, JSON.stringify(session));
        return true;
    }
    async removeSession(playerId, instanceId) {
        const sessionKey = this.buildSessionKey(playerId, instanceId);
        const playerKey = this.buildPlayerKey(playerId);
        await this.redis.del(sessionKey, playerKey);
    }
    async getPlayerActiveSession(playerId) {
        const playerKey = this.buildPlayerKey(playerId);
        const data = await this.redis.get(playerKey);
        if (!data) {
            return null;
        }
        try {
            return JSON.parse(data);
        }
        catch {
            await this.redis.del(playerKey);
            return null;
        }
    }
    async extendGracePeriod(playerId, instanceId, additionalMs) {
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
        await this.redis.setex(key, expireSeconds, JSON.stringify(session));
        return true;
    }
    async listActiveSessions(instanceId) {
        let pattern;
        if (instanceId) {
            pattern = `${this.keyPrefix}*:${instanceId}`;
        }
        else {
            pattern = `${this.keyPrefix}*`;
        }
        const keys = await this.redis.keys(pattern);
        const sessions = [];
        for (const key of keys) {
            const sessionData = await this.redis.get(key);
            if (sessionData) {
                try {
                    const session = JSON.parse(sessionData);
                    sessions.push(session);
                }
                catch {
                    // Invalid session, clean it up
                    await this.redis.del(key);
                }
            }
        }
        return sessions;
    }
    async cleanupExpiredSessions() {
        const pattern = `${this.keyPrefix}*`;
        const keys = await this.redis.keys(pattern);
        let cleanedCount = 0;
        for (const key of keys) {
            const sessionData = await this.redis.get(key);
            if (sessionData) {
                try {
                    const session = JSON.parse(sessionData);
                    const now = Date.now();
                    const expiresAt = session.disconnectedAt + session.gracePeriodMs;
                    if (now > expiresAt) {
                        await this.redis.del(key);
                        cleanedCount++;
                    }
                }
                catch {
                    // Invalid session, clean it up
                    await this.redis.del(key);
                    cleanedCount++;
                }
            }
        }
        return cleanedCount;
    }
    async getSessionStats() {
        const sessions = await this.listActiveSessions();
        const byInstance = {};
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
    buildSessionKey(playerId, instanceId) {
        return `${this.keyPrefix}${playerId}:${instanceId}`;
    }
    buildPlayerKey(playerId) {
        return `${this.keyPrefix}player:${playerId}`;
    }
}
// Pre-configured reconnect manager for different scenarios
export class GameReconnectManager {
    manager;
    constructor(redis) {
        this.manager = new ReconnectSessionManager({
            redis,
            defaultGracePeriodMs: 300000, // 5 minutes default
            keyPrefix: "game_reconnect:"
        });
    }
    // Quick reconnect for temporary disconnections (network blips)
    async createQuickReconnectSession(playerId, instanceId, sessionId, playerState) {
        return this.manager.createSession(playerId, instanceId, sessionId, playerState, 30000, // 30 seconds
        { type: "quick" });
    }
    // Standard reconnect for normal disconnections
    async createStandardReconnectSession(playerId, instanceId, sessionId, playerState) {
        return this.manager.createSession(playerId, instanceId, sessionId, playerState, 300000, // 5 minutes
        { type: "standard" });
    }
    // Extended reconnect for planned disconnections
    async createExtendedReconnectSession(playerId, instanceId, sessionId, playerState) {
        return this.manager.createSession(playerId, instanceId, sessionId, playerState, 900000, // 15 minutes
        { type: "extended" });
    }
    // Delegate other methods to the manager
    async getSession(playerId, instanceId) {
        return this.manager.getSession(playerId, instanceId);
    }
    async attemptReconnect(playerId, instanceId, newSessionId) {
        return this.manager.attemptReconnect(playerId, instanceId, newSessionId);
    }
    async removeSession(playerId, instanceId) {
        return this.manager.removeSession(playerId, instanceId);
    }
    async updatePlayerState(playerId, instanceId, playerState) {
        return this.manager.updatePlayerState(playerId, instanceId, playerState);
    }
}
// Factory functions for dependency injection
export function createReconnectSessionManager(redis, options) {
    return new ReconnectSessionManager({
        redis,
        defaultGracePeriodMs: 300000,
        keyPrefix: "reconnect_session:",
        ...options
    });
}
export function createGameReconnectManager(redis) {
    return new GameReconnectManager(redis);
}
//# sourceMappingURL=reconnectSession.js.map