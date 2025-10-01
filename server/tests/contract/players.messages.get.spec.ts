import { describe, expect, it } from "vitest";
import { createTestAgent } from "../utils/testServer.js";

const PLAYER_ID_WITH_MESSAGES = "00000000-0000-0000-0000-0000000000bb";

describe("GET /players/:playerId/messages", () => {
  it("returns inbound and outbound messages by default", async () => {
    const agent = await createTestAgent();

    const response = await agent
      .get(`/players/${PLAYER_ID_WITH_MESSAGES}/messages`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        items: expect.any(Array)
      })
    );

    for (const message of response.body.items) {
      expect(message).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          senderId: expect.any(String),
          recipientId: expect.any(String),
          content: expect.any(String),
          createdAt: expect.any(String)
        })
      );
    }
  });

  it("filters messages by direction", async () => {
    const agent = await createTestAgent();

    const response = await agent
      .get(`/players/${PLAYER_ID_WITH_MESSAGES}/messages`)
      .query({ direction: "inbound", limit: 5 })
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipientId: PLAYER_ID_WITH_MESSAGES })
      ])
    );
  });
});