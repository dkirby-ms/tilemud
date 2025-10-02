import { describe, expect, it } from "vitest";
import { createTestAgent } from "../../utils/testServer.js";
import { SERVER_BUILD_VERSION } from "../../../src/infra/version.js";

const VALID_TOKEN = "Bearer dev-valid-token";

describe("POST /api/session/bootstrap", () => {
  it("returns session snapshot and version for a valid token", async () => {
    const agent = await createTestAgent();

    const response = await agent
      .post("/api/session/bootstrap")
      .set("Authorization", VALID_TOKEN)
      .send({ reconnectToken: null })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        version: SERVER_BUILD_VERSION,
        issuedAt: expect.any(String),
        session: expect.objectContaining({
          sessionId: expect.any(String),
          userId: expect.any(String),
          status: "active",
          protocolVersion: SERVER_BUILD_VERSION,
          lastSequenceNumber: expect.any(Number)
        }),
        state: expect.objectContaining({
          character: expect.objectContaining({
            characterId: expect.any(String),
            displayName: expect.any(String),
            position: expect.objectContaining({
              x: expect.any(Number),
              y: expect.any(Number)
            }),
            stats: expect.any(Object),
            inventory: expect.any(Object)
          })
        }),
        reconnect: expect.objectContaining({
          token: expect.any(String),
          expiresAt: expect.any(String)
        })
      })
    );
  });
});
