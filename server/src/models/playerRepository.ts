import { Pool, QueryResult } from "pg";

// Player entity types
export interface Player {
  id: string;
  displayName: string;
  initiativeRank: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlayerData {
  displayName: string;
  initiativeRank: number;
}

export interface UpdatePlayerData {
  displayName?: string;
  initiativeRank?: number;
}

// Database row type
interface PlayerRow {
  id: string;
  display_name: string;
  initiative_rank: number;
  created_at: string;
  updated_at: string;
}

// Player repository interface
export interface PlayerRepository {
  create(data: CreatePlayerData): Promise<Player>;
  findById(id: string): Promise<Player | null>;
  findByDisplayName(displayName: string): Promise<Player | null>;
  update(id: string, data: UpdatePlayerData): Promise<Player | null>;
  delete(id: string): Promise<boolean>;
  findByInitiativeRange(minRank: number, maxRank: number): Promise<Player[]>;
  listAll(limit?: number, offset?: number): Promise<Player[]>;
}

// PostgreSQL implementation
export class PostgresPlayerRepository implements PlayerRepository {
  constructor(private pool: Pool) {}

  async create(data: CreatePlayerData): Promise<Player> {
    const query = `
      INSERT INTO players (id, display_name, initiative_rank, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
      RETURNING id, display_name, initiative_rank, created_at, updated_at
    `;
    
    const result = await this.pool.query<PlayerRow>(query, [data.displayName, data.initiativeRank]);
    
    if (result.rows.length === 0) {
      throw new Error("Failed to create player");
    }
    
    return this.mapRowToPlayer(result.rows[0]);
  }

  async findById(id: string): Promise<Player | null> {
    const query = `
      SELECT id, display_name, initiative_rank, created_at, updated_at
      FROM players
      WHERE id = $1
    `;
    
    const result = await this.pool.query<PlayerRow>(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToPlayer(result.rows[0]);
  }

  async findByDisplayName(displayName: string): Promise<Player | null> {
    const query = `
      SELECT id, display_name, initiative_rank, created_at, updated_at
      FROM players
      WHERE LOWER(display_name) = LOWER($1)
    `;
    
    const result = await this.pool.query<PlayerRow>(query, [displayName]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToPlayer(result.rows[0]);
  }

  async update(id: string, data: UpdatePlayerData): Promise<Player | null> {
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (data.displayName !== undefined) {
      updateFields.push(`display_name = $${paramIndex}`);
      updateValues.push(data.displayName);
      paramIndex++;
    }

    if (data.initiativeRank !== undefined) {
      updateFields.push(`initiative_rank = $${paramIndex}`);
      updateValues.push(data.initiativeRank);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      // No fields to update, return current player
      return this.findById(id);
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id); // For WHERE clause

    const query = `
      UPDATE players
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id, display_name, initiative_rank, created_at, updated_at
    `;
    
    const result = await this.pool.query<PlayerRow>(query, updateValues);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToPlayer(result.rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const query = `
      DELETE FROM players
      WHERE id = $1
    `;
    
    const result = await this.pool.query(query, [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async findByInitiativeRange(minRank: number, maxRank: number): Promise<Player[]> {
    const query = `
      SELECT id, display_name, initiative_rank, created_at, updated_at
      FROM players
      WHERE initiative_rank >= $1 AND initiative_rank <= $2
      ORDER BY initiative_rank ASC, display_name ASC
    `;
    
    const result = await this.pool.query<PlayerRow>(query, [minRank, maxRank]);
    return result.rows.map((row: PlayerRow) => this.mapRowToPlayer(row));
  }

  async listAll(limit = 100, offset = 0): Promise<Player[]> {
    const query = `
      SELECT id, display_name, initiative_rank, created_at, updated_at
      FROM players
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await this.pool.query<PlayerRow>(query, [limit, offset]);
    return result.rows.map((row: PlayerRow) => this.mapRowToPlayer(row));
  }

  private mapRowToPlayer(row: PlayerRow): Player {
    return {
      id: row.id,
      displayName: row.display_name,
      initiativeRank: row.initiative_rank,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

// Repository factory for dependency injection
export function createPlayerRepository(pool: Pool): PlayerRepository {
  return new PostgresPlayerRepository(pool);
}