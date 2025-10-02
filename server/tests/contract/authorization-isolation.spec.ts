import { describe, expect, it } from "vitest";

describe("Contract: authorization isolation", () => {
  it("returns FORBIDDEN when attempting to access another player's state", async () => {
    expect.fail("Not implemented: requires authorization enforcement");
  });
});
