/**
 * Session janitor job for cleaning up expired and stale sessions
 * Handles grace period expiry, orphaned sessions, and data consistency
 */

import { Redis } from 'ioredis';
import { SessionService } from '../services/session/sessionService';
import { sessionKeys, queueKeys } from '../../infra/persistence/redisKeys';
import { SessionState, DisconnectReason } from '../../domain/connection/types';

export interface JanitorConfig {
  intervalSeconds: number;        // How often to run cleanup (default: 60s)
  batchSize: number;             // Max items to process per batch (default: 50)
  gracePeriodBuffer: number;     // Extra seconds before expiring grace (default: 5s)
  staleSessionThreshold: number; // Consider session stale after N seconds (default: 3600s)
  enableOrphanCleanup: boolean;  // Clean up orphaned Redis keys (default: true)
}

export interface JanitorStats {
  lastRun: number;
  totalRuns: number;
  expiredGraceSessions: number;
  staleSessions: number;
  orphanedKeys: number;
  processedBatches: number;
  averageRunTime: number;
  errors: number;
}

const DEFAULT_CONFIG: JanitorConfig = {
  intervalSeconds: 60,           // 1 minute
  batchSize: 50,
  gracePeriodBuffer: 5,          // 5 seconds buffer
  staleSessionThreshold: 3600,   // 1 hour
  enableOrphanCleanup: true
};

export class SessionJanitor {
  private redis: Redis;
  private sessionService: SessionService;
  private config: JanitorConfig;
  private timer?: NodeJS.Timeout | undefined;
  private isRunning = false;
  private stats: JanitorStats;

  constructor(
    redis: Redis,
    sessionService: SessionService,
    config: Partial<JanitorConfig> = {}
  ) {
    this.redis = redis;
    this.sessionService = sessionService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.stats = {
      lastRun: 0,
      totalRuns: 0,
      expiredGraceSessions: 0,
      staleSessions: 0,
      orphanedKeys: 0,
      processedBatches: 0,
      averageRunTime: 0,
      errors: 0
    };
  }

  /**
   * Start the janitor with periodic cleanup
   */
  start(): void {
    if (this.timer) {
      console.warn('Session janitor is already running');
      return;
    }

    console.info(`Starting session janitor with ${this.config.intervalSeconds}s interval`);
    
    this.timer = setInterval(() => {
      this.runCleanup().catch(error => {
        console.error('Session janitor cleanup failed:', error);
        this.stats.errors++;
      });
    }, this.config.intervalSeconds * 1000);

    // Run initial cleanup
    this.runCleanup().catch(error => {
      console.error('Initial session janitor cleanup failed:', error);
      this.stats.errors++;
    });
  }

