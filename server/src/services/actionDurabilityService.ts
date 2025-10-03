import type {
  ActionEventRecord,
  ActionEventRepository,
  AppendActionEventInput
} from "../models/actionEvent.js";
import { ActionEventPersistenceError } from "../models/actionEvent.js";
import { TileMudError } from "../models/errorCodes.js";

export interface PersistActionInput extends AppendActionEventInput {
  actionIdHint?: string;
}

export interface DurabilityMetadata {
  persisted: true;
  actionEventId: string;
  persistedAt: string;
  duplicate?: boolean;
}

export interface PersistActionResult {
  record: ActionEventRecord;
  metadata: DurabilityMetadata;
}

export interface ActionDurabilityServiceDependencies {
  repository: ActionEventRepository;
}

export class ActionDurabilityService {
  private readonly repository: ActionEventRepository;

  constructor(dependencies: ActionDurabilityServiceDependencies) {
    this.repository = dependencies.repository;
  }

  async persistAction(input: PersistActionInput): Promise<PersistActionResult> {
    try {
      const record = await this.repository.appendAction({
        sessionId: input.sessionId,
        userId: input.userId,
        characterId: input.characterId,
        sequenceNumber: input.sequenceNumber,
        actionType: input.actionType,
        payload: input.payload
      });

      return {
        record,
        metadata: createDurabilityMetadata(record)
      } satisfies PersistActionResult;
    } catch (error) {
      if (error instanceof ActionEventPersistenceError) {
        const duplicate = await this.repository.getBySessionAndSequence(
          input.sessionId,
          input.sequenceNumber
        );

        if (duplicate) {
          return {
            record: duplicate,
            metadata: createDurabilityMetadata(duplicate, true)
          } satisfies PersistActionResult;
        }

        throw new TileMudError("INTERNAL_ERROR", {
          message: "Failed to persist action event",
          sessionId: input.sessionId,
          sequenceNumber: input.sequenceNumber,
          cause: error.message
        });
      }

      throw error;
    }
  }

  async getLatestForSession(sessionId: string): Promise<ActionEventRecord | null> {
    return this.repository.getLatestForSession(sessionId);
  }

  async listRecentForCharacter(characterId: string, limit?: number): Promise<ActionEventRecord[]> {
    return this.repository.listRecentForCharacter(characterId, limit);
  }

  async getBySessionAndSequence(sessionId: string, sequenceNumber: number): Promise<ActionEventRecord | null> {
    return this.repository.getBySessionAndSequence(sessionId, sequenceNumber);
  }
}

function createDurabilityMetadata(record: ActionEventRecord, duplicate = false): DurabilityMetadata {
  return {
    persisted: true,
    actionEventId: record.actionId,
    persistedAt: record.persistedAt.toISOString(),
    duplicate: duplicate || undefined
  } satisfies DurabilityMetadata;
}
