import type { Pool } from "pg";

interface CharacterProfileRow {
  character_id: string;
  user_id: string;
  display_name: string;
  position_x: number;
  position_y: number;
  health: number;
  inventory_json: Record<string, unknown> | null;
  stats_json: Record<string, unknown> | null;
  updated_at: Date;
}

export interface CharacterProfile {
  characterId: string;
  userId: string;
  displayName: string;
  positionX: number;
  positionY: number;
  health: number;
  inventory: Record<string, unknown>;
  stats: Record<string, unknown>;
  updatedAt: Date;
}

export interface CreateCharacterProfileInput {
  characterId: string;
  userId: string;
  displayName: string;
  positionX: number;
  positionY: number;
  health: number;
  inventory: Record<string, unknown>;
  stats: Record<string, unknown>;
}

export interface UpdateCharacterProfileInput {
  characterId: string;
  userId: string;
  expectedUpdatedAt: Date;
  positionX?: number;
  positionY?: number;
  health?: number;
  inventory?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  displayName?: string;
}

export class CharacterProfileConcurrencyError extends Error {
  constructor(message = "character_profile_concurrency_conflict") {
    super(message);
    this.name = "CharacterProfileConcurrencyError";
  }
}

export interface CharacterProfileRepository {
  createProfile(input: CreateCharacterProfileInput): Promise<CharacterProfile>;
  getProfile(characterId: string, userId: string): Promise<CharacterProfile | null>;
  updateProfile(input: UpdateCharacterProfileInput): Promise<CharacterProfile>;
}

class PostgresCharacterProfileRepository implements CharacterProfileRepository {
  constructor(private readonly pool: Pool) {}

  async createProfile(input: CreateCharacterProfileInput): Promise<CharacterProfile> {
    const result = await this.pool.query<CharacterProfileRow>(
      `INSERT INTO character_profiles (
        character_id,
        user_id,
        display_name,
        position_x,
        position_y,
        health,
        inventory_json,
        stats_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW())
      RETURNING character_id, user_id, display_name, position_x, position_y, health, inventory_json, stats_json, updated_at`,
      [
        input.characterId,
        input.userId,
        input.displayName,
        input.positionX,
        input.positionY,
        input.health,
        JSON.stringify(input.inventory ?? {}),
        JSON.stringify(input.stats ?? {})
      ]
    );

    return this.mapRowToProfile(result.rows[0]);
  }

  async getProfile(characterId: string, userId: string): Promise<CharacterProfile | null> {
    const result = await this.pool.query<CharacterProfileRow>(
      `SELECT character_id, user_id, display_name, position_x, position_y, health, inventory_json, stats_json, updated_at
       FROM character_profiles
       WHERE character_id = $1 AND user_id = $2`,
      [characterId, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToProfile(result.rows[0]);
  }

  async updateProfile(input: UpdateCharacterProfileInput): Promise<CharacterProfile> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    if (typeof input.displayName === "string") {
      setClauses.push(`display_name = $${index}`);
      params.push(input.displayName);
      index += 1;
    }

    if (typeof input.positionX === "number") {
      setClauses.push(`position_x = $${index}`);
      params.push(input.positionX);
      index += 1;
    }

    if (typeof input.positionY === "number") {
      setClauses.push(`position_y = $${index}`);
      params.push(input.positionY);
      index += 1;
    }

    if (typeof input.health === "number") {
      setClauses.push(`health = $${index}`);
      params.push(input.health);
      index += 1;
    }

    if (input.inventory !== undefined) {
      setClauses.push(`inventory_json = $${index}::jsonb`);
      params.push(JSON.stringify(input.inventory));
      index += 1;
    }

    if (input.stats !== undefined) {
      setClauses.push(`stats_json = $${index}::jsonb`);
      params.push(JSON.stringify(input.stats));
      index += 1;
    }

    setClauses.push("updated_at = NOW()");

    params.push(input.characterId, input.userId, input.expectedUpdatedAt);

    const query = `
      UPDATE character_profiles
      SET ${setClauses.join(", ")}
      WHERE character_id = $${index}
        AND user_id = $${index + 1}
        AND updated_at = $${index + 2}
      RETURNING character_id, user_id, display_name, position_x, position_y, health, inventory_json, stats_json, updated_at
    `;

    const result = await this.pool.query<CharacterProfileRow>(query, params);

    if (result.rowCount === 0) {
      throw new CharacterProfileConcurrencyError();
    }

    return this.mapRowToProfile(result.rows[0]);
  }

  private mapRowToProfile(row: CharacterProfileRow): CharacterProfile {
    return {
      characterId: row.character_id,
      userId: row.user_id,
      displayName: row.display_name,
      positionX: Number(row.position_x),
      positionY: Number(row.position_y),
      health: Number(row.health),
      inventory: row.inventory_json ?? {},
      stats: row.stats_json ?? {},
      updatedAt: new Date(row.updated_at)
    };
  }
}

export function createCharacterProfileRepository(pool: Pool): CharacterProfileRepository {
  return new PostgresCharacterProfileRepository(pool);
}
