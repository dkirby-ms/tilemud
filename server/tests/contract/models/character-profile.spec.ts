import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getTestContainer, cleanupTestServer } from "../../utils/testServer.js";
import {
  CharacterProfileConcurrencyError,
  createCharacterProfileRepository
} from "../../../src/models/characterProfile.js";

const TABLE_NAME = "character_profiles";

describe("CharacterProfile repository", () => {
  beforeEach(async () => {
    const container = await getTestContainer();
    try {
      await container.postgres.query(`TRUNCATE TABLE ${TABLE_NAME}`);
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as { code?: string }).code !== "42P01") {
        throw error;
      }
      // Table will not exist until model implementation lands; ignore missing relation for now.
    }
  });

  afterAll(async () => {
    await cleanupTestServer();
  });

  it("persists new profiles with concurrency metadata", async () => {
    const container = await getTestContainer();
    const repository = createCharacterProfileRepository(container.postgres);

    const profileInput = {
      characterId: randomUUID(),
      userId: `user-${randomUUID()}`,
      displayName: "Test Ranger",
      positionX: 7,
      positionY: 3,
      health: 95,
      inventory: { items: [] },
      stats: { strength: 10, agility: 8 }
    };

    const created = await repository.createProfile(profileInput);

    expect(created).toEqual(
      expect.objectContaining({
        characterId: profileInput.characterId,
        userId: profileInput.userId,
        displayName: profileInput.displayName,
        positionX: profileInput.positionX,
        positionY: profileInput.positionY,
        health: profileInput.health,
        inventory: profileInput.inventory,
        stats: profileInput.stats
      })
    );
    expect(created.updatedAt).toBeInstanceOf(Date);

    const fetched = await repository.getProfile(profileInput.characterId, profileInput.userId);
    expect(fetched).not.toBeNull();
    expect(fetched?.updatedAt.getTime()).toBeGreaterThan(0);
    expect(fetched?.characterId).toBe(profileInput.characterId);
  });

  it("enforces optimistic concurrency based on updated_at", async () => {
    const container = await getTestContainer();
    const repository = createCharacterProfileRepository(container.postgres);

    const profileInput = {
      characterId: randomUUID(),
      userId: `user-${randomUUID()}`,
      displayName: "Chronomancer",
      positionX: 2,
      positionY: 9,
      health: 88,
      inventory: { belt: ["potion"] },
      stats: { intellect: 14 }
    };

    const created = await repository.createProfile(profileInput);

    const updated = await repository.updateProfile({
      characterId: profileInput.characterId,
      userId: profileInput.userId,
      expectedUpdatedAt: created.updatedAt,
      positionX: 5,
      positionY: 6,
      health: 90
    });

    expect(updated.positionX).toBe(5);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    await expect(
      repository.updateProfile({
        characterId: profileInput.characterId,
        userId: profileInput.userId,
        expectedUpdatedAt: created.updatedAt,
        health: 42
      })
    ).rejects.toBeInstanceOf(CharacterProfileConcurrencyError);
  });
});
