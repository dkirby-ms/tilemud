import { beforeEach, describe, expect, it } from "vitest";
import { MetricsService } from "../../src/services/metricsService.js";
import { resetMetrics } from "../../src/infra/metrics.js";

describe("MetricsService", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("tracks counters and computes availability ratios", () => {
    const service = new MetricsService();

    service.recordConnectAttempt();
    service.recordConnectSuccess();
    service.recordReconnectAttempt();
    service.recordReconnectSuccess();
    service.recordVersionReject();

    const snapshot = service.getSnapshot();

    expect(snapshot.counters.connect_attempts_total).toBe(1);
    expect(snapshot.counters.connect_success_total).toBe(1);
    expect(snapshot.counters.reconnect_attempts_total).toBe(1);
    expect(snapshot.counters.reconnect_success_total).toBe(1);
    expect(snapshot.counters.version_reject_total).toBe(1);
    expect(snapshot.availability.connectSuccessRate).toBe(1);
    expect(snapshot.availability.reconnectSuccessRate).toBe(1);
  });

  it("clamps cache hit ratio and active session gauges", () => {
    const service = new MetricsService();

    service.updateCacheHitRatio(1.5);
    service.setActiveSessions(-5);

    const snapshot = service.getSnapshot();

    expect(snapshot.gauges.cache_hit_ratio).toBe(1);
    expect(snapshot.gauges.active_sessions_gauge).toBe(0);

    service.updateCacheHitRatio(-0.5);
    service.setActiveSessions(3.8);
    const updated = service.getSnapshot();
    expect(updated.gauges.cache_hit_ratio).toBe(0);
    expect(updated.gauges.active_sessions_gauge).toBe(3);
  });

  it("records latency histogram percentiles", () => {
    const service = new MetricsService();

    service.observeActionLatency(50);
    service.observeActionLatency(100);
    service.observeActionLatency(200);
    service.observeActionLatency(400);

    const snapshot = service.getSnapshot();

    expect(snapshot.latency.p50).toBeGreaterThanOrEqual(50);
    expect(snapshot.latency.p95).toBeGreaterThanOrEqual(snapshot.latency.p50 ?? 0);
    expect(snapshot.latency.p99).toBeGreaterThanOrEqual(snapshot.latency.p95 ?? 0);
  });

  it("resets gauges without affecting counters", () => {
    const service = new MetricsService();

    service.setActiveSessions(10);
    service.updateCacheHitRatio(0.75);
    service.recordConnectAttempt();

    const before = service.getSnapshot();
    expect(before.gauges.active_sessions_gauge).toBe(10);
    expect(before.counters.connect_attempts_total).toBe(1);

    service.reset();
    const after = service.getSnapshot();
    expect(after.gauges.active_sessions_gauge).toBe(0);
    expect(after.gauges.cache_hit_ratio).toBe(0);
    expect(after.counters.connect_attempts_total).toBe(1);
  });
});
