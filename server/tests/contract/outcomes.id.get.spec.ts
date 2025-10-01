import { describe, expect, it } from "vitest";
import { createTestAgent } from "../utils/testServer.js";

const EXISTING_OUTCOME_ID = "00000000-0000-0000-0000-000000000001";
const MISSING_OUTCOME_ID = "11111111-1111-1111-1111-111111111111";

describe("GET /outcomes/:id", () => {
  it("returns a persisted battle outcome when it exists", async () => {
    const agent = await createTestAgent();

    const response = await agent.get(`/outcomes/${EXISTING_OUTCOME_ID}`).expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: EXISTING_OUTCOME_ID,
        instanceId: expect.any(String),
        rulesetVersion: expect.any(String),
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        participants: expect.arrayContaining([
          expect.objectContaining({
            playerId: expect.any(String),
            initiative: expect.any(Number),
            stats: expect.any(Object)
          })
        ]),
        outcome: expect.any(Object)
      })
    );
  });

  it("returns a standardized error when the outcome is missing", async () => {
    const agent = await createTestAgent();

    const response = await agent.get(`/outcomes/${MISSING_OUTCOME_ID}`).expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        numericCode: expect.stringMatching(/^E[0-9]{4}$/),
        reason: expect.any(String),
        category: "state",
        retryable: false,
        humanMessage: expect.any(String)
      })
    );
  });
});
