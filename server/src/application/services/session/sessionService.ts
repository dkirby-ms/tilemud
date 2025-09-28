/**
 * Session management service for character connections
 * Handles session lifecycle: admit, replace, grace period, reconnection
 */

import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { sessionKeys, TTL, generateCorrelationId } from '../../../infra/persistence/redisKeys';
import { 
  CharacterSession, 
  SessionState, 
  DisconnectReason, 
  AttemptOutcome,
  FailureReason,
  AdmissionStatus
} from '../../../domain/connection/types';

export interface SessionConfig {
  gracePeriodSeconds: number;     // Grace period duration (default: 60s)
  maxActiveSessions: number;      // Per instance capacity (default: 100)
  sessionTimeoutSeconds: number;  // Active session TTL (default: 24h)
  reconnectionTokenTTL: number;   // Token validity (default: 60s)
  heartbeatIntervalSeconds: number; // Heartbeat frequency (default: 30s)
}

export interface AdmissionResult {
  outcome: AttemptOutcome;
  session?: CharacterSession;
  failureReason?: FailureReason;
  replacementToken?: string;
  existingSession?: CharacterSession;
}

export interface ReconnectionResult {
  success: boolean;
  session?: CharacterSession;
  reason?: string;
}

const DEFAULT_CONFIG: SessionConfig = {
  gracePeriodSeconds: 60,
  maxActiveSessions: 100,
  sessionTimeoutSeconds: 24 * 60 * 60,  // 24 hours
  reconnectionTokenTTL: 60,              // 60 seconds
  heartbeatIntervalSeconds: 30
};

export class SessionService {
  private redis: Redis;
  private config: SessionConfig;

