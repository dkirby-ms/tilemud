import { describe, expect, it } from "vitest";

describe("Contract: atomic action rollback", () => {
  it("rejects multi-step actions with ACTION_ATOMIC_ROLLBACK when durability fails mid-flight", async () => {
    expect.fail("Not implemented: requires atomic action pipeline + rollback signaling");
  });
});
