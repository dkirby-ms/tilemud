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

  it("rejects invalid sequences without scheduling snapshots", () => {
    const sessions = createStoreWithSession(3);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now
    });

    const negative = service.evaluate({ sessionId: "session-1", sequence: -1 });
    expect(negative.status).toBe("invalid");
    expect(service.hasPendingSnapshot("session-1")).toBe(false);

    const fractional = service.evaluate({ sessionId: "session-1", sequence: 2.5 });
    expect(fractional.status).toBe("invalid");
    expect(service.hasPendingSnapshot("session-1")).toBe(false);

    expect(metrics.recordForcedStateRefresh).not.toHaveBeenCalled();
  });

  it("notifies subscribed listeners when scheduling full snapshot requests", () => {
    const sessions = createStoreWithSession(2);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now
    });

    const requests: Array<{ sessionId: string; status: string; sequence: number }> = [];
    service.subscribeToSnapshotRequests((request) => {
      requests.push({ sessionId: request.sessionId, status: request.status, sequence: request.sequence });
    });

    service.evaluate({ sessionId: "session-1", sequence: 5 });
    service.evaluate({ sessionId: "session-1", sequence: 5 });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ sessionId: "session-1", status: "gap", sequence: 5 });
  });

  it("does not emit duplicate notifications for refreshed scheduling windows", () => {
    const sessions = createStoreWithSession(2);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now
    });

    const requests: number[] = [];
    service.subscribeToSnapshotRequests((request) => {
      requests.push(request.sequence);
    });

    service.evaluate({ sessionId: "session-1", sequence: 5 });
    service.evaluate({ sessionId: "session-1", sequence: 6 });

    expect(requests).toEqual([5]);
  });

  it("flags out-of-order sequences without scheduling snapshots", () => {
    const sessions = createStoreWithSession(5);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now
    });

    const evaluation = service.evaluate({ sessionId: "session-1", sequence: 4 });

    expect(evaluation.status).toBe("out_of_order");
    expect(evaluation.requiresFullResync).toBe(false);
    expect(service.hasPendingSnapshot("session-1")).toBe(false);
    expect(metrics.recordForcedStateRefresh).not.toHaveBeenCalled();
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

  it("acknowledge clears pending snapshot state and updates session", () => {
    const sessions = createStoreWithSession(2);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now
    });

    service.evaluate({ sessionId: "session-1", sequence: 6 });
    expect(service.hasPendingSnapshot("session-1")).toBe(true);

    const acked = service.acknowledge({ sessionId: "session-1", sequence: 6 });
    expect(acked?.lastSequenceNumber).toBe(6);
    expect(service.hasPendingSnapshot("session-1")).toBe(false);
  });

  it("resetSequence normalizes sequences and clears pending snapshots", () => {
    const sessions = createStoreWithSession(5);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now
    });

    service.evaluate({ sessionId: "session-1", sequence: 12 });
    expect(service.hasPendingSnapshot("session-1")).toBe(true);

    const reset = service.resetSequence("session-1", 3.7);
    expect(reset?.lastSequenceNumber).toBe(3);
    expect(service.getLastSequence("session-1")).toBe(3);
    expect(service.hasPendingSnapshot("session-1")).toBe(false);
  });

  it("returns null when consuming expired snapshots", () => {
    const sessions = createStoreWithSession(2);
    const service = new ActionSequenceService(sessions, {
      metrics: metrics as MetricsService,
      now,
      pendingSnapshotTtlMs: 2_000
    });

    service.evaluate({ sessionId: "session-1", sequence: 8 });
    expect(service.hasPendingSnapshot("session-1")).toBe(true);

    timeOffset = 3_000;
    const consumed = service.consumePendingSnapshot("session-1");
    expect(consumed).toBeNull();
    expect(service.hasPendingSnapshot("session-1")).toBe(false);
  });
});
