import { Pool } from "pg";

// RuleSet entity types
export interface RuleSetVersion {
  id: string;
  version: string;
  createdAt: Date;
  metadataJson: Record<string, any>;
}

export interface CreateRuleSetData {
  version: string;
  metadataJson?: Record<string, any>;
}

// Database row type
interface RuleSetRow {
  id: string;
  version: string;
  created_at: string;
  metadata_json: any;
}

// RuleSet repository interface
export interface RuleSetRepository {
  create(data: CreateRuleSetData): Promise<RuleSetVersion>;
  findById(id: string): Promise<RuleSetVersion | null>;
  findByVersion(version: string): Promise<RuleSetVersion | null>;
  findLatestVersion(): Promise<RuleSetVersion | null>;
  listAll(limit?: number, offset?: number): Promise<RuleSetVersion[]>;
  listVersions(): Promise<string[]>;
}

// PostgreSQL implementation
export class PostgresRuleSetRepository implements RuleSetRepository {
  constructor(private pool: Pool) {}

  async create(data: CreateRuleSetData): Promise<RuleSetVersion> {
    const query = `
      INSERT INTO rulesets (id, version, created_at, metadata_json)
      VALUES (gen_random_uuid(), $1, NOW(), $2)
      RETURNING id, version, created_at, metadata_json
    `;
    
    const metadataJson = data.metadataJson || {};
    const result = await this.pool.query<RuleSetRow>(query, [data.version, JSON.stringify(metadataJson)]);
    
    if (result.rows.length === 0) {
      throw new Error("Failed to create ruleset");
    }
    
    return this.mapRowToRuleSet(result.rows[0]);
  }

  async findById(id: string): Promise<RuleSetVersion | null> {
    const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      WHERE id = $1
    `;
    
    const result = await this.pool.query<RuleSetRow>(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToRuleSet(result.rows[0]);
  }

  async findByVersion(version: string): Promise<RuleSetVersion | null> {
    const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      WHERE version = $1
    `;
    
    const result = await this.pool.query<RuleSetRow>(query, [version]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToRuleSet(result.rows[0]);
  }

  async findLatestVersion(): Promise<RuleSetVersion | null> {
    const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const result = await this.pool.query<RuleSetRow>(query);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToRuleSet(result.rows[0]);
  }

  async listAll(limit = 100, offset = 0): Promise<RuleSetVersion[]> {
    const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await this.pool.query<RuleSetRow>(query, [limit, offset]);
    return result.rows.map((row: RuleSetRow) => this.mapRowToRuleSet(row));
  }

  async listVersions(): Promise<string[]> {
    const query = `
      SELECT version
      FROM rulesets
      ORDER BY created_at DESC
    `;
    
    const result = await this.pool.query<{ version: string }>(query);
    return result.rows.map(row => row.version);
  }

  private mapRowToRuleSet(row: RuleSetRow): RuleSetVersion {
    return {
      id: row.id,
      version: row.version,
      createdAt: new Date(row.created_at),
      metadataJson: typeof row.metadata_json === 'string' 
        ? JSON.parse(row.metadata_json) 
        : row.metadata_json || {}
    };
  }
}

// Repository factory for dependency injection
export function createRuleSetRepository(pool: Pool): RuleSetRepository {
  return new PostgresRuleSetRepository(pool);
}