  constructor(redis: Redis, config: Partial<SessionConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Unified admission method that handles both direct admission and replacement
   * This is the primary entry point for admission controller
   */
  async admit(request: {
    instanceId: string;
    characterId: string;
    replaceToken?: string;
    correlationId?: string;
  }): Promise<{
    status: AdmissionStatus;
    outcome?: AttemptOutcome;
    sessionToken?: string | undefined;
    reconnectionToken?: string | undefined;
    queuePosition?: any;
    reason?: string | undefined;
  }> {
    if (request.replaceToken) {
      // Use replacement flow
      const result = await this.replaceSession(request.replaceToken);
      return {
        status: result.outcome === AttemptOutcome.SUCCESS ? AdmissionStatus.REPLACED : AdmissionStatus.REJECTED,
        sessionToken: result.session?.sessionId,
        reconnectionToken: result.replacementToken,
        reason: result.failureReason ? String(result.failureReason) : undefined
      };
    } else {
      // Use normal admission flow  
      const result = await this.admitCharacter(
        request.characterId,
        'default-user', // TODO: Get actual user ID from request context
        request.instanceId,
        false
      );
      
      return {
        status: result.outcome === AttemptOutcome.SUCCESS ? AdmissionStatus.ADMITTED : 
                result.outcome === AttemptOutcome.QUEUED ? AdmissionStatus.QUEUED : 
                AdmissionStatus.REJECTED,
        sessionToken: result.session?.sessionId,
        reconnectionToken: result.replacementToken,
        reason: result.failureReason ? String(result.failureReason) : undefined
      };
    }
  }

  /**
   * Attempt to admit character to instance
   */
  async admitCharacter(
    characterId: string,
    userId: string,
    instanceId: string,
    allowReplacement = false
  ): Promise<AdmissionResult> {
    const sessionId = uuidv4();
    const now = Date.now();

    try {
      // Check for existing session
      const existingSessionId = await this.redis.get(sessionKeys.byCharacter(characterId));
      if (existingSessionId) {
        const existingSession = await this.getSession(existingSessionId);
        
        if (existingSession && existingSession.state !== SessionState.TERMINATING) {
          if (!allowReplacement) {
            return {
              outcome: AttemptOutcome.FAILED,
              failureReason: FailureReason.ALREADY_IN_SESSION,
              existingSession
            };
          } else {
            // Generate replacement token for confirmation flow
            const replacementToken = generateCorrelationId();
            await this.redis.setex(
              `replacement:${replacementToken}`,
              300, // 5 minutes
              JSON.stringify({ characterId, userId, instanceId, existingSessionId })
            );
            
            return {
              outcome: AttemptOutcome.FAILED,
              failureReason: FailureReason.ALREADY_IN_SESSION,
              replacementToken,
              existingSession
            };
          }
        }
      }

      // Check instance capacity
      const currentCapacity = await this.getActiveSessionCount(instanceId);
      if (currentCapacity >= this.config.maxActiveSessions) {
        return {
          outcome: AttemptOutcome.FAILED,
          failureReason: FailureReason.CAPACITY_FULL
        };
      }

      // Create new session
      const session: CharacterSession = {
        sessionId,
        characterId,
        userId,
        instanceId,
        state: SessionState.ACTIVE,
        admittedAt: now,
        lastHeartbeatAt: now
      };

      // Store session atomically
      await this.storeSession(session);

      return {
        outcome: AttemptOutcome.SUCCESS,
        session
      };
    } catch (error) {
      console.error('Session admission failed:', error);
      return {
        outcome: AttemptOutcome.FAILED,
        failureReason: FailureReason.INTERNAL_ERROR
      };
    }
  }

  /**
   * Replace existing session (after confirmation)
   */
  async replaceSession(replacementToken: string): Promise<AdmissionResult> {
    try {
      const replacementData = await this.redis.get(`replacement:${replacementToken}`);
      if (!replacementData) {
        return {
          outcome: AttemptOutcome.FAILED,
          failureReason: FailureReason.INVALID_INSTANCE
        };
      }

      const { characterId, userId, instanceId, existingSessionId } = JSON.parse(replacementData);
      
      // Terminate existing session
      await this.terminateSession(existingSessionId, DisconnectReason.REPLACE);
      
      // Create new session
      const newSessionId = uuidv4();
      const now = Date.now();
      
      const session: CharacterSession = {
        sessionId: newSessionId,
        characterId,
        userId,
        instanceId,
        state: SessionState.ACTIVE,
        admittedAt: now,
        lastHeartbeatAt: now,
        replacementOf: existingSessionId
      };

      await this.storeSession(session);
      
      // Clean up replacement token
      await this.redis.del(`replacement:${replacementToken}`);

      return {
        outcome: AttemptOutcome.SUCCESS,
        session
      };
    } catch (error) {
      console.error('Session replacement failed:', error);
      return {
        outcome: AttemptOutcome.FAILED,
        failureReason: FailureReason.INTERNAL_ERROR
      };
    }
  }

  /**
   * Put session into grace period (temporary disconnect)
   */
  async enterGracePeriod(sessionId: string): Promise<string | null> {
    try {
      const session = await this.getSession(sessionId);
      if (!session || session.state !== SessionState.ACTIVE) {
        return null;
      }

      const now = Date.now();
      const graceExpiresAt = now + (this.config.gracePeriodSeconds * 1000);
      const reconnectionToken = uuidv4();

      // Update session state
      session.state = SessionState.GRACE;
      session.graceExpiresAt = graceExpiresAt;
      session.reconnectionToken = reconnectionToken;

      // Store updated session and reconnection token
      await Promise.all([
        this.storeSession(session),
        this.redis.setex(
          sessionKeys.reconnectionToken(reconnectionToken),
          this.config.reconnectionTokenTTL,
          sessionId
        ),
        // Add to grace period sorted set for cleanup
        this.redis.zadd(sessionKeys.grace(session.instanceId, sessionId), graceExpiresAt, sessionId)
      ]);

      return reconnectionToken;
    } catch (error) {
      console.error('Failed to enter grace period:', error);
      return null;
    }
  }

  /**
   * Reconnect using reconnection token
   */
  async reconnectWithToken(token: string): Promise<ReconnectionResult> {
    try {
      const sessionId = await this.redis.get(sessionKeys.reconnectionToken(token));
      if (!sessionId) {
        return {
          success: false,
          reason: 'Invalid or expired reconnection token'
        };
      }

      const session = await this.getSession(sessionId);
      if (!session) {
        return {
          success: false,
          reason: 'Session not found'
        };
      }

      if (session.state !== SessionState.GRACE) {
        return {
          success: false,
          reason: 'Session not in grace period'
        };
      }

      // Check if grace period has expired
      const now = Date.now();
      if (session.graceExpiresAt && session.graceExpiresAt < now) {
        await this.terminateSession(sessionId, DisconnectReason.GRACE_EXPIRED);
        return {
          success: false,
          reason: 'Grace period expired'
        };
      }

      // Restore session to active state
      session.state = SessionState.ACTIVE;
      session.lastHeartbeatAt = now;
      delete session.graceExpiresAt;
      delete session.reconnectionToken;

      // Clean up grace period tracking
      await Promise.all([
        this.storeSession(session),
        this.redis.del(sessionKeys.reconnectionToken(token)),
        this.redis.zrem(sessionKeys.grace(session.instanceId, sessionId))
      ]);

      return {
        success: true,
        session
      };
    } catch (error) {
      console.error('Reconnection failed:', error);
      return {
        success: false,
        reason: 'Internal error'
      };
    }
  }

  /**
   * Update session heartbeat
   */
  async updateHeartbeat(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session || session.state !== SessionState.ACTIVE) {
        return false;
      }

      session.lastHeartbeatAt = Date.now();
      await this.storeSession(session);
      return true;
    } catch (error) {
      console.error('Failed to update heartbeat:', error);
      return false;
    }
  }

  /**
   * Gracefully terminate session
   */
  async terminateSession(sessionId: string, reason: DisconnectReason): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      // Mark as terminating
      session.state = SessionState.TERMINATING;
      await this.storeSession(session, TTL.SESSION_ACTIVE); // Short TTL for cleanup

      // Clean up all related data
      await Promise.all([
        this.redis.del(sessionKeys.byCharacter(session.characterId)),
        this.redis.srem(sessionKeys.byInstance(session.instanceId), sessionId),
        this.redis.zrem(sessionKeys.grace(session.instanceId, sessionId)),
        ...(session.reconnectionToken ? 
          [this.redis.del(sessionKeys.reconnectionToken(session.reconnectionToken))] : 
          []
        )
      ]);

      // Log termination for monitoring
      console.info(`Session ${sessionId} terminated: ${reason}`);

      return true;
    } catch (error) {
      console.error('Failed to terminate session:', error);
      return false;
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<CharacterSession | null> {
    try {
      const data = await this.redis.get(sessionKeys.byId(sessionId));
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Get session by character ID
   */
  async getSessionByCharacter(characterId: string): Promise<CharacterSession | null> {
    try {
      const sessionId = await this.redis.get(sessionKeys.byCharacter(characterId));
      return sessionId ? await this.getSession(sessionId) : null;
    } catch (error) {
      console.error('Failed to get session by character:', error);
      return null;
    }
  }

  /**
   * Get all active sessions for instance
   */
  async getInstanceSessions(instanceId: string): Promise<CharacterSession[]> {
    try {
      const sessionIds = await this.redis.smembers(sessionKeys.byInstance(instanceId));
      const sessions: CharacterSession[] = [];

      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session && session.state === SessionState.ACTIVE) {
          sessions.push(session);
        }
      }

      return sessions;
    } catch (error) {
      console.error('Failed to get instance sessions:', error);
      return [];
    }
  }

  /**
   * Get active session count for instance
   */
  async getActiveSessionCount(instanceId: string): Promise<number> {
    try {
      const sessionIds = await this.redis.smembers(sessionKeys.byInstance(instanceId));
      let activeCount = 0;

      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session && session.state === SessionState.ACTIVE) {
          activeCount++;
        }
      }

      return activeCount;
    } catch (error) {
      console.error('Failed to get active session count:', error);
      return 0;
    }
  }

  /**
   * Get count of sessions currently in grace period for an instance
   */
  async getGracePeriodSessionCount(instanceId: string): Promise<number> {
    try {
      const gracePattern = sessionKeys.grace(instanceId, '*');
      const graceKeys = await this.redis.keys(gracePattern);
      return graceKeys.length;
    } catch (error) {
      console.error('Failed to get grace period session count:', error);
      return 0;
    }
  }

  /**
   * Get expired grace period sessions for cleanup
   */
  async getExpiredGraceSessions(): Promise<string[]> {
    try {
      const now = Date.now();
      const expiredSessions: string[] = [];
      
      // Get all instance grace period keys using pattern
      const gracePattern = sessionKeys.grace('*', '*');
      const graceKeys = await this.redis.keys(gracePattern);
      
      // Check each grace period key for expired sessions
      for (const graceKey of graceKeys) {
        const expired = await this.redis.zrangebyscore(graceKey, 0, now);
        expiredSessions.push(...expired);
      }
      
      return expiredSessions;
    } catch (error) {
      console.error('Failed to get expired grace sessions:', error);
      return [];
    }
  }

  /**
   * Store session data atomically
   */
  private async storeSession(session: CharacterSession, customTTL?: number): Promise<void> {
    const ttl = customTTL || this.config.sessionTimeoutSeconds;
    
    await Promise.all([
      // Store session data
      this.redis.setex(sessionKeys.byId(session.sessionId), ttl, JSON.stringify(session)),
      // Character lookup
      this.redis.setex(sessionKeys.byCharacter(session.characterId), ttl, session.sessionId),
      // Instance membership
      this.redis.sadd(sessionKeys.byInstance(session.instanceId), session.sessionId)
    ]);
  }

  /**
   * Get service statistics for monitoring
   */
  async getServiceStats(): Promise<{
    totalActiveSessions: number;
    totalGraceSessions: number;
    sessionsByInstance: Record<string, number>;
    oldestSession: number;
  }> {
    try {
      // Get grace sessions count across all instances
      let totalGraceSessions = 0;
      const gracePattern = sessionKeys.grace('*', '*');
      const graceKeys = await this.redis.keys(gracePattern);
      
      for (const graceKey of graceKeys) {
        const count = await this.redis.zcard(graceKey);
        totalGraceSessions += count;
      }

      // Get sessions by instance
      const instancePattern = sessionKeys.byInstance('*');
      const instanceKeys = await this.redis.keys(instancePattern);
      
      const sessionsByInstance: Record<string, number> = {};
      let totalActiveSessions = 0;
      let oldestSession = Date.now();

      for (const instanceKey of instanceKeys) {
        const sessionIds = await this.redis.smembers(instanceKey);
        let activeCount = 0;

        for (const sessionId of sessionIds) {
          const session = await this.getSession(sessionId);
          if (session && session.state === SessionState.ACTIVE) {
            activeCount++;
            totalActiveSessions++;
            if (session.admittedAt < oldestSession) {
              oldestSession = session.admittedAt;
            }
          }
        }

        // Extract instance ID from key
        const instanceId = instanceKey.split(':').pop();
        if (instanceId) {
          sessionsByInstance[instanceId] = activeCount;
        }
      }

      return {
        totalActiveSessions,
        totalGraceSessions,
        sessionsByInstance,
        oldestSession
      };
    } catch (error) {
      console.error('Failed to get session service stats:', error);
      return {
        totalActiveSessions: 0,
        totalGraceSessions: 0,
        sessionsByInstance: {},
        oldestSession: Date.now()
      };
    }
  }
}