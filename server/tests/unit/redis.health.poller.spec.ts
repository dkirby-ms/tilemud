import { describe, expect, it, beforeEach, vi } from "vitest";
import { RedisHealthPoller } from "../../src/infra/redisHealthPoller.js";
import { DegradedSignalService, type DependencyStatusChange } from "../../src/services/degradedSignalService.js";

function createRedisMock(pingMock?: ReturnType<typeof vi.fn>) {
  const ping = pingMock ?? vi.fn();
  return {
    isOpen: true,
    ping
  } as unknown as Pick<import("redis").RedisClientType, "ping"> & { isOpen: boolean };
}

describe("RedisHealthPoller", () => {
  const baseTime = new Date("2025-01-01T00:00:00.000Z");
  let nowOffset = 0;
  const now = () => new Date(baseTime.getTime() + nowOffset);

  beforeEach(() => {
    nowOffset = 0;
  });

  it("records healthy status when ping succeeds", async () => {
    const pingMock = vi.fn().mockResolvedValue("PONG");
    const redis = createRedisMock(pingMock);
    const degraded = new DegradedSignalService({
      failureThreshold: 1,
      recoveryThreshold: 1,
      unavailableAfterFailures: 2,
      clock: now
    });
    const poller = new RedisHealthPoller({
      redis,
      degradedSignalService: degraded,
      now
    });

    const healthy = await poller.runOnce();

    expect(healthy).toBe(true);
    const state = degraded.get("redis");
    expect(state.status).toBe("available");
    expect(state.consecutiveSuccesses).toBe(1);
    expect(pingMock).toHaveBeenCalledTimes(1);
  });

  it("marks dependency degraded after a ping failure", async () => {
    const pingMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const redis = createRedisMock(pingMock);
    const degraded = new DegradedSignalService({
      failureThreshold: 1,
      recoveryThreshold: 1,
      unavailableAfterFailures: 2,
      clock: now
    });
    const changes: DependencyStatusChange[] = [];
    degraded.subscribe((change) => {
      changes.push(change);
    });

    const poller = new RedisHealthPoller({
      redis,
      degradedSignalService: degraded,
      now,
      timeoutMs: 500
    });

    const healthy = await poller.runOnce();

    expect(healthy).toBe(false);
    const state = degraded.get("redis");
    expect(state.status).toBe("degraded");
    expect(state.consecutiveFailures).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.status).toBe("degraded");
    expect(pingMock).toHaveBeenCalledTimes(1);
  });

  it("recovers after subsequent success", async () => {
    const pingMock = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("PONG");
    const redis = createRedisMock(pingMock);
    const degraded = new DegradedSignalService({
      failureThreshold: 1,
      recoveryThreshold: 1,
      unavailableAfterFailures: 2,
      clock: now
    });
    const changes: DependencyStatusChange[] = [];
    degraded.subscribe((change) => {
      changes.push(change);
    });

    const poller = new RedisHealthPoller({
      redis,
      degradedSignalService: degraded,
      now,
      timeoutMs: 500
    });

    await poller.runOnce(); // failure -> degraded
    const stateAfterFailure = degraded.get("redis");
    expect(stateAfterFailure.status).toBe("degraded");

    const healthy = await poller.runOnce();

    expect(healthy).toBe(true);
    const state = degraded.get("redis");
    expect(state.status).toBe("available");
    const statuses = changes.map((change) => change.status);
    expect(statuses).toEqual(["degraded", "recovered"]);
  });

  it("treats timeout as failure", async () => {
    const pingMock = vi.fn(() => new Promise(() => undefined));
    const redis = createRedisMock(pingMock);
    const degraded = new DegradedSignalService({
      failureThreshold: 1,
      recoveryThreshold: 1,
      unavailableAfterFailures: 2,
      clock: now
    });

    const poller = new RedisHealthPoller({
      redis,
      degradedSignalService: degraded,
      now,
      timeoutMs: 100
    });

    const healthy = await poller.runOnce();

    expect(healthy).toBe(false);
    const state = degraded.get("redis");
    expect(state.status).toBe("degraded");
    expect(pingMock).toHaveBeenCalledTimes(1);
  });
});
