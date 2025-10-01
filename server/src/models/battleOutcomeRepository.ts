import { Pool } from "pg";

// BattleOutcome entity types
export interface BattleOutcome {
  id: string;
  instanceId: string;
  rulesetVersion: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  participantsJson: ParticipantsData;
  outcomeJson: OutcomeData;
  createdAt: Date;
}

export interface ParticipantsData {
  players: Array<{
    id: string;
    displayName: string;
    initiativeRank: number;
    role?: string;
    finalScore?: number;
  }>;
  npcs?: Array<{
    id: string;
    type: string;
    difficulty?: number;
  }>;
}

export interface OutcomeData {
  winner?: string;
  scores: Record<string, number>;
  rewards?: Record<string, any>;
  finalBoardState?: any;
  statistics?: Record<string, any>;
}

export interface CreateBattleOutcomeData {
  instanceId: string;
  rulesetVersion: string;
  startedAt: Date;
  endedAt: Date;
  participantsJson: ParticipantsData;
  outcomeJson: OutcomeData;
}

// Database row type
interface BattleOutcomeRow {
  id: string;
  instance_id: string;
  ruleset_version: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  participants_json: any;
  outcome_json: any;
  created_at: string;
}

// BattleOutcome repository interface
export interface BattleOutcomeRepository {
  create(data: CreateBattleOutcomeData): Promise<BattleOutcome>;
  findById(id: string): Promise<BattleOutcome | null>;
  findByInstanceId(instanceId: string): Promise<BattleOutcome | null>;
  findByPlayer(playerId: string, limit?: number, offset?: number): Promise<BattleOutcome[]>;
  findByRulesetVersion(version: string, limit?: number, offset?: number): Promise<BattleOutcome[]>;
  findRecent(limit?: number, offset?: number): Promise<BattleOutcome[]>;
  getPlayerStatistics(playerId: string): Promise<PlayerStatistics>;
}

export interface PlayerStatistics {
  totalGames: number;
  wins: number;
  losses: number;
  averageScore: number;
  totalPlayTimeMs: number;
  favoriteRuleset?: string;
}

// PostgreSQL implementation
export class PostgresBattleOutcomeRepository implements BattleOutcomeRepository {
  constructor(private pool: Pool) {}

  async create(data: CreateBattleOutcomeData): Promise<BattleOutcome> {
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
    
    const result = await this.pool.query<BattleOutcomeRow>(query, [
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

  async findById(id: string): Promise<BattleOutcome | null> {
    const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE id = $1
    `;
    
    const result = await this.pool.query<BattleOutcomeRow>(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToBattleOutcome(result.rows[0]);
  }

  async findByInstanceId(instanceId: string): Promise<BattleOutcome | null> {
    const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE instance_id = $1
    `;
    
    const result = await this.pool.query<BattleOutcomeRow>(query, [instanceId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToBattleOutcome(result.rows[0]);
  }

  async findByPlayer(playerId: string, limit = 50, offset = 0): Promise<BattleOutcome[]> {
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
    const result = await this.pool.query<BattleOutcomeRow>(query, [playerFilter, limit, offset]);
    
    return result.rows.map((row: BattleOutcomeRow) => this.mapRowToBattleOutcome(row));
  }

  async findByRulesetVersion(version: string, limit = 50, offset = 0): Promise<BattleOutcome[]> {
    const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      WHERE ruleset_version = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pool.query<BattleOutcomeRow>(query, [version, limit, offset]);
    return result.rows.map((row: BattleOutcomeRow) => this.mapRowToBattleOutcome(row));
  }

  async findRecent(limit = 50, offset = 0): Promise<BattleOutcome[]> {
    const query = `
      SELECT id, instance_id, ruleset_version, started_at, ended_at,
             duration_ms, participants_json, outcome_json, created_at
      FROM battle_outcomes
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await this.pool.query<BattleOutcomeRow>(query, [limit, offset]);
    return result.rows.map((row: BattleOutcomeRow) => this.mapRowToBattleOutcome(row));
  }

  async getPlayerStatistics(playerId: string): Promise<PlayerStatistics> {
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

  private mapRowToBattleOutcome(row: BattleOutcomeRow): BattleOutcome {
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
export function createBattleOutcomeRepository(pool: Pool): BattleOutcomeRepository {
  return new PostgresBattleOutcomeRepository(pool);
}