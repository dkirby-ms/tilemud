import { describe, expect, it } from "vitest";
import { createRealtimeTestHarness } from "../../utils/realtimeTestClient.js";

const DEFAULT_TIMEOUT_MS = 5_000;

describe("Realtime handshake", () => {
  it("acknowledges join and emits initial state delta", async () => {
    let harness;
    try {
      harness = await createRealtimeTestHarness();

      const ackEvent = await harness.waitForEvent("event.ack", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(ackEvent).toEqual(
        expect.objectContaining({
          type: "event.ack",
          payload: expect.objectContaining({
            reason: "handshake",
            sessionId: expect.any(String),
            sequence: expect.any(Number),
            version: expect.any(String),
            acknowledgedIntents: expect.any(Array)
          })
        })
      );

      const stateEvent = await harness.waitForEvent("event.state_delta", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(stateEvent).toEqual(
        expect.objectContaining({
          type: "event.state_delta",
          payload: expect.objectContaining({
            sequence: expect.any(Number),
            issuedAt: expect.any(String),
            character: expect.objectContaining({
              characterId: expect.any(String),
              displayName: expect.any(String),
              position: expect.objectContaining({
                x: expect.any(Number),
                y: expect.any(Number)
              }),
              stats: expect.any(Object),
              inventory: expect.any(Object)
            }),
            world: expect.objectContaining({
              tiles: expect.any(Array)
            })
          })
        })
      );
    } finally {
      await harness?.close?.().catch(() => undefined);
    }
  });
});
