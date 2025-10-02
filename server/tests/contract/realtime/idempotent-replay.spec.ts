import { describe, expect, it } from "vitest";
import { createRealtimeTestHarness } from "../../utils/realtimeTestClient.js";

const DEFAULT_TIMEOUT_MS = 5_000;

describe("idempotent action replay", () => {
  it("ignores duplicate intents that reuse the same sequence number", async () => {
    let harness;
    try {
      harness = await createRealtimeTestHarness();

      await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });

      const originalPayload = {
        actionId: "dup-action-1",
        kind: "system",
        metadata: { note: "first" }
      } as const;

      await harness.sendIntent("intent.action", originalPayload, { sequence: 1 });
      const firstAck = await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      const firstAckPayload = firstAck.payload as {
        status: string;
        durability: { actionEventId: string };
      };
      expect(firstAckPayload.status).toBe("applied");
      expect(firstAckPayload.durability.actionEventId).toEqual(expect.any(String));

      await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });

      await harness.sendIntent("intent.action", originalPayload, { sequence: 1 });
      const duplicateAck = await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      const duplicatePayload = duplicateAck.payload as {
        status: string;
        durability: { actionEventId: string };
      };

      expect(duplicatePayload.status).toBe("duplicate");
      expect(duplicatePayload.durability.actionEventId).toBe(firstAckPayload.durability.actionEventId);
    } finally {
      await harness?.close?.().catch(() => undefined);
    }
  });
});
