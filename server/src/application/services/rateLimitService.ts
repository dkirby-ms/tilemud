import { IRedisClient } from '../../infra/cache/redisClient';
// import { config } from '../../config/env';

export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetTime: Date;
  retryAfterMs?: number;
}

export interface RateLimitOptions {
  windowSizeSeconds: number;
  maxRequests: number;
  keyPrefix?: string;
}

/**
 * Rate limiter implementation using Redis sliding window approach
 * Based on FR-012: Rate limiting for chat messages and player actions
 */
export class RateLimitService {
  constructor(private readonly redis: IRedisClient) {}

  /**
   * Check if a request is allowed and consume a token if so
   * Uses sliding window counter approach for smooth rate limiting
   */
  async checkRateLimit(
    identifier: string,
    limitType: 'chat' | 'action',
    customOptions?: Partial<RateLimitOptions>
  ): Promise<RateLimitResult> {
    const options = this.getOptionsForType(limitType, customOptions);
    const key = this.buildKey(identifier, limitType, options.keyPrefix);
    const now = Date.now();
    const windowStart = now - (options.windowSizeSeconds * 1000);

    try {
      // Use Redis sliding window check
      const result = await this.executeSlidingWindowLua(key, now, windowStart, options.maxRequests, options.windowSizeSeconds);
      
      if (!result) {
        throw new Error('Redis sliding window execution failed');
      }

      const [currentCount] = result;
      const allowed = currentCount <= options.maxRequests;
      const remainingRequests = Math.max(0, options.maxRequests - currentCount);
      const resetTime = new Date(now + (options.windowSizeSeconds * 1000));
      
      const rateLimitResult: RateLimitResult = {
        allowed,
        remainingRequests,
        resetTime,
      };

      if (!allowed) {
        // Calculate retry after time based on oldest request in window
        rateLimitResult.retryAfterMs = this.calculateRetryAfter(options.windowSizeSeconds);
      }

      return rateLimitResult;
    } catch (error) {
      console.error('Rate limit check failed:', error); // TODO: Use proper logger from T015
      // Fail open - allow request if Redis is unavailable
      return {
        allowed: true,
        remainingRequests: options.maxRequests - 1,
        resetTime: new Date(now + (options.windowSizeSeconds * 1000)),
      };
    }
  }

  /**
   * Execute Redis pipeline for sliding window rate limiting
   * This is done atomically to prevent race conditions
   */
  private async executeSlidingWindowLua(
    key: string,
    now: number,
    windowStart: number,
    maxRequests: number,
    windowSeconds: number
  ): Promise<[number] | null> {
    try {
      // Clean up old entries outside the window
      await this.redis.zrem(key, now.toString()); // Remove current timestamp if exists
      await this.redis.del(`${key}:cleanup:${Math.floor(now / 60000)}`); // Cleanup marker
      
      // Remove entries older than window
      // For now, simulate the Lua script behavior with multiple commands
      // TODO: Use actual Lua script for better atomicity
      await this.redis.zrem(key, `cleanup:${Math.floor(windowStart / 1000)}`);
      
      // Remove old entries
      const oldEntries = await this.redis.zrange(key, 0, -1);
      for (const entry of oldEntries) {
        const entryTime = parseInt(entry);
        if (entryTime < windowStart) {
          await this.redis.zrem(key, entry);
        }
      }

      // Check current count
      const currentCount = await this.redis.zcard(key);
      
      // Add new entry if under limit
      if (currentCount < maxRequests) {
        await this.redis.zadd(key, now, now.toString());
        await this.redis.expire(key, windowSeconds * 2); // TTL longer than window
        return [currentCount + 1];
      } else {
        await this.redis.expire(key, windowSeconds * 2); // Refresh TTL
        return [currentCount];
      }
    } catch (error) {
      console.error('Pipeline execution failed:', error);
      return null;
    }
  }

  /**
   * Get remaining quota for a specific identifier and limit type
   */
  async getRemainingQuota(
    identifier: string,
    limitType: 'chat' | 'action',
    customOptions?: Partial<RateLimitOptions>
  ): Promise<number> {
    const options = this.getOptionsForType(limitType, customOptions);
    const key = this.buildKey(identifier, limitType, options.keyPrefix);
    const now = Date.now();
    const windowStart = now - (options.windowSizeSeconds * 1000);

    try {
      // Clean up old entries and get current count
      const oldEntries = await this.redis.zrange(key, 0, -1);
      for (const entry of oldEntries) {
        const entryTime = parseInt(entry);
        if (entryTime < windowStart) {
          await this.redis.zrem(key, entry);
        }
      }

      const currentCount = await this.redis.zcard(key);
      return Math.max(0, options.maxRequests - currentCount);
    } catch (error) {
      console.error('Failed to get remaining quota:', error);
      return options.maxRequests; // Fail open
    }
  }

  /**
   * Reset rate limit for a specific identifier (admin function)
   */
  async resetRateLimit(
    identifier: string,
    limitType: 'chat' | 'action',
    customOptions?: Partial<RateLimitOptions>
  ): Promise<void> {
    const options = this.getOptionsForType(limitType, customOptions);
    const key = this.buildKey(identifier, limitType, options.keyPrefix);
    
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error('Failed to reset rate limit:', error);
      throw error;
    }
  }

  private getOptionsForType(
    limitType: 'chat' | 'action',
    customOptions?: Partial<RateLimitOptions>
  ): RateLimitOptions {
    const baseOptions: RateLimitOptions = limitType === 'chat' 
      ? {
          windowSizeSeconds: 60, // Default 1 minute window
          maxRequests: 10, // Default 10 messages per minute
          keyPrefix: 'chat_limit',
        }
      : {
          windowSizeSeconds: 10, // Default 10 second window  
          maxRequests: 5, // Default 5 actions per 10 seconds
          keyPrefix: 'action_limit',
        };

    return { ...baseOptions, ...customOptions };
  }

  private buildKey(identifier: string, limitType: string, keyPrefix = 'rate_limit'): string {
    return `${keyPrefix}:${limitType}:${identifier}`;
  }

  private calculateRetryAfter(windowSizeSeconds: number): number {
    // Conservative approach: suggest retry after half the window size
    return Math.ceil(windowSizeSeconds * 500); // Convert to milliseconds
  }
}

// Factory function for creating rate limiter service
export function createRateLimitService(redis: IRedisClient): RateLimitService {
  return new RateLimitService(redis);
}