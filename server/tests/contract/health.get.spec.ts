import { describe, expect, it } from "vitest";
import { createTestAgent } from "../utils/testServer.js";

describe("GET /health", () => {
  it("returns service health status", async () => {
    const agent = await createTestAgent();

    const response = await agent.get("/health").expect(200);

    expect(response.body).toEqual({ status: "ok" });
  });
});
