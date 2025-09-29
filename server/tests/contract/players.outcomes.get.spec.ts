import { describe, expect, it } from "vitest";
import { createTestAgent } from "../utils/testServer.js";

const PLAYER_ID_WITH_OUTCOMES = "00000000-0000-0000-0000-0000000000aa";

describe("GET /players/:playerId/outcomes", () => {
  it("returns a list of outcomes for the player respecting default limit", async () => {
    const agent = await createTestAgent();

    const response = await agent
      .get(`/players/${PLAYER_ID_WITH_OUTCOMES}/outcomes`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        items: expect.any(Array)
      })
    );

    for (const item of response.body.items) {
      expect(item).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          instanceId: expect.any(String),
          rulesetVersion: expect.any(String),
          startedAt: expect.any(String),
          endedAt: expect.any(String),
          participants: expect.any(Array)
        })
      );
    }
  });

  it("respects the limit query parameter", async () => {
    const agent = await createTestAgent();

    const limit = 3;
    const response = await agent
      .get(`/players/${PLAYER_ID_WITH_OUTCOMES}/outcomes`)
      .query({ limit })
      .expect(200);

    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items.length).toBeLessThanOrEqual(limit);
  });
});
