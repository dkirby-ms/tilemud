import { describe, expect, it } from "vitest";
import { createRealtimeTestHarness } from "../../utils/realtimeTestClient.js";

const DEFAULT_TIMEOUT_MS = 5_000;

describe("intent.move", () => {
  it("applies valid movement and rejects non-monotonic sequence numbers", async () => {
    let harness;
    try {
      harness = await createRealtimeTestHarness();

      // Drain handshake events
      await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });

      await harness.sendIntent(
        "intent.move",
        {
          direction: "north",
          magnitude: 1
        },
        { sequence: 1 }
      );

      const moveAck = await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(moveAck).toEqual(
        expect.objectContaining({
          type: "event.ack",
          payload: expect.objectContaining({
            intentType: "intent.move",
            sequence: 1,
            status: "applied",
            acknowledgedAt: expect.any(String)
          })
        })
      );

      const moveDelta = await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(moveDelta).toEqual(
        expect.objectContaining({
          type: "event.state_delta",
          payload: expect.objectContaining({
            sequence: expect.any(Number),
            character: expect.objectContaining({
              position: expect.objectContaining({
                x: expect.any(Number),
                y: expect.any(Number)
              })
            })
          })
        })
      );

      // Non-monotonic sequence should be rejected
      await harness.sendIntent(
        "intent.move",
        {
          direction: "east",
          magnitude: 1
        },
        { sequence: 1 }
      );

      const errorEvent = await harness.waitForEvent("event.error", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(errorEvent).toEqual(
        expect.objectContaining({
          type: "event.error",
          payload: expect.objectContaining({
            intentType: "intent.move",
            sequence: 1,
            code: "SEQ_OUT_OF_ORDER",
            category: "CONSISTENCY",
            retryable: true,
            message: expect.any(String)
          })
        })
      );
    } finally {
      await harness?.close?.().catch(() => undefined);
    }
  });
});
