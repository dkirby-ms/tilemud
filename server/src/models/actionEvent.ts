import type { Pool } from "pg";

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
}

export class ActionEventPersistenceError extends Error {
  constructor(message = "action_event_persistence_failed") {
    super(message);
    this.name = "ActionEventPersistenceError";
  }
}

class NotImplementedActionEventRepository implements ActionEventRepository {
  constructor(_pool: Pool) {
    // dependencies wired during implementation task T029
  }

  async appendAction(): Promise<ActionEventRecord> {
    throw new Error("ActionEventRepository.appendAction not implemented");
  }

  async listRecentForCharacter(): Promise<ActionEventRecord[]> {
    throw new Error("ActionEventRepository.listRecentForCharacter not implemented");
  }

  async getLatestForSession(): Promise<ActionEventRecord | null> {
    throw new Error("ActionEventRepository.getLatestForSession not implemented");
  }
}

export function createActionEventRepository(pool: Pool): ActionEventRepository {
  return new NotImplementedActionEventRepository(pool);
}
