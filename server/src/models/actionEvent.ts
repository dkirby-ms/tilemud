import type { Pool } from "pg";

interface ActionEventRow {
  action_id: string;
  session_id: string;
  user_id: string;
  character_id: string;
  sequence_number: number;
  action_type: ActionEventType;
  payload_json: Record<string, unknown> | null;
  persisted_at: Date;
}

export type ActionEventType = "move" | "chat" | "ability" | "system";

export interface ActionEventRecord {
  actionId: string;
  sessionId: string;
  userId: string;
  characterId: string;
  sequenceNumber: number;
  actionType: ActionEventType;
  payload: Record<string, unknown>;
  persistedAt: Date;
}

export interface AppendActionEventInput {
  sessionId: string;
  userId: string;
  characterId: string;
  sequenceNumber: number;
  actionType: ActionEventType;
  payload: Record<string, unknown>;
}

export interface ActionEventRepository {
  appendAction(input: AppendActionEventInput): Promise<ActionEventRecord>;
  listRecentForCharacter(characterId: string, limit?: number): Promise<ActionEventRecord[]>;
  getLatestForSession(sessionId: string): Promise<ActionEventRecord | null>;
  getBySessionAndSequence(sessionId: string, sequenceNumber: number): Promise<ActionEventRecord | null>;
}

export class ActionEventPersistenceError extends Error {
  constructor(message = "action_event_persistence_failed") {
    super(message);
    this.name = "ActionEventPersistenceError";
  }
}

class PostgresActionEventRepository implements ActionEventRepository {
  constructor(private readonly pool: Pool) {}

  async appendAction(input: AppendActionEventInput): Promise<ActionEventRecord> {
    try {
      const result = await this.pool.query<ActionEventRow>(
        `INSERT INTO action_events (
          session_id,
          user_id,
          character_id,
          sequence_number,
          action_type,
          payload_json
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING action_id, session_id, user_id, character_id, sequence_number, action_type, payload_json, persisted_at`,
        [
          input.sessionId,
          input.userId,
          input.characterId,
          input.sequenceNumber,
          input.actionType,
          JSON.stringify(input.payload ?? {})
        ]
      );

      return this.mapRow(result.rows[0]);
    } catch (error) {
      throw new ActionEventPersistenceError(error instanceof Error ? error.message : undefined);
    }
  }

  async listRecentForCharacter(characterId: string, limit = 50): Promise<ActionEventRecord[]> {
    const result = await this.pool.query<ActionEventRow>(
      `SELECT action_id, session_id, user_id, character_id, sequence_number, action_type, payload_json, persisted_at
       FROM action_events
       WHERE character_id = $1
       ORDER BY sequence_number DESC
       LIMIT $2`,
      [characterId, limit]
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  async getLatestForSession(sessionId: string): Promise<ActionEventRecord | null> {
    const result = await this.pool.query<ActionEventRow>(
      `SELECT action_id, session_id, user_id, character_id, sequence_number, action_type, payload_json, persisted_at
       FROM action_events
       WHERE session_id = $1
       ORDER BY sequence_number DESC
       LIMIT 1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow(result.rows[0]);
  }

  async getBySessionAndSequence(sessionId: string, sequenceNumber: number): Promise<ActionEventRecord | null> {
    const result = await this.pool.query<ActionEventRow>(
      `SELECT action_id, session_id, user_id, character_id, sequence_number, action_type, payload_json, persisted_at
       FROM action_events
       WHERE session_id = $1 AND sequence_number = $2
       LIMIT 1`,
      [sessionId, sequenceNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: ActionEventRow): ActionEventRecord {
    return {
      actionId: row.action_id,
      sessionId: row.session_id,
      userId: row.user_id,
      characterId: row.character_id,
      sequenceNumber: Number(row.sequence_number),
      actionType: row.action_type,
      payload: row.payload_json ?? {},
      persistedAt: new Date(row.persisted_at)
    };
  }
}

export function createActionEventRepository(pool: Pool): ActionEventRepository {
  return new PostgresActionEventRepository(pool);
}
