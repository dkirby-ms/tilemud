/**
 * Queue management service using Redis sorted sets
 * Handles admission queue for instance capacity management
 */

import { Redis } from 'ioredis';
import { queueKeys, generateCorrelationId } from '../../../infra/persistence/redisKeys';
import { QueueEntry, QueueStatusResponse, AttemptOutcome } from '../../../domain/connection/types';

export interface QueueConfig {
  maxQueueSize: number;         // Maximum queue entries per instance (default: 100)
  positionUpdateInterval: number; // How often to recalculate positions (default: 5s)
  entryTimeoutSeconds: number;  // Queue entry TTL (default: 3600s = 1h)
  cleanupInterval: number;      // Background cleanup (default: 300s = 5min)
}

export interface QueueResult {
  outcome: AttemptOutcome;
  position?: number;
  queueDepth?: number;
  estimatedWaitSeconds?: number;
  entryId?: string;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxQueueSize: 100,
  positionUpdateInterval: 5,
  entryTimeoutSeconds: 60 * 60,    // 1 hour
  cleanupInterval: 5 * 60          // 5 minutes
};

export class QueueService {
  private redis: Redis;
  private config: QueueConfig;
  private cleanupTimer?: NodeJS.Timeout | undefined;

  constructor(redis: Redis, config: Partial<QueueConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Add user to instance queue
   */
  async enqueue(
    instanceId: string,
    characterId: string,
    userId: string,
    attemptId: string
  ): Promise<QueueResult> {
    const now = Date.now();
    const queueKey = queueKeys.byInstance(instanceId);
    const entryKey = queueKeys.entry(characterId);

    try {
      // Use Lua script for atomic queue operation
      const luaScript = `
        local queueKey = KEYS[1]
        local entryKey = KEYS[2]
        local characterId = ARGV[1]
        local userId = ARGV[2]
        local instanceId = ARGV[3]
        local attemptId = ARGV[4]
        local now = tonumber(ARGV[5])
        local maxQueueSize = tonumber(ARGV[6])
        local entryTTL = tonumber(ARGV[7])
        
        -- Check if character is already queued
        local existingScore = redis.call('ZSCORE', queueKey, characterId)
        if existingScore then
          -- Return existing position
          local position = redis.call('ZRANK', queueKey, characterId)
          local queueDepth = redis.call('ZCARD', queueKey)
          return {position, queueDepth, 'existing'}
        end
        
        -- Check queue capacity
        local currentSize = redis.call('ZCARD', queueKey)
        if currentSize >= maxQueueSize then
          return {-1, currentSize, 'full'}
        end
        
        -- Add to queue and store entry details
        redis.call('ZADD', queueKey, now, characterId)
        local entryData = cjson.encode({
          characterId = characterId,
          userId = userId,
          instanceId = instanceId,
          enqueuedAt = now,
          attemptId = attemptId
        })
        redis.call('SET', entryKey, entryData, 'EX', entryTTL)
        
        -- Return new position
        local position = redis.call('ZRANK', queueKey, characterId)
        local queueDepth = redis.call('ZCARD', queueKey)
        return {position, queueDepth, 'queued'}
      `;

      const result = await this.redis.eval(
        luaScript,
        2,
        queueKey,
        entryKey,
        characterId,
        userId,
        instanceId,
        attemptId,
        now.toString(),
        this.config.maxQueueSize.toString(),
        this.config.entryTimeoutSeconds.toString()
      ) as [number, number, string];

      const [position, queueDepth, status] = result;

      if (status === 'full') {
        return {
          outcome: AttemptOutcome.FAILED,
          queueDepth
        };
      }

      const estimatedWait = this.calculateEstimatedWait(position, queueDepth);

      return {
        outcome: AttemptOutcome.QUEUED,
        position,
        queueDepth,
        estimatedWaitSeconds: estimatedWait,
        entryId: generateCorrelationId()
      };
    } catch (error) {
      console.error('Queue enqueue failed:', error);
      throw new Error('Failed to enqueue user');
    }
  }

  /**
   * Get current queue position for character
   */
  async getPosition(instanceId: string, characterId: string): Promise<QueueStatusResponse | null> {
    try {
      const queueKey = queueKeys.byInstance(instanceId);
      
      const position = await this.redis.zrank(queueKey, characterId);
      if (position === null) {
        return null; // Not in queue
      }

      const queueDepth = await this.redis.zcard(queueKey);
      const estimatedWait = this.calculateEstimatedWait(position, queueDepth);

      return {
        position,
        depth: queueDepth,
        estimatedWaitSeconds: estimatedWait
      };
    } catch (error) {
      console.error('Failed to get queue position:', error);
      return null;
    }
  }

  /**
   * Promote next user from queue (called when capacity becomes available)
   */
  async promoteNext(instanceId: string): Promise<QueueEntry | null> {
    try {
      const queueKey = queueKeys.byInstance(instanceId);

      // Use Lua script for atomic promotion
      const luaScript = `
        local queueKey = KEYS[1]
        
        -- Get next character in queue (lowest score/earliest)
        local entries = redis.call('ZRANGE', queueKey, 0, 0, 'WITHSCORES')
        if #entries == 0 then
          return nil
        end
        
        local characterId = entries[1]
        local score = entries[2]
        
        -- Remove from queue
        redis.call('ZREM', queueKey, characterId)
        
        return {characterId, score}
      `;

      const result = await this.redis.eval(luaScript, 1, queueKey) as [string, number] | null;

      if (!result) {
        return null; // Queue is empty
      }

      const [characterId] = result;

      // Get entry details
      const entryKey = queueKeys.entry(characterId);
      const entryData = await this.redis.get(entryKey);
      
      if (!entryData) {
        console.warn(`Queue entry data missing for character ${characterId}`);
        return null;
      }

      // Clean up entry data
      await this.redis.del(entryKey);

      const entry: QueueEntry = JSON.parse(entryData);
      return entry;
    } catch (error) {
      console.error('Queue promotion failed:', error);
      throw new Error('Failed to promote from queue');
    }
  }

  /**
   * Remove character from queue (on user cancel or timeout)
   */
  async dequeue(instanceId: string, characterId: string): Promise<boolean> {
    try {
      const queueKey = queueKeys.byInstance(instanceId);
      const entryKey = queueKeys.entry(characterId);

      // Remove from both queue and entry storage
      const [queueRemoved] = await Promise.all([
        this.redis.zrem(queueKey, characterId),
        this.redis.del(entryKey)
      ]);

      return queueRemoved > 0;
    } catch (error) {
      console.error('Queue dequeue failed:', error);
      return false;
    }
  }

  /**
   * Get queue statistics for instance
   */
  async getQueueStats(instanceId: string): Promise<{
    depth: number;
    oldestEntry: number;
    averageWaitTime: number;
  }> {
    try {
      const queueKey = queueKeys.byInstance(instanceId);
      
      const [depth, oldestEntries] = await Promise.all([
        this.redis.zcard(queueKey),
        this.redis.zrange(queueKey, 0, 0, 'WITHSCORES')
      ]);

      const oldestEntry = oldestEntries.length > 0 ? 
        parseInt(oldestEntries[1] as string) : Date.now();

      const averageWaitTime = depth > 0 ? 
        Math.floor((Date.now() - oldestEntry) / depth) : 0;

      return {
        depth,
        oldestEntry,
        averageWaitTime: Math.floor(averageWaitTime / 1000) // Convert to seconds
      };
    } catch (error) {
      console.error('Failed to get queue stats:', error);
      return { depth: 0, oldestEntry: Date.now(), averageWaitTime: 0 };
    }
  }

  /**
   * Clear all entries for instance (admin function)
   */
  async clearQueue(instanceId: string): Promise<number> {
    try {
      const queueKey = queueKeys.byInstance(instanceId);
      
      // Get all characters in queue
      const characters = await this.redis.zrange(queueKey, 0, -1);
      
      // Remove entry data for all characters
      const entryKeys = characters.map(char => queueKeys.entry(char));
      if (entryKeys.length > 0) {
        await this.redis.del(...entryKeys);
      }
      
      // Clear the queue
      await this.redis.del(queueKey);
      
      return characters.length;
    } catch (error) {
      console.error('Failed to clear queue:', error);
      throw error;
    }
  }

  /**
   * Calculate estimated wait time based on position and historical data
   */
  private calculateEstimatedWait(position: number, queueDepth: number): number {
    // Simple estimation: assume 30 seconds average processing time per position
    // In production, this would use historical admission rate data
    const avgProcessingTimeSeconds = 30;
    const baseWait = position * avgProcessingTimeSeconds;
    
    // Add some variance based on queue depth (more congested = slower)
    const congestionFactor = Math.min(1.5, 1 + (queueDepth / 100));
    
    return Math.floor(baseWait * congestionFactor);
  }

  /**
   * Start background cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        console.error('Queue cleanup failed:', error);
      });
    }, this.config.cleanupInterval * 1000);
  }

  /**
   * Clean up expired queue entries
   */
  private async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      const expiryCutoff = now - (this.config.entryTimeoutSeconds * 1000);

      // Find all queue keys
      const queuePattern = queueKeys.byInstance('*');
      const queueKeys_ = await this.redis.keys(queuePattern);

      for (const queueKey of queueKeys_) {
        // Remove expired entries (older than timeout)
        const removedCount = await this.redis.zremrangebyscore(queueKey, 0, expiryCutoff);
        
        if (removedCount > 0) {
          console.info(`Cleaned up ${removedCount} expired queue entries from ${queueKey}`);
        }
      }

      // Clean up orphaned entry data
      const entryPattern = queueKeys.entry('*');
      const entryKeys = await this.redis.keys(entryPattern);
      
      for (const entryKey of entryKeys) {
        const ttl = await this.redis.ttl(entryKey);
        if (ttl === -1) { // No TTL set, remove it
          await this.redis.del(entryKey);
        }
      }
    } catch (error) {
      console.error('Queue cleanup error:', error);
    }
  }

  /**
   * Shutdown service and cleanup timer
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    // Final cleanup
    await this.cleanup();
  }

  /**
   * Get service statistics for monitoring
   */
  async getServiceStats(): Promise<{
    totalQueues: number;
    totalEntries: number;
    oldestQueue: string | null;
    averageQueueDepth: number;
  }> {
    try {
      const queuePattern = queueKeys.byInstance('*');
      const queueKeys_ = await this.redis.keys(queuePattern);
      
      if (queueKeys_.length === 0) {
        return {
          totalQueues: 0,
          totalEntries: 0,
          oldestQueue: null,
          averageQueueDepth: 0
        };
      }

      let totalEntries = 0;
      let oldestTime = Date.now();
      let oldestQueue = null;

      for (const queueKey of queueKeys_) {
        const depth = await this.redis.zcard(queueKey);
        totalEntries += depth;

        if (depth > 0) {
          const oldest = await this.redis.zrange(queueKey, 0, 0, 'WITHSCORES');
          if (oldest.length > 1) {
            const time = parseInt(oldest[1] as string);
            if (time < oldestTime) {
              oldestTime = time;
              oldestQueue = queueKey;
            }
          }
        }
      }

      return {
        totalQueues: queueKeys_.length,
        totalEntries,
        oldestQueue,
        averageQueueDepth: Math.floor(totalEntries / queueKeys_.length)
      };
    } catch (error) {
      console.error('Failed to get queue service stats:', error);
      return {
        totalQueues: 0,
        totalEntries: 0,
        oldestQueue: null,
        averageQueueDepth: 0
      };
    }
  }
}