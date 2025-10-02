import { describe, expect, it } from "vitest";
import { createRealtimeTestHarness } from "../../utils/realtimeTestClient.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const CHAT_LIMIT = 5;

describe("intent.chat rate limiting", () => {
  it("acknowledges chat intents within quota and rejects when limit exceeded", async () => {
    let harness;
    try {
      harness = await createRealtimeTestHarness();

      await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });

      for (let i = 1; i <= CHAT_LIMIT; i += 1) {
        await harness.sendIntent(
          "intent.chat",
          {
            channel: "global",
            message: `hello-${i}`
          },
          { sequence: i }
        );

        const ack = await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
        expect(ack).toEqual(
          expect.objectContaining({
            type: "event.ack",
            payload: expect.objectContaining({
              intentType: "intent.chat",
              sequence: i,
              status: "applied"
            })
          })
        );
      }

      await harness.sendIntent(
        "intent.chat",
        {
          channel: "global",
          message: "too-many"
        },
        { sequence: CHAT_LIMIT + 1 }
      );

      const errorEvent = await harness.waitForEvent("event.error", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(errorEvent).toEqual(
        expect.objectContaining({
          type: "event.error",
          payload: expect.objectContaining({
            intentType: "intent.chat",
            sequence: CHAT_LIMIT + 1,
            code: "CHAT_RATE_LIMIT_EXCEEDED",
            category: "RATE_LIMIT",
            retryable: false,
            message: expect.stringMatching(/rate limit/i)
          })
        })
      );
    } finally {
      await harness?.close?.().catch(() => undefined);
    }
  });
});
