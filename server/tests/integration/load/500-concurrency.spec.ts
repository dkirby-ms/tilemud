import { describe, it, expect } from "vitest";
import { runLoadHarness } from "../../utils/performanceHarness.js";

describe("Performance: 500 concurrent sessions", () => {
  it("sustains 500 concurrent sessions within latency budget", async () => {
    const result = await runLoadHarness({
      sessionCount: 500,
      warmupDurationMs: 5_000,
      runDurationMs: 30_000,
      rampIntervalMs: 250
    });

    expect(result.failures).toBe(0);
    expect(result.sustainedSessions).toBeGreaterThanOrEqual(500);
    expect(result.maxConcurrentSessions).toBeGreaterThanOrEqual(500);
    expect(result.latencyP95Ms).toBeLessThanOrEqual(200);
  });
});