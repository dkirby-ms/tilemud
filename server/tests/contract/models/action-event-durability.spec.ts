import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getTestContainer, cleanupTestServer } from "../../utils/testServer.js";
import { createActionEventRepository } from "../../../src/models/actionEvent.js";

const TABLE_NAME = "action_events";

describe("ActionEvent durability", () => {
  beforeEach(async () => {
    const container = await getTestContainer();
    try {
      await container.postgres.query(`TRUNCATE TABLE ${TABLE_NAME}`);
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as { code?: string }).code !== "42P01") {
        throw error;
      }
      // Table has not been created yet; allow test to proceed so it fails in assertions instead.
    }
  });

  afterAll(async () => {
    await cleanupTestServer();
  });

  it("persists action events before acknowledging the client", async () => {
    const container = await getTestContainer();
    const repository = createActionEventRepository(container.postgres);

    const sessionId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const characterId = randomUUID();

    const persisted = await repository.appendAction({
      sessionId,
      userId,
      characterId,
      sequenceNumber: 1,
      actionType: "move",
      payload: { dx: 1, dy: 0 }
    });

    expect(persisted.actionId).toEqual(expect.any(String));
    expect(persisted.persistedAt).toBeInstanceOf(Date);

    const { rows } = await container.postgres.query(
      "SELECT action_id, session_id, user_id, character_id, sequence_number, persisted_at FROM action_events WHERE action_id = $1",
      [persisted.actionId]
    );

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.session_id).toBe(sessionId);
    expect(row.sequence_number).toBe(1);
    expect(new Date(row.persisted_at).getTime()).toBe(persisted.persistedAt.getTime());
  });

  it("exposes recent events for replay pipelines", async () => {
    const container = await getTestContainer();
    const repository = createActionEventRepository(container.postgres);

    const sessionId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const characterId = randomUUID();

    const first = await repository.appendAction({
      sessionId,
      userId,
      characterId,
      sequenceNumber: 1,
      actionType: "move",
      payload: { dx: 1, dy: 0 }
    });

    await repository.appendAction({
      sessionId,
      userId,
      characterId,
      sequenceNumber: 2,
      actionType: "chat",
      payload: { message: "hello" }
    });

    const recent = await repository.listRecentForCharacter(characterId, 10);

    expect(recent.length).toBeGreaterThanOrEqual(2);
    expect(recent[0].persistedAt.getTime()).toBeGreaterThanOrEqual(first.persistedAt.getTime());

    const latest = await repository.getLatestForSession(sessionId);
    expect(latest?.sequenceNumber).toBe(2);
  });
});
