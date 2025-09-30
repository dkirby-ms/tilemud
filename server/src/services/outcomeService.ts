import type {
  BattleOutcome,
  BattleOutcomeRepository,
  CreateBattleOutcomeData,
  OutcomeData,
  PlayerStatistics
} from "@@/models/battleOutcomeRepository.js";
import { TileMudError } from "@@/models/errorCodes.js";

interface OutcomeServiceDependencies {
  repository: BattleOutcomeRepository;
}

export type RecordBattleOutcomeInput = Omit<CreateBattleOutcomeData, "endedAt"> & {
  endedAt?: Date;
};

export interface RecordBattleOutcomeResult {
  outcome: BattleOutcome;
  serialized: SerializedBattleOutcome;
}

export interface OutcomeRetrievalOptions {
  requestId?: string;
}

export interface ListOutcomesOptions {
  limit?: number;
  offset?: number;
}

export interface SerializedParticipant {
  playerId: string;
  initiative: number;
  stats: Record<string, unknown>;
  displayName?: string;
  role?: string;
  finalScore?: number;
}

export interface SerializedBattleOutcome {
  id: string;
  instanceId: string;
  rulesetVersion: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  participants: SerializedParticipant[];
  outcome: OutcomeData;
  createdAt: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  const clamped = Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
  return clamped;
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || Number.isNaN(offset) || offset <= 0) {
    return 0;
  }
  return Math.floor(offset);
}

function cloneOutcomePayload<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function serializeParticipants(players: BattleOutcome["participantsJson"]["players"]): SerializedParticipant[] {
  return players.map((player) => {
    const baseStats: Record<string, unknown> = {
      displayName: player.displayName
    };

    if ("stats" in player && player.stats && typeof player.stats === "object") {
      Object.assign(baseStats, player.stats as Record<string, unknown>);
    }

    if (typeof player.finalScore === "number") {
      baseStats.finalScore = player.finalScore;
    }

    if (player.role) {
      baseStats.role = player.role;
    }

    return {
      playerId: player.id,
      initiative: player.initiativeRank,
      stats: baseStats,
      displayName: player.displayName,
      role: player.role,
      finalScore: player.finalScore
    };
  });
}

export class OutcomeService {
  private readonly repository: BattleOutcomeRepository;

  constructor(dependencies: OutcomeServiceDependencies) {
    this.repository = dependencies.repository;
  }

  async recordOutcome(data: RecordBattleOutcomeInput): Promise<RecordBattleOutcomeResult> {
    const endedAt = data.endedAt ?? new Date();
    const created = await this.repository.create({
      ...data,
      endedAt
    });

    return {
      outcome: created,
      serialized: this.serialize(created)
    };
  }

  async getOutcomeById(id: string, options: OutcomeRetrievalOptions = {}): Promise<SerializedBattleOutcome> {
    const outcome = await this.repository.findById(id);
    if (!outcome) {
      throw new TileMudError("INSTANCE_TERMINATED", { outcomeId: id }, options.requestId);
    }
    return this.serialize(outcome);
  }

  async getOutcomeByInstanceId(
    instanceId: string,
    options: OutcomeRetrievalOptions = {}
  ): Promise<SerializedBattleOutcome> {
    const outcome = await this.repository.findByInstanceId(instanceId);
    if (!outcome) {
      throw new TileMudError("INSTANCE_TERMINATED", { instanceId }, options.requestId);
    }
    return this.serialize(outcome);
  }

  async listOutcomesForPlayer(
    playerId: string,
    options: ListOutcomesOptions = {}
  ): Promise<{ items: SerializedBattleOutcome[] }> {
    const limit = clampLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const outcomes = await this.repository.findByPlayer(playerId, limit, offset);
    return {
      items: outcomes.map((outcome) => this.serialize(outcome))
    };
  }

  async listRecentOutcomes(options: ListOutcomesOptions = {}): Promise<{ items: SerializedBattleOutcome[] }> {
    const limit = clampLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const outcomes = await this.repository.findRecent(limit, offset);
    return {
      items: outcomes.map((outcome) => this.serialize(outcome))
    };
  }

  async getPlayerStatistics(playerId: string): Promise<PlayerStatistics> {
    return this.repository.getPlayerStatistics(playerId);
  }

  serialize(outcome: BattleOutcome): SerializedBattleOutcome {
    return {
      id: outcome.id,
      instanceId: outcome.instanceId,
      rulesetVersion: outcome.rulesetVersion,
      startedAt: outcome.startedAt.toISOString(),
      endedAt: outcome.endedAt.toISOString(),
      durationMs: outcome.durationMs,
      participants: serializeParticipants(outcome.participantsJson.players),
  outcome: cloneOutcomePayload(outcome.outcomeJson),
      createdAt: outcome.createdAt.toISOString()
    };
  }

  serializeMany(outcomes: BattleOutcome[]): SerializedBattleOutcome[] {
    return outcomes.map((outcome) => this.serialize(outcome));
  }
}
