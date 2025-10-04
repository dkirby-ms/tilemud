import { beforeEach, describe, expect, it } from "vitest";
import { MetricsService } from "../../../src/services/metricsService.js";
import { resetMetrics } from "../../../src/infra/metrics.js";

const withinBudgetSamples = [
  42, 57, 63, 71, 80, 95, 102, 110, 118, 123,
  129, 134, 139, 142, 148, 152, 157, 162, 168, 173,
  178, 182, 187, 191, 195, 198
];

const outOfBudgetSamples = [
  45, 60, 79, 88, 97, 104, 112, 119, 125, 133,
  141, 149, 158, 167, 176, 184, 193, 205, 214, 227,
  238, 249, 261, 272, 283, 295
];

describe("Performance: latency budget instrumentation", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("reports p95 latency ≤ 200ms for in-budget samples", () => {
    const metrics = new MetricsService();

    for (const sample of withinBudgetSamples) {
      metrics.observeActionLatency(sample);
    }

    const snapshot = metrics.getSnapshot();
    expect(snapshot.latency.p95).not.toBeNull();
    expect(snapshot.latency.p95 ?? Infinity).toBeLessThanOrEqual(200);
  });

  it("flags p95 latency breach when samples exceed budget", () => {
    const metrics = new MetricsService();

    for (const sample of outOfBudgetSamples) {
      metrics.observeActionLatency(sample);
    }

    const snapshot = metrics.getSnapshot();
    expect(snapshot.latency.p95).not.toBeNull();
    expect(snapshot.latency.p95 ?? 0).toBeGreaterThan(200);
  });
});