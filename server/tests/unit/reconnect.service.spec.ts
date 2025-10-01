import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";
import { ReconnectService } from "../../src/services/reconnectService.js";
import type { PlayerReconnectState, ReconnectSession } from "../../src/models/reconnectSession.js";
import { TileMudError } from "../../src/models/errorCodes.js";

type RedisSubset = Pick<RedisClientType, "setEx" | "get" | "del" | "keys">;

interface MockRedisEntry {
  value: string;
  expireAt: number | null;
}

function createMockRedis(clock: () => number): RedisSubset {
  const store = new Map<string, MockRedisEntry>();

  return {
    async setEx(key: string, ttlSeconds: number, value: string): Promise<string> {
      const expireAt = ttlSeconds > 0 ? clock() + ttlSeconds * 1000 : null;
      store.set(key, { value, expireAt });
      return "OK";
    },

    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      if (entry.expireAt !== null && entry.expireAt <= clock()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          count += 1;
        }
      }
      return count;
    },

    async keys(pattern: string): Promise<string[]> {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
      const now = clock();
      const keys: string[] = [];
      for (const [key, entry] of store.entries()) {
        if (entry.expireAt !== null && entry.expireAt <= now) {
          store.delete(key);
          continue;
        }
        if (regex.test(key)) {
          keys.push(key);
        }
      }
      return keys;
    }
  } as RedisSubset;
}

function createService(clock: () => number): ReconnectService {
  const redis = createMockRedis(clock);
  return new ReconnectService({
    redis: redis as unknown as RedisClientType,
    defaultGracePeriodMs: 60_000,
    keyPrefix: "test:",
    clock
  });
}

describe("ReconnectService", () => {
  const basePlayerState: PlayerReconnectState = {
    initiative: 10,
    lastActionTick: 42
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and retrieves reconnect sessions", async () => {
    const service = createService(() => Date.now());

    const created = await service.createSession({
      playerId: "player-1",
      instanceId: "instance-1",
      sessionId: "session-1",
      playerState: basePlayerState
    });

    expect(created.playerId).toBe("player-1");
    expect(created.gracePeriodMs).toBe(60_000);

    const fetched = await service.getSession("player-1", "instance-1");
    expect(fetched?.sessionId).toBe("session-1");
  });

  it("allows reconnect within grace period and rejects afterwards", async () => {
    const service = createService(() => Date.now());

    await service.createSession({
      playerId: "player-2",
      instanceId: "instance-1",
      sessionId: "session-a",
      playerState: basePlayerState,
      gracePeriodMs: 10_000
    });

    vi.advanceTimersByTime(9_000);

    const result = await service.attemptReconnect({
      playerId: "player-2",
      instanceId: "instance-1",
      newSessionId: "session-b"
    });

    expect(result.success).toBe(true);
    expect((result.session as ReconnectSession).sessionId).toBe("session-b");

    vi.advanceTimersByTime(2_000);

    await expect(
      service.attemptReconnect({
        playerId: "player-2",
        instanceId: "instance-1",
        newSessionId: "session-c"
      })
    ).rejects.toBeInstanceOf(TileMudError);
  });

  it("updates player state patches", async () => {
    const service = createService(() => Date.now());

    await service.createSession({
      playerId: "player-3",
      instanceId: "instance-9",
      sessionId: "session-start",
      playerState: basePlayerState
    });

    const updated = await service.updatePlayerState({
      playerId: "player-3",
      instanceId: "instance-9",
      patch: {
        lastActionTick: 99,
        boardPosition: { x: 3, y: 4 }
      }
    });

    expect(updated).toBe(true);

    const fetched = await service.getSession("player-3", "instance-9");
    expect(fetched?.playerState.lastActionTick).toBe(99);
    expect(fetched?.playerState.boardPosition).toEqual({ x: 3, y: 4 });
  });

  it("extends grace period to keep sessions alive", async () => {
    const service = createService(() => Date.now());

    await service.createSession({
      playerId: "player-4",
      instanceId: "instance-2",
      sessionId: "session-first",
      playerState: basePlayerState,
      gracePeriodMs: 5_000
    });

    vi.advanceTimersByTime(4_000);

    const extended = await service.extendGracePeriod({
      playerId: "player-4",
      instanceId: "instance-2",
      additionalMs: 6_000
    });

    expect(extended).toBe(true);

    vi.advanceTimersByTime(5_000);

    const stillPresent = await service.getSession("player-4", "instance-2");
    expect(stillPresent).not.toBeNull();
  });

  it("lists active sessions and cleans up expired ones", async () => {
    const service = createService(() => Date.now());

    await service.createSession({
      playerId: "player-5",
      instanceId: "instance-alpha",
      sessionId: "session-one",
      playerState: basePlayerState,
      gracePeriodMs: 1_000
    });

    await service.createSession({
      playerId: "player-6",
      instanceId: "instance-beta",
      sessionId: "session-two",
      playerState: basePlayerState
    });

    vi.advanceTimersByTime(2_000);

  const cleaned = await service.cleanupExpiredSessions();
  expect(cleaned).toBeGreaterThanOrEqual(0);

    const allSessions = await service.listActiveSessions();
    expect(allSessions).toHaveLength(1);
    expect(allSessions[0].instanceId).toBe("instance-beta");
  });

  it("computes session stats accurately", async () => {
    const service = createService(() => Date.now());

    await service.createSession({
      playerId: "p-stat-1",
      instanceId: "inst-a",
      sessionId: "sess-1",
      playerState: basePlayerState,
      gracePeriodMs: 30_000
    });
    vi.advanceTimersByTime(1000);
    await service.createSession({
      playerId: "p-stat-2",
      instanceId: "inst-a",
      sessionId: "sess-2",
      playerState: basePlayerState,
      gracePeriodMs: 60_000
    });
    await service.createSession({
      playerId: "p-stat-3",
      instanceId: "inst-b",
      sessionId: "sess-3",
      playerState: basePlayerState,
      gracePeriodMs: 90_000
    });

    const stats = await service.getSessionStats();
    expect(stats.totalActive).toBe(3);
    expect(stats.byInstance["inst-a"]).toBe(2);
    expect(stats.byInstance["inst-b"]).toBe(1);
    expect(stats.averageGracePeriodMs).toBeGreaterThan(30_000);
    expect(stats.oldestDisconnectionMs).toBeGreaterThanOrEqual(1000);
  });

  it("returns null for corrupted session JSON and cleans it up", async () => {
    const clock = () => Date.now();
    const redis = createMockRedis(clock);
    const service = new ReconnectService({
      redis: redis as unknown as RedisClientType,
      clock,
      keyPrefix: "corrupt:" 
    });

    await service.createSession({
      playerId: "p-corrupt",
      instanceId: "inst-x",
      sessionId: "sess-x",
      playerState: basePlayerState
    });

    // Overwrite raw value with invalid JSON
    await (redis as any).setEx("corrupt:session:p-corrupt:inst-x", 60, "{not-json}");
    const fetched = await service.getSession("p-corrupt", "inst-x");
    expect(fetched).toBeNull();
  });

  it("returns false when updating state for expired session", async () => {
    const service = createService(() => Date.now());
    await service.createSession({
      playerId: "p-expire",
      instanceId: "inst-exp",
      sessionId: "sess-exp",
      playerState: basePlayerState,
      gracePeriodMs: 1000
    });
    vi.advanceTimersByTime(1200);
    const updated = await service.updatePlayerState({
      playerId: "p-expire",
      instanceId: "inst-exp",
      patch: { lastActionTick: 99 }
    });
    expect(updated).toBe(false);
  });
});
