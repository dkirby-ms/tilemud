import { describe, expect, it } from "vitest";
import { createRealtimeTestHarness } from "../../utils/realtimeTestClient.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MISMATCH_VERSION = "0.0.0-old";

describe("version mismatch handling", () => {
  it("disconnects clients advertising an incompatible version", async () => {
    let harness;
    try {
      harness = await createRealtimeTestHarness({ version: MISMATCH_VERSION });

      const mismatch = await harness.waitForEvent("event.version_mismatch", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(mismatch).toEqual(
        expect.objectContaining({
          type: "event.version_mismatch",
          payload: expect.objectContaining({
            expectedVersion: expect.any(String),
            receivedVersion: MISMATCH_VERSION,
            message: expect.stringMatching(/update/i)
          })
        })
      );

      const closeEvent = await harness.waitForEvent("event.disconnect", { timeoutMs: DEFAULT_TIMEOUT_MS });
      expect(closeEvent).toEqual(
        expect.objectContaining({
          type: "event.disconnect",
          payload: expect.objectContaining({
            reason: "version_mismatch"
          })
        })
      );
    } finally {
      await harness?.close?.().catch(() => undefined);
    }
  });
});
