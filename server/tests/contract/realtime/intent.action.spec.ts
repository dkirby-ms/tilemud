import { describe, expect, it } from "vitest";
import { createRealtimeTestHarness } from "../../utils/realtimeTestClient.js";

const DEFAULT_TIMEOUT_MS = 5_000;

describe("intent.action durability", () => {
  it("persists before ack and returns durability metadata", async () => {
    let harness;
    try {
      harness = await createRealtimeTestHarness();

      await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });

      const actionPayload = {
        actionId: "test-action-1",
        kind: "ability",
        target: {
          type: "tile",
          coordinates: { x: 4, y: 7 }
        },
        metadata: {
          damage: 12
        }
      } satisfies Record<string, unknown>;

      await harness.sendIntent("intent.action", actionPayload, { sequence: 1 });

      const ackEvent = await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(ackEvent).toEqual(
        expect.objectContaining({
          type: "event.ack",
          payload: expect.objectContaining({
            intentType: "intent.action",
            sequence: 1,
            status: "applied",
            durability: expect.objectContaining({
              persisted: true,
              actionEventId: expect.any(String),
              persistedAt: expect.any(String)
            })
          })
        })
      );

      const deltaEvent = await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(deltaEvent).toEqual(
        expect.objectContaining({
          type: "event.state_delta",
          payload: expect.objectContaining({
            sequence: expect.any(Number),
            effects: expect.arrayContaining([
              expect.objectContaining({
                type: "ability",
                actionId: "test-action-1"
              })
            ])
          })
        })
      );
    } finally {
      await harness?.close?.().catch(() => undefined);
    }
  });
});
