// PostgreSQL implementation
export class PostgresBattleOutcomeRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async create(data) {
        const durationMs = data.endedAt.getTime() - data.startedAt.getTime();
        const query = `
      INSERT INTO battle_outcomes (
        id, instance_id, ruleset_version, started_at, ended_at, 
        duration_ms, participants_json, outcome_json, created_at
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, instance_id, ruleset_version, started_at, ended_at, 
                duration_ms, participants_json, outcome_json, created_at
    `;
        const result = await this.pool.query(query, [
            data.instanceId,
            data.rulesetVersion,
            data.startedAt.toISOString(),
            data.endedAt.toISOString(),
            durationMs,
            JSON.stringify(data.participantsJson),
            JSON.stringify(data.outcomeJson)
        ]);
        if (result.rows.length === 0) {
            throw new Error("Failed to create battle outcome");
        }
        return this.mapRowToBattleOutcome(result.rows[0]);
    }
    async findById(id) {
        const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE id = $1
    `;
        const result = await this.pool.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToBattleOutcome(result.rows[0]);
    }
    async findByInstanceId(instanceId) {
        const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE instance_id = $1
    `;
        const result = await this.pool.query(query, [instanceId]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToBattleOutcome(result.rows[0]);
    }
    async findByPlayer(playerId, limit = 50, offset = 0) {
        const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE participants_json -> 'players' @> $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
        // JSON query to find player by ID in participants array
        const playerFilter = JSON.stringify([{ id: playerId }]);
        const result = await this.pool.query(query, [playerFilter, limit, offset]);
        return result.rows.map((row) => this.mapRowToBattleOutcome(row));
    }
    async findByRulesetVersion(version, limit = 50, offset = 0) {
        const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE ruleset_version = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
        const result = await this.pool.query(query, [version, limit, offset]);
        return result.rows.map((row) => this.mapRowToBattleOutcome(row));
    }
    async findRecent(limit = 50, offset = 0) {
        const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
        const result = await this.pool.query(query, [limit, offset]);
        return result.rows.map((row) => this.mapRowToBattleOutcome(row));
    }
    async getPlayerStatistics(playerId) {
        const query = `
      SELECT 
        COUNT(*) as total_games,
        SUM(CASE WHEN outcome_json->>'winner' = $1 THEN 1 ELSE 0 END) as wins,
        AVG((outcome_json->'scores'->>$1)::numeric) as average_score,
        SUM(duration_ms) as total_play_time_ms,
        MODE() WITHIN GROUP (ORDER BY ruleset_version) as favorite_ruleset
      FROM battle_outcomes
      WHERE participants_json -> 'players' @> $2
    `;
        const playerFilter = JSON.stringify([{ id: playerId }]);
        const result = await this.pool.query(query, [playerId, playerFilter]);
        if (result.rows.length === 0) {
            return {
                totalGames: 0,
                wins: 0,
                losses: 0,
                averageScore: 0,
                totalPlayTimeMs: 0
            };
        }
        const row = result.rows[0];
        const totalGames = parseInt(row.total_games) || 0;
        const wins = parseInt(row.wins) || 0;
        return {
            totalGames,
            wins,
            losses: totalGames - wins,
            averageScore: parseFloat(row.average_score) || 0,
            totalPlayTimeMs: parseInt(row.total_play_time_ms) || 0,
            favoriteRuleset: row.favorite_ruleset || undefined
        };
    }
    mapRowToBattleOutcome(row) {
        return {
            id: row.id,
            instanceId: row.instance_id,
            rulesetVersion: row.ruleset_version,
            startedAt: new Date(row.started_at),
            endedAt: new Date(row.ended_at),
            durationMs: row.duration_ms,
            participantsJson: typeof row.participants_json === 'string'
                ? JSON.parse(row.participants_json)
                : row.participants_json,
            outcomeJson: typeof row.outcome_json === 'string'
                ? JSON.parse(row.outcome_json)
                : row.outcome_json,
            createdAt: new Date(row.created_at)
        };
    }
}
// Repository factory for dependency injection
export function createBattleOutcomeRepository(pool) {
    return new PostgresBattleOutcomeRepository(pool);
}
//# sourceMappingURL=battleOutcomeRepository.js.map