  /**
   * Stop the janitor
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      console.info('Session janitor stopped');
    }
  }

  /**
   * Run a single cleanup cycle
   */
  async runCleanup(): Promise<void> {
    if (this.isRunning) {
      console.debug('Cleanup already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.debug('Starting session janitor cleanup');

      // Phase 1: Clean expired grace periods
      await this.cleanExpiredGraceSessions();

      // Phase 2: Clean stale active sessions
      await this.cleanStaleSessions();

      // Phase 3: Clean orphaned queue entries
      await this.cleanOrphanedQueueEntries();

      // Phase 4: Clean orphaned Redis keys
      if (this.config.enableOrphanCleanup) {
        await this.cleanOrphanedKeys();
      }

      // Update statistics
      const runTime = Date.now() - startTime;
      this.stats.lastRun = startTime;
      this.stats.totalRuns++;
      this.stats.averageRunTime = (this.stats.averageRunTime * (this.stats.totalRuns - 1) + runTime) / this.stats.totalRuns;

      console.info(`Session janitor completed in ${runTime}ms`);
    } catch (error) {
      console.error('Session janitor cleanup error:', error);
      this.stats.errors++;
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean sessions in grace period that have expired
   */
  private async cleanExpiredGraceSessions(): Promise<void> {
    try {
      const now = Date.now();
      const expiredSessions = await this.sessionService.getExpiredGraceSessions();

      if (expiredSessions.length === 0) {
        return;
      }

      console.debug(`Found ${expiredSessions.length} expired grace sessions`);

      for (const sessionId of expiredSessions) {
        try {
          const session = await this.sessionService.getSession(sessionId);
          if (session && session.state === SessionState.GRACE) {
            // Check if truly expired (with buffer)
            const expiryWithBuffer = (session.graceExpiresAt || 0) + (this.config.gracePeriodBuffer * 1000);
            if (now > expiryWithBuffer) {
              await this.sessionService.terminateSession(sessionId, DisconnectReason.GRACE_EXPIRED);
              this.stats.expiredGraceSessions++;
              console.debug(`Terminated expired grace session: ${sessionId}`);
            }
          }
        } catch (error) {
          console.error(`Failed to clean grace session ${sessionId}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to clean expired grace sessions:', error);
    }
  }

  /**
   * Clean active sessions that haven't sent heartbeat recently
   */
  private async cleanStaleSessions(): Promise<void> {
    try {
      const now = Date.now();
      const staleThreshold = now - (this.config.staleSessionThreshold * 1000);

      // Get all instance keys
      const instancePattern = sessionKeys.byInstance('*');
      const instanceKeys = await this.redis.keys(instancePattern);

      for (const instanceKey of instanceKeys) {
        const sessionIds = await this.redis.smembers(instanceKey);
        
        for (let i = 0; i < sessionIds.length; i += this.config.batchSize) {
          const batch = sessionIds.slice(i, i + this.config.batchSize);
          
          for (const sessionId of batch) {
            try {
              const session = await this.sessionService.getSession(sessionId);
              
              if (session && session.state === SessionState.ACTIVE) {
                // Check if session is stale based on heartbeat
                if (session.lastHeartbeatAt < staleThreshold) {
                  await this.sessionService.terminateSession(sessionId, DisconnectReason.NETWORK);
                  this.stats.staleSessions++;
                  console.debug(`Terminated stale session: ${sessionId}`);
                }
              } else if (!session) {
                // Session data is missing, clean up references
                await this.cleanOrphanedSessionReferences(sessionId);
              }
            } catch (error) {
              console.error(`Failed to check session ${sessionId}:`, error);
            }
          }

          this.stats.processedBatches++;
        }
      }
    } catch (error) {
      console.error('Failed to clean stale sessions:', error);
    }
  }

  /**
   * Clean queue entries for sessions that no longer exist
   */
  private async cleanOrphanedQueueEntries(): Promise<void> {
    try {
      const queuePattern = queueKeys.byInstance('*');
      const queueKeys_ = await this.redis.keys(queuePattern);

      for (const queueKey of queueKeys_) {
        const queueEntries = await this.redis.zrange(queueKey, 0, -1);
        
        for (const characterId of queueEntries) {
          const sessionId = await this.redis.get(sessionKeys.byCharacter(characterId));
          
          if (!sessionId) {
            // Character has no active session, remove from queue
            await this.redis.zrem(queueKey, characterId);
            await this.redis.del(queueKeys.entry(characterId));
            this.stats.orphanedKeys++;
            console.debug(`Cleaned orphaned queue entry: ${characterId}`);
          }
        }
      }
    } catch (error) {
      console.error('Failed to clean orphaned queue entries:', error);
    }
  }

  /**
   * Clean orphaned Redis keys that may be left behind
   */
  private async cleanOrphanedKeys(): Promise<void> {
    try {
      // Clean expired session keys
      const sessionKeyPattern = sessionKeys.byId('*');
      const sessionKeys_ = await this.redis.keys(sessionKeyPattern);

      for (const sessionKey of sessionKeys_) {
        const ttl = await this.redis.ttl(sessionKey);
        if (ttl === -1) {
          // Key exists but has no expiry, set default TTL
          await this.redis.expire(sessionKey, 3600); // 1 hour default
        }
      }

      // Clean reconnection tokens without expiry
      const reconnectPattern = sessionKeys.reconnectionToken('*');
      const reconnectKeys = await this.redis.keys(reconnectPattern);

      for (const reconnectKey of reconnectKeys) {
        const ttl = await this.redis.ttl(reconnectKey);
        if (ttl === -1) {
          // Reconnection token should always have TTL
          await this.redis.del(reconnectKey);
          this.stats.orphanedKeys++;
        }
      }
    } catch (error) {
      console.error('Failed to clean orphaned keys:', error);
    }
  }

  /**
   * Clean references to a session that no longer exists
   */
  private async cleanOrphanedSessionReferences(sessionId: string): Promise<void> {
    try {
      // Find and clean session references
      const characterPattern = sessionKeys.byCharacter('*');
      const characterKeys = await this.redis.keys(characterPattern);

      for (const characterKey of characterKeys) {
        const linkedSessionId = await this.redis.get(characterKey);
        if (linkedSessionId === sessionId) {
          await this.redis.del(characterKey);
          this.stats.orphanedKeys++;
        }
      }

      // Clean from instance sets
      const instancePattern = sessionKeys.byInstance('*');
      const instanceKeys = await this.redis.keys(instancePattern);

      for (const instanceKey of instanceKeys) {
        const removed = await this.redis.srem(instanceKey, sessionId);
        if (removed > 0) {
          this.stats.orphanedKeys++;
        }
      }

      // Clean from grace period tracking across all instances
      const gracePattern = sessionKeys.grace('*', '*');
      const graceKeys = await this.redis.keys(gracePattern);
      
      for (const graceKey of graceKeys) {
        const removed = await this.redis.zrem(graceKey, sessionId);
        if (removed > 0) {
          this.stats.orphanedKeys++;
        }
      }
    } catch (error) {
      console.error(`Failed to clean orphaned references for ${sessionId}:`, error);
    }
  }

  /**
   * Force cleanup run (for testing/admin)
   */
  async forceCleanup(): Promise<void> {
    await this.runCleanup();
  }

  /**
   * Get janitor statistics
   */
  getStats(): JanitorStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      lastRun: 0,
      totalRuns: 0,
      expiredGraceSessions: 0,
      staleSessions: 0,
      orphanedKeys: 0,
      processedBatches: 0,
      averageRunTime: 0,
      errors: 0
    };
  }

  /**
   * Check if janitor is running
   */
  isActive(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Get configuration
   */
  getConfig(): JanitorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart)
   */
  updateConfig(newConfig: Partial<JanitorConfig>): void {
    const wasRunning = this.isActive();
    
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning) {
      this.start();
    }

    console.info('Session janitor configuration updated', this.config);
  }
}