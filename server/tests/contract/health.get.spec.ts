import { describe, expect, it } from "vitest";
import { createTestAgent } from "../utils/testServer.js";
import { SERVER_BUILD_VERSION } from "../../src/infra/version.js";

describe("GET /api/health", () => {
  it("reports dependency health and build version", async () => {
    const agent = await createTestAgent();

    const response = await agent.get("/api/health").expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: "ok",
        version: SERVER_BUILD_VERSION,
        dependencies: expect.objectContaining({
          postgres: expect.objectContaining({
            status: expect.stringMatching(/^(available|degraded|unavailable)$/)
          }),
          redis: expect.objectContaining({
            status: expect.stringMatching(/^(available|degraded|unavailable)$/)
          })
        })
      })
    );
  });
});
