import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutcomeService, type RecordBattleOutcomeInput } from "../../src/services/outcomeService.js";
import type {
  BattleOutcome,
  BattleOutcomeRepository,
  CreateBattleOutcomeData,
  PlayerStatistics
} from "../../src/models/battleOutcomeRepository.js";
import { TileMudError } from "../../src/models/errorCodes.js";

interface RepositoryMocks {
  create: ReturnType<typeof vi.fn<[CreateBattleOutcomeData], Promise<BattleOutcome>>>;
  findById: ReturnType<typeof vi.fn<[string], Promise<BattleOutcome | null>>>;
  findByInstanceId: ReturnType<typeof vi.fn<[string], Promise<BattleOutcome | null>>>;
  findByPlayer: ReturnType<typeof vi.fn<[string, number, number], Promise<BattleOutcome[]>>>;
  findByRulesetVersion: ReturnType<typeof vi.fn<[string, number, number], Promise<BattleOutcome[]>>>;
  findRecent: ReturnType<typeof vi.fn<[number, number], Promise<BattleOutcome[]>>>;
  getPlayerStatistics: ReturnType<typeof vi.fn<[string], Promise<PlayerStatistics>>>;
}

function makeBattleOutcome(overrides: Partial<BattleOutcome> = {}): BattleOutcome {
  const startedAt = overrides.startedAt ?? new Date("2025-01-01T00:00:00.000Z");
  const endedAt = overrides.endedAt ?? new Date("2025-01-01T00:30:00.000Z");
  return {
    id: overrides.id ?? "outcome-1",
    instanceId: overrides.instanceId ?? "instance-1",
    rulesetVersion: overrides.rulesetVersion ?? "1.0.0",
    startedAt,
    endedAt,
    durationMs: overrides.durationMs ?? (endedAt.getTime() - startedAt.getTime()),
    participantsJson:
      overrides.participantsJson ?? {
        players: [
          {
            id: "player-1",
            displayName: "Alice",
            initiativeRank: 12,
            role: "builder",
            finalScore: 42
          }
        ]
      },
    outcomeJson:
      overrides.outcomeJson ?? {
        winner: "player-1",
        scores: {
          "player-1": 42
        }
      },
    createdAt: overrides.createdAt ?? new Date("2025-01-01T01:00:00.000Z")
  };
}

function createRepositoryMocks(): RepositoryMocks {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByInstanceId: vi.fn(),
    findByPlayer: vi.fn(),
    findByRulesetVersion: vi.fn(),
    findRecent: vi.fn(),
    getPlayerStatistics: vi.fn()
  };
}

describe("OutcomeService", () => {
  let repositoryMocks: RepositoryMocks;
  let repository: BattleOutcomeRepository;
  let service: OutcomeService;

  beforeEach(() => {
    repositoryMocks = createRepositoryMocks();

    repository = {
      create: repositoryMocks.create,
      findById: repositoryMocks.findById,
      findByInstanceId: repositoryMocks.findByInstanceId,
      findByPlayer: repositoryMocks.findByPlayer,
      findByRulesetVersion: repositoryMocks.findByRulesetVersion,
      findRecent: repositoryMocks.findRecent,
      getPlayerStatistics: repositoryMocks.getPlayerStatistics
    } as BattleOutcomeRepository;

    service = new OutcomeService({ repository });
  });

  it("retrieves and serializes an outcome by id", async () => {
    const outcome = makeBattleOutcome();
    repositoryMocks.findById.mockResolvedValue(outcome);

    const result = await service.getOutcomeById(outcome.id);

    expect(repositoryMocks.findById).toHaveBeenCalledWith(outcome.id);
    expect(result).toMatchObject({
      id: outcome.id,
      instanceId: outcome.instanceId,
      rulesetVersion: outcome.rulesetVersion,
      durationMs: outcome.durationMs,
      participants: [
        expect.objectContaining({
          playerId: "player-1",
          initiative: 12,
          stats: expect.objectContaining({ displayName: "Alice", finalScore: 42 })
        })
      ],
      outcome: outcome.outcomeJson
    });
  });

  it("throws a TileMudError when outcome is missing", async () => {
    repositoryMocks.findById.mockResolvedValue(null);

    await expect(() => service.getOutcomeById("missing", { requestId: "req-1" })).rejects.toBeInstanceOf(
      TileMudError
    );
  });

  it("lists player outcomes with clamped limit and offset", async () => {
    const outcome = makeBattleOutcome();
    repositoryMocks.findByPlayer.mockResolvedValue([outcome]);

    const result = await service.listOutcomesForPlayer("player-1", { limit: 500, offset: -10 });

    expect(repositoryMocks.findByPlayer).toHaveBeenCalledWith("player-1", 100, 0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].participants[0]).toMatchObject({ playerId: "player-1", initiative: 12 });
  });

  it("records an outcome and returns serialized payload", async () => {
    const createdOutcome = makeBattleOutcome();
    repositoryMocks.create.mockResolvedValue(createdOutcome);

    vi.useFakeTimers();
    const now = new Date("2025-02-01T10:00:00.000Z");
    vi.setSystemTime(now);

    const input: RecordBattleOutcomeInput = {
      instanceId: "instance-2",
      rulesetVersion: "2.0.0",
      startedAt: new Date("2025-02-01T09:30:00.000Z"),
      participantsJson: createdOutcome.participantsJson,
      outcomeJson: createdOutcome.outcomeJson
    };

    const result = await service.recordOutcome(input);

    expect(repositoryMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: input.instanceId,
        rulesetVersion: input.rulesetVersion,
        endedAt: now
      })
    );
    expect(result.serialized.id).toBe(createdOutcome.id);

    vi.useRealTimers();
  });
});
