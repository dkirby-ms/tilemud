import { describe, expect, it, beforeEach, vi } from "vitest";
import { PlayerSessionStore } from "../../src/models/playerSession.js";
import { ActionSequenceService } from "../../src/services/actionSequenceService.js";
import type { MetricsService } from "../../src/services/metricsService.js";

function createStoreWithSession(sequence = 0): PlayerSessionStore {
  const store = new PlayerSessionStore();
  store.createOrUpdateSession({
    sessionId: "session-1",
    userId: "user-1",
    characterId: "character-1",
    protocolVersion: "1.0.0",
    status: "active",
    initialSequenceNumber: sequence,
    heartbeatAt: new Date("2025-01-01T00:00:00.000Z")
  });
  return store;
}

describe("ActionSequenceService", () => {
  const baseTime = new Date("2025-01-01T00:00:00.000Z");
  let timeOffset = 0;
  const now = () => new Date(baseTime.getTime() + timeOffset);
  let metrics: Pick<MetricsService, "recordForcedStateRefresh">;

  beforeEach(() => {
    timeOffset = 0;
    metrics = {
      recordForcedStateRefresh: vi.fn()
    };
  });

  it("returns missing_session when session is not found and schedules snapshot", () => {
    const sessions = new PlayerSessionStore();
    const service = new ActionSequenceService(sessions, { metrics: metrics as MetricsService, now });

    const result = service.evaluate({ sessionId: "missing", sequence: 1 });

    expect(result.status).toBe("missing_session");
    expect(result.requiresFullResync).toBe(true);
    expect(service.hasPendingSnapshot("missing")).toBe(true);
    expect(metrics.recordForcedStateRefresh).toHaveBeenCalledTimes(1);
  });

  it("accepts sequential actions and acknowledges them", () => {
    const sessions = createStoreWithSession(1);
    const service = new ActionSequenceService(sessions, { now });

    const evaluation = service.evaluate({ sessionId: "session-1", sequence: 2 });
    expect(evaluation.status).toBe("accept");
    const updated = service.acknowledge({ sessionId: "session-1", sequence: 2 });
    expect(updated?.lastSequenceNumber).toBe(2);
  });

  it("flags gaps, records metrics once, and supports snapshot consumption", () => {
    const sessions = createStoreWithSession(2);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now,
      pendingSnapshotTtlMs: 10_000
    });

    const gapResult = service.evaluate({ sessionId: "session-1", sequence: 5 });
    expect(gapResult.status).toBe("gap");
    expect(service.hasPendingSnapshot("session-1")).toBe(true);

    // Second evaluation without consuming should not increment metrics again.
    service.evaluate({ sessionId: "session-1", sequence: 6 });
    expect(metrics.recordForcedStateRefresh).toHaveBeenCalledTimes(1);

    const pending = service.consumePendingSnapshot("session-1");
    expect(pending?.sequence).toBe(5);
    expect(service.hasPendingSnapshot("session-1")).toBe(false);
  });

  it("expires pending snapshots after configured TTL", () => {
    const sessions = createStoreWithSession(3);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now,
      pendingSnapshotTtlMs: 5_000
    });

    service.evaluate({ sessionId: "session-1", sequence: 10 });
    expect(service.hasPendingSnapshot("session-1")).toBe(true);

    timeOffset = 6_000;
    expect(service.hasPendingSnapshot("session-1")).toBe(false);
    expect(metrics.recordForcedStateRefresh).toHaveBeenCalledTimes(1);
  });
});
