// T050: Unit tests for rate limiter logic (FR-012)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimitService } from '../../src/application/services/rateLimitService';
import type { IRedisClient } from '../../src/infra/cache/redisClient';

describe('RateLimitService', () => {
  let mockRedis: IRedisClient;
  let rateLimitService: RateLimitService;

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      incr: vi.fn(),
      decr: vi.fn(),
      expire: vi.fn(),
      hset: vi.fn(),
      hget: vi.fn(),
      hgetall: vi.fn(),
      hdel: vi.fn(),
      zadd: vi.fn(),
      zrange: vi.fn(),
      zrem: vi.fn(),
      zcard: vi.fn(),
      ping: vi.fn(),
      flushall: vi.fn(),
      disconnect: vi.fn()
    };
    rateLimitService = new RateLimitService(mockRedis);
  });

  describe('checkRateLimit', () => {
    it('should allow first request within rate limit', async () => {
      // Mock Redis sorted set operations for sliding window
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(0); // No existing entries
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1); // Add new entry
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result = await rateLimitService.checkRateLimit('user123', 'chat');

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(19); // Chat limit is 20/10s, used 1
      expect(mockRedis.zadd).toHaveBeenCalled();
      expect(mockRedis.expire).toHaveBeenCalled();
    });

    it('should allow requests within chat rate limit (20 per 10 seconds)', async () => {
      // Mock current count at 19 (under limit)
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(19);
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result = await rateLimitService.checkRateLimit('user123', 'chat');

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(0); // 20 - 20 = 0
      expect(mockRedis.zadd).toHaveBeenCalled();
    });

    it('should deny requests over chat rate limit', async () => {
      // Mock current count at limit (20)
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(20);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result = await rateLimitService.checkRateLimit('user123', 'chat');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfterMs).toBeDefined();
      expect(mockRedis.zadd).not.toHaveBeenCalled(); // Should not add when over limit
    });

    it('should allow requests within action rate limit (60 per 10 seconds)', async () => {
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(59);
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result = await rateLimitService.checkRateLimit('user456', 'action');

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(0); // 60 - 60 = 0
    });

    it('should deny requests over action rate limit', async () => {
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(60);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result = await rateLimitService.checkRateLimit('user456', 'action');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfterMs).toBeDefined();
    });

    it('should handle different users independently', async () => {
      // User1 at limit
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(20);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result1 = await rateLimitService.checkRateLimit('user1', 'chat');

      // User2 first request - reset mocks
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(0);
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result2 = await rateLimitService.checkRateLimit('user2', 'chat');

      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(true);
    });

    it('should handle Redis errors gracefully', async () => {
      vi.mocked(mockRedis.zrem).mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await rateLimitService.checkRateLimit('user123', 'chat');

      // Should allow request when Redis fails (fail open)
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBeGreaterThan(0);
    });

    it('should clean up old entries from sliding window', async () => {
      const now = Date.now();
      const oldTimestamp = now - 15000; // 15 seconds ago (outside 10s window)
      const recentTimestamp = now - 5000; // 5 seconds ago (inside window)

      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([
        oldTimestamp.toString(),
        recentTimestamp.toString()
      ]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(1); // After cleanup
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      await rateLimitService.checkRateLimit('user123', 'chat');

      // Should remove old entry
      expect(mockRedis.zrem).toHaveBeenCalledWith(
        expect.any(String),
        oldTimestamp.toString()
      );
      // Should not remove recent entry
      expect(mockRedis.zrem).not.toHaveBeenCalledWith(
        expect.any(String),
        recentTimestamp.toString()
      );
    });

    it('should set proper TTL for rate limit keys', async () => {
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(0);
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      await rateLimitService.checkRateLimit('newuser', 'action');

      // TTL should be 2x window size (20 seconds for 10s window)
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('action:newuser'),
        20
      );
    });
  });

  describe('custom rate limits', () => {
    it('should support custom rate limit options', async () => {
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(4);
      vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const customOptions = {
        windowSizeSeconds: 30,
        maxRequests: 5,
        keyPrefix: 'custom'
      };

      const result = await rateLimitService.checkRateLimit(
        'user123',
        'chat',
        customOptions
      );

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(0); // 5 - 5 = 0
    });
  });

  describe('sliding window behavior', () => {
    it('should correctly calculate remaining requests', async () => {
      const testCases = [
        { current: 1, expected: 19, limitType: 'chat' as const },
        { current: 10, expected: 10, limitType: 'chat' as const },
        { current: 19, expected: 0, limitType: 'chat' as const }, // After increment becomes 20
        { current: 30, expected: 30, limitType: 'action' as const },
        { current: 59, expected: 0, limitType: 'action' as const } // After increment becomes 60
      ];

      for (const testCase of testCases) {
        // Reset mocks for each test
        vi.clearAllMocks();
        
        vi.mocked(mockRedis.zrem).mockResolvedValue(0);
        vi.mocked(mockRedis.del).mockResolvedValue(0);
        vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
        vi.mocked(mockRedis.zcard).mockResolvedValueOnce(testCase.current);
        vi.mocked(mockRedis.zadd).mockResolvedValueOnce(1);
        vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

        const result = await rateLimitService.checkRateLimit('user', testCase.limitType);
        
        expect(result.allowed).toBe(true);
        expect(result.remainingRequests).toBe(testCase.expected);
      }
    });

    it('should handle boundary conditions correctly', async () => {
      // Test at exact limit
      vi.mocked(mockRedis.zrem).mockResolvedValue(0);
      vi.mocked(mockRedis.del).mockResolvedValue(0);
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(20); // At chat limit
      vi.mocked(mockRedis.expire).mockResolvedValueOnce(true);

      const result = await rateLimitService.checkRateLimit('user', 'chat');
      
      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(mockRedis.zadd).not.toHaveBeenCalled(); // Should not add when at limit
    });
  });

  describe('getRemainingQuota', () => {
    it('should return remaining quota without consuming', async () => {
      vi.mocked(mockRedis.zrange).mockResolvedValueOnce([]);
      vi.mocked(mockRedis.zcard).mockResolvedValueOnce(5);

      const result = await rateLimitService.getRemainingQuota('user123', 'chat');

      expect(result).toBe(15); // 20 - 5 = 15
      expect(mockRedis.zadd).not.toHaveBeenCalled(); // Should not consume quota
    });
  });
});