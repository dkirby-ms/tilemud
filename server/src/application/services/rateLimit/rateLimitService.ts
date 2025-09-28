/**
 * Rate limiting service using Redis sliding window algorithm
 * Prevents abuse by limiting admission attempts per user
 */

import { Redis } from 'ioredis';
import { rateLimitKeys } from '../../../infra/persistence/redisKeys';
import { RateLimitRecord } from '../../../domain/connection/types';

export interface RateLimitConfig {
  maxFailures: number;        // Max failures in window (default: 5)
  windowSeconds: number;      // Sliding window size (default: 900 = 15min)
  lockoutSeconds: number;     // Lockout duration (default: 300 = 5min)
  cleanupInterval: number;    // Background cleanup (default: 3600 = 1h)
}

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts?: number;
  resetTimeSeconds?: number;
  lockedUntil?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxFailures: 5,
  windowSeconds: 15 * 60,     // 15 minutes
  lockoutSeconds: 5 * 60,     // 5 minutes
  cleanupInterval: 60 * 60    // 1 hour
};

export class RateLimitService {
  private redis: Redis;
  private config: RateLimitConfig;
  private cleanupTimer?: NodeJS.Timeout | undefined;

  constructor(redis: Redis, config: Partial<RateLimitConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Check if user is rate limited for admission attempts
   */
  async checkRateLimit(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const lockoutKey = rateLimitKeys.lockout(userId);
    
    try {
      // Check if user is currently locked out
      const lockedUntil = await this.redis.get(lockoutKey);
      if (lockedUntil && parseInt(lockedUntil) > now) {
        return {
          allowed: false,
          lockedUntil: parseInt(lockedUntil),
          resetTimeSeconds: Math.ceil((parseInt(lockedUntil) - now) / 1000)
        };
      }

      // Get current failure count in sliding window
      const failureCount = await this.getFailureCount(userId);
      
      const remainingAttempts = Math.max(0, this.config.maxFailures - failureCount);
      
      return {
        allowed: remainingAttempts > 0,
        remainingAttempts,
        resetTimeSeconds: this.config.windowSeconds
      };
    } catch (error) {
      // Log error but allow request on Redis failure
      console.error('Rate limit check failed:', error);
      return { allowed: true };
    }
  }

  /**
   * Record a failed admission attempt
   */
  async recordFailure(userId: string): Promise<void> {
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const windowStart = nowSeconds - this.config.windowSeconds;

    try {
      // Use Lua script for atomic sliding window update
      const luaScript = `
        local userId = ARGV[1]
        local nowSeconds = tonumber(ARGV[2])
        local windowStart = tonumber(ARGV[3])
        local maxFailures = tonumber(ARGV[4])
        local lockoutSeconds = tonumber(ARGV[5])
        local windowTTL = tonumber(ARGV[6])
        
        -- Clean old entries and add current failure
        local windowKey = 'ratelimit:window:' .. userId
        redis.call('ZREMRANGEBYSCORE', windowKey, 0, windowStart)
        redis.call('ZADD', windowKey, nowSeconds, nowSeconds)
        redis.call('EXPIRE', windowKey, windowTTL)
        
        -- Count failures in window
        local failureCount = redis.call('ZCARD', windowKey)
        
        -- Apply lockout if threshold exceeded
        if failureCount >= maxFailures then
          local lockoutUntil = nowSeconds + lockoutSeconds
          local lockoutKey = 'ratelimit:lock:' .. userId
          redis.call('SET', lockoutKey, lockoutUntil, 'EX', lockoutSeconds)
          return {failureCount, lockoutUntil}
        end
        
        return {failureCount, 0}
      `;

      const result = await this.redis.eval(
        luaScript,
        0,
        userId,
        nowSeconds.toString(),
        windowStart.toString(),
        this.config.maxFailures.toString(),
        this.config.lockoutSeconds.toString(),
        this.config.windowSeconds.toString()
      ) as [number, number];

      const [failureCount, lockoutUntil] = result;

      // Log rate limit events for monitoring
      if (lockoutUntil > 0) {
        console.warn(`User ${userId} locked out until ${new Date(lockoutUntil * 1000).toISOString()} (${failureCount} failures)`);
      }
    } catch (error) {
      console.error('Failed to record rate limit failure:', error);
      throw new Error('Redis sliding window execution failed');
    }
  }

  /**
   * Reset rate limit for user (admin function)
   */
  async resetRateLimit(userId: string): Promise<void> {
    try {
      // Create pattern for user's window keys
      const windowPattern = rateLimitKeys.window(userId, 0).replace(':0', ':*');
      const lockoutKey = rateLimitKeys.lockout(userId);
      
      // Remove all window entries and lockout
      const keys = await this.redis.keys(windowPattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      await this.redis.del(lockoutKey);
    } catch (error) {
      console.error('Failed to reset rate limit:', error);
      throw error;
    }
  }

  /**
   * Get current rate limit status for user
   */
  async getRateLimitStatus(userId: string): Promise<RateLimitRecord> {
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const windowStart = nowSeconds - this.config.windowSeconds;

    try {
      const failureCount = await this.getFailureCount(userId);
      const lockoutKey = rateLimitKeys.lockout(userId);
      const lockedUntil = await this.redis.get(lockoutKey);

      return {
        userId,
        windowStart: windowStart * 1000,
        failures: failureCount,
        ...(lockedUntil ? { lockedUntil: parseInt(lockedUntil) * 1000 } : {})
      };
    } catch (error) {
      console.error('Failed to get rate limit status:', error);
      throw error;
    }
  }

  /**
   * Get failure count in sliding window
   */
  private async getFailureCount(userId: string): Promise<number> {
    try {
      // Use pattern matching to find all window keys for this user
      const pattern = rateLimitKeys.window(userId, 0).replace(':0', ':*');
      const keys = await this.redis.keys(pattern);
      
      if (keys.length === 0) return 0;

      // Count failures across all window segments
      let totalFailures = 0;
      for (const key of keys) {
        const count = await this.redis.zcard(key);
        totalFailures += count;
      }

      return totalFailures;
    } catch (error) {
      console.error('Failed to get failure count:', error);
      return 0;
    }
  }

  /**
   * Start background cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        console.error('Rate limit cleanup failed:', error);
      });
    }, this.config.cleanupInterval * 1000);
  }

  /**
   * Clean up expired rate limit data
   */
  private async cleanup(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - this.config.windowSeconds * 2; // Double window for safety

      // Find all rate limit window keys using pattern matching
      const windowPattern = rateLimitKeys.window('dummy', 0).replace('dummy:0', '*:*');
      const windowKeys = await this.redis.keys(windowPattern);
      
      for (const key of windowKeys) {
        // Remove old entries from sorted sets
        await this.redis.zremrangebyscore(key, 0, cutoff);
        
        // Remove empty keys
        const count = await this.redis.zcard(key);
        if (count === 0) {
          await this.redis.del(key);
        }
      }

      // Cleanup expired lockouts (Redis should handle this via TTL, but double-check)
      const lockoutKeys = await this.redis.keys(rateLimitKeys.lockout('*'));
      for (const key of lockoutKeys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) { // No TTL set, remove
          await this.redis.del(key);
        }
      }
    } catch (error) {
      console.error('Rate limit cleanup error:', error);
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
  async getStatistics(): Promise<{
    totalUsers: number;
    activelyLimited: number;
    totalFailures: number;
  }> {
    try {
      const windowPattern = rateLimitKeys.window('dummy', 0).replace('dummy:0', '*:*');
      const windowKeys = await this.redis.keys(windowPattern);
      const lockoutKeys = await this.redis.keys(rateLimitKeys.lockout('*').replace('*', '*'));
      
      let totalFailures = 0;
      const uniqueUsers = new Set<string>();

      for (const key of windowKeys) {
        const count = await this.redis.zcard(key);
        totalFailures += count;
        
        // Extract userId from key pattern
        const parts = key.split(':');
        if (parts.length >= 3 && parts[2]) {
          uniqueUsers.add(parts[2]);
        }
      }

      return {
        totalUsers: uniqueUsers.size,
        activelyLimited: lockoutKeys.length,
        totalFailures
      };
    } catch (error) {
      console.error('Failed to get rate limit statistics:', error);
      return { totalUsers: 0, activelyLimited: 0, totalFailures: 0 };
    }
  }
}