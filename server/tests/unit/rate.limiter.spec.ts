import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InMemorySlidingWindowStore, RateLimiterService } from "../../src/services/rateLimiter.js";

describe("Rate Limiter Logic", () => {
  let rateLimiter: RateLimiterService;

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = new RateLimiterService(
      { store: new InMemorySlidingWindowStore() },
      { clock: () => Date.now() }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const playerId = "player-123";

    const first = await rateLimiter.evaluate("chat_in_instance", playerId);
    const second = await rateLimiter.evaluate("chat_in_instance", playerId);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it("rejects requests when limit exceeded", async () => {
    const playerId = "player-456";

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const attempt = await rateLimiter.evaluate("tile_action", playerId);
      expect(attempt.allowed).toBe(true);
    }

    const result = await rateLimiter.evaluate("tile_action", playerId);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("resets counter after window expires", async () => {
    const playerId = "player-789";

    for (let iteration = 0; iteration < 5; iteration += 1) {
      await rateLimiter.evaluate("tile_action", playerId);
    }

    const blocked = await rateLimiter.evaluate("tile_action", playerId);
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(2_000);

    const allowedAgain = await rateLimiter.evaluate("tile_action", playerId);
    expect(allowedAgain.allowed).toBe(true);
  });

  it("handles different channels independently", async () => {
    const playerId = "player-multi";

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const attempt = await rateLimiter.evaluate("tile_action", playerId);
      expect(attempt.allowed).toBe(true);
    }

    const tileRejected = await rateLimiter.evaluate("tile_action", playerId);
    const chatAllowed = await rateLimiter.evaluate("chat_in_instance", playerId);

    expect(tileRejected.allowed).toBe(false);
    expect(chatAllowed.allowed).toBe(true);
  });

  it("handles different players independently", async () => {
    const player1 = "player-1";
    const player2 = "player-2";

    for (let iteration = 0; iteration < 5; iteration += 1) {
      await rateLimiter.evaluate("tile_action", player1);
    }

    const playerOneBlocked = await rateLimiter.evaluate("tile_action", player1);
    const playerTwoAllowed = await rateLimiter.evaluate("tile_action", player2);

    expect(playerOneBlocked.allowed).toBe(false);
    expect(playerTwoAllowed.allowed).toBe(true);
  });

  it("calculates correct retry-after for fixed windows", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const playerId = "player-timing";

    for (let iteration = 0; iteration < 5; iteration += 1) {
      await rateLimiter.evaluate("tile_action", playerId);
    }

    vi.advanceTimersByTime(500);

    const blocked = await rateLimiter.evaluate("tile_action", playerId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeLessThanOrEqual(1);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("handles unknown channels by allowing all requests", async () => {
    const result = await rateLimiter.evaluate("unknown_channel", "player-123");
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });
});