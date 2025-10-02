import { describe, expect, it } from "vitest";
import { createTestAgent } from "../../utils/testServer.js";
import { SERVER_BUILD_VERSION } from "../../../src/infra/version.js";

describe("GET /api/version", () => {
  it("returns the current server build version", async () => {
    const agent = await createTestAgent();

    const response = await agent.get("/api/version").expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        version: SERVER_BUILD_VERSION,
        protocol: "colyseus",
        updatedAt: expect.any(String)
      })
    );
  });
});
