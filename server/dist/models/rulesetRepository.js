// PostgreSQL implementation
export class PostgresRuleSetRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async create(data) {
        const query = `
      INSERT INTO rulesets (id, version, created_at, metadata_json)
      VALUES (gen_random_uuid(), $1, NOW(), $2)
      RETURNING id, version, created_at, metadata_json
    `;
        const metadataJson = data.metadataJson || {};
        const result = await this.pool.query(query, [data.version, JSON.stringify(metadataJson)]);
        if (result.rows.length === 0) {
            throw new Error("Failed to create ruleset");
        }
        return this.mapRowToRuleSet(result.rows[0]);
    }
    async findById(id) {
        const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      WHERE id = $1
    `;
        const result = await this.pool.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToRuleSet(result.rows[0]);
    }
    async findByVersion(version) {
        const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      WHERE version = $1
    `;
        const result = await this.pool.query(query, [version]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToRuleSet(result.rows[0]);
    }
    async findLatestVersion() {
        const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      ORDER BY created_at DESC
      LIMIT 1
    `;
        const result = await this.pool.query(query);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToRuleSet(result.rows[0]);
    }
    async listAll(limit = 100, offset = 0) {
        const query = `
      SELECT id, version, created_at, metadata_json
      FROM rulesets
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
        const result = await this.pool.query(query, [limit, offset]);
        return result.rows.map((row) => this.mapRowToRuleSet(row));
    }
    async listVersions() {
        const query = `
      SELECT version
      FROM rulesets
      ORDER BY created_at DESC
    `;
        const result = await this.pool.query(query);
        return result.rows.map(row => row.version);
    }
    mapRowToRuleSet(row) {
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
export function createRuleSetRepository(pool) {
    return new PostgresRuleSetRepository(pool);
}
//# sourceMappingURL=rulesetRepository.js.map