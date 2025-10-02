import { describe, expect, it } from "vitest";

describe("Integration: database unavailable handling", () => {
  it("pauses acknowledgements and notifies clients when the durable store is down", async () => {
    expect.fail("Not implemented: requires DB outage guard + client notification");
  });
});
