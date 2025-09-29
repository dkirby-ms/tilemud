import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Rate limiter interface
interface RateLimiter {
  evaluate(channel: string, playerId: string): Promise<{ allowed: boolean; retryAfter?: number }>;
}

// Mock Redis operations for testing
interface MockRedisOps {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<void>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<void>;
  del: (key: string) => Promise<void>;
}

// Simple fixed-window rate limiter implementation
class FixedWindowRateLimiter implements RateLimiter {
  constructor(
    private redis: MockRedisOps,
    private limits: Record<string, { window: number; max: number }>
  ) {}

  async evaluate(channel: string, playerId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    const config = this.limits[channel];
    if (!config) {
      return { allowed: true };
    }

    const key = `rate:${playerId}:${channel}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / config.window) * config.window;
    const windowKey = `${key}:${windowStart}`;

    const current = await this.redis.get(windowKey);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= config.max) {
      const retryAfter = windowStart + config.window - now;
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    // Increment and set expiry
    await this.redis.incr(windowKey);
    if (count === 0) {
      await this.redis.expire(windowKey, config.window);
    }

    return { allowed: true };
  }
}

describe("Rate Limiter Logic", () => {
  let mockRedis: MockRedisOps;
  let rateLimiter: RateLimiter;
  let storage: Map<string, { value: string; expiresAt?: number }>;

  beforeEach(() => {
    storage = new Map();
    
    mockRedis = {
      async get(key: string) {
        const entry = storage.get(key);
        if (!entry) return null;
        if (entry.expiresAt && Date.now() / 1000 > entry.expiresAt) {
          storage.delete(key);
          return null;
        }
        return entry.value;
      },
      
      async set(key: string, value: string, options?: { EX?: number }) {
        const entry = { value, expiresAt: undefined as number | undefined };
        if (options?.EX) {
          entry.expiresAt = Math.floor(Date.now() / 1000) + options.EX;
        }
        storage.set(key, entry);
      },
      
      async incr(key: string) {
        const current = await this.get(key);
        const newValue = (current ? parseInt(current, 10) : 0) + 1;
        await this.set(key, newValue.toString());
        return newValue;
      },
      
      async expire(key: string, seconds: number) {
        const entry = storage.get(key);
        if (entry) {
          entry.expiresAt = Math.floor(Date.now() / 1000) + seconds;
        }
      },
      
      async del(key: string) {
        storage.delete(key);
      }
    };

    rateLimiter = new FixedWindowRateLimiter(mockRedis, {
      chat_in_instance: { window: 10, max: 20 },
      private_message: { window: 10, max: 10 },
      tile_action: { window: 1, max: 5 }
    });

    // Mock Date.now for predictable testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const playerId = "player-123";
    
    // First request should be allowed
    const result1 = await rateLimiter.evaluate("chat_in_instance", playerId);
    expect(result1.allowed).toBe(true);
    
    // Second request should also be allowed
    const result2 = await rateLimiter.evaluate("chat_in_instance", playerId);
    expect(result2.allowed).toBe(true);
  });

  it("rejects requests when limit exceeded", async () => {
    const playerId = "player-456";
    
    // Simulate 5 tile actions (at limit)
    for (let i = 0; i < 5; i++) {
      const result = await rateLimiter.evaluate("tile_action", playerId);
      expect(result.allowed).toBe(true);
    }
    
    // 6th request should be rejected
    const result = await rateLimiter.evaluate("tile_action", playerId);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("resets counter after window expires", async () => {
    const playerId = "player-789";
    
    // Use up the limit
    for (let i = 0; i < 5; i++) {
      await rateLimiter.evaluate("tile_action", playerId);
    }
    
    // Should be rejected
    let result = await rateLimiter.evaluate("tile_action", playerId);
    expect(result.allowed).toBe(false);
    
    // Advance time past the window (1 second)
    vi.advanceTimersByTime(2000);
    
    // Should be allowed again
    result = await rateLimiter.evaluate("tile_action", playerId);
    expect(result.allowed).toBe(true);
  });

  it("handles different channels independently", async () => {
    const playerId = "player-multi";
    
    // Use up tile_action limit
    for (let i = 0; i < 5; i++) {
      const result = await rateLimiter.evaluate("tile_action", playerId);
      expect(result.allowed).toBe(true);
    }
    
    // tile_action should be rejected
    const tileResult = await rateLimiter.evaluate("tile_action", playerId);
    expect(tileResult.allowed).toBe(false);
    
    // But chat should still be allowed
    const chatResult = await rateLimiter.evaluate("chat_in_instance", playerId);
    expect(chatResult.allowed).toBe(true);
  });

  it("handles different players independently", async () => {
    const player1 = "player-1";
    const player2 = "player-2";
    
    // Use up limit for player1
    for (let i = 0; i < 5; i++) {
      await rateLimiter.evaluate("tile_action", player1);
    }
    
    // player1 should be rejected
    const result1 = await rateLimiter.evaluate("tile_action", player1);
    expect(result1.allowed).toBe(false);
    
    // player2 should still be allowed
    const result2 = await rateLimiter.evaluate("tile_action", player2);
    expect(result2.allowed).toBe(true);
  });

  it("calculates correct retry-after for fixed windows", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    
    const playerId = "player-timing";
    
    // Use up the limit
    for (let i = 0; i < 5; i++) {
      await rateLimiter.evaluate("tile_action", playerId);
    }
    
    // Advance 500ms into the window
    vi.advanceTimersByTime(500);
    
    const result = await rateLimiter.evaluate("tile_action", playerId);
    expect(result.allowed).toBe(false);
    // Should suggest waiting until the next 1-second window
    expect(result.retryAfter).toBeLessThanOrEqual(1);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("handles unknown channels by allowing all requests", async () => {
    const result = await rateLimiter.evaluate("unknown_channel", "player-123");
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });
});