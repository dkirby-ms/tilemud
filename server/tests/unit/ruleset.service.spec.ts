import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuleSetService, RuleSetNotFoundError } from "../../src/services/rulesetService.js";
import type { RuleSetRepository, RuleSetVersion, CreateRuleSetData } from "../../src/models/rulesetRepository.js";

interface RepositoryMocks {
  create: ReturnType<typeof vi.fn<[CreateRuleSetData], Promise<RuleSetVersion>>>;
  findById: ReturnType<typeof vi.fn<[string], Promise<RuleSetVersion | null>>>;
  findByVersion: ReturnType<typeof vi.fn<[string], Promise<RuleSetVersion | null>>>;
  findLatestVersion: ReturnType<typeof vi.fn<[], Promise<RuleSetVersion | null>>>;
  listAll: ReturnType<typeof vi.fn<[number?, number?], Promise<RuleSetVersion[]>>>;
  listVersions: ReturnType<typeof vi.fn<[], Promise<string[]>>>;
}

function createRuleSet(overrides: Partial<RuleSetVersion> = {}): RuleSetVersion {
  return {
    id: overrides.id ?? "ruleset-1",
    version: overrides.version ?? "1.0.0",
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
    metadataJson: overrides.metadataJson ?? {
      board: {
        width: 10,
        height: 10,
        initialTiles: []
      },
      placement: {
        adjacency: "orthogonal",
        allowFirstPlacementAnywhere: true
      },
      maxPlayers: 32,
      tags: []
    }
  };
}

describe("RuleSetService", () => {
  let repositoryMocks: RepositoryMocks;
  let repository: RuleSetRepository;
  let service: RuleSetService;

  beforeEach(() => {
    repositoryMocks = {
      create: vi.fn<[CreateRuleSetData], Promise<RuleSetVersion>>(),
      findById: vi.fn<[string], Promise<RuleSetVersion | null>>(),
      findByVersion: vi.fn<[string], Promise<RuleSetVersion | null>>(),
      findLatestVersion: vi.fn<[], Promise<RuleSetVersion | null>>(),
      listAll: vi.fn<[number?, number?], Promise<RuleSetVersion[]>>(),
      listVersions: vi.fn<[], Promise<string[]>>()
    };

    repository = {
      create: repositoryMocks.create,
      findById: repositoryMocks.findById,
      findByVersion: repositoryMocks.findByVersion,
      findLatestVersion: repositoryMocks.findLatestVersion,
      listAll: repositoryMocks.listAll,
      listVersions: repositoryMocks.listVersions
    } as RuleSetRepository;

    service = new RuleSetService({ repository });
  });

  it("publishes rule sets with normalized metadata and duplicate guard", async () => {
    repositoryMocks.findByVersion.mockResolvedValue(null);
    repositoryMocks.create.mockImplementation(async (data) =>
      createRuleSet({
        version: data.version,
        metadataJson: data.metadataJson
      })
    );

    const result = await service.publishRuleSet({
      version: "1.2.3",
      metadata: {
        board: {
          width: 8,
          height: 6,
          initialTiles: [
            { x: 2, y: 2, tileType: 5 },
            { x: -1, y: 0, tileType: 7 }
          ]
        },
        maxPlayers: 80,
        tags: ["Alpha", "alpha", " beta "],
        placement: {
          adjacency: "ANY",
          allowFirstPlacementAnywhere: false
        },
        extras: {
          difficulty: "hard",
          npcScaling: { tier: 2 }
        },
        difficulty: "hard"
      }
    });

    expect(repositoryMocks.create).toHaveBeenCalledWith({
      version: "1.2.3",
      metadataJson: {
        board: {
          width: 8,
          height: 6,
          initialTiles: [{ x: 2, y: 2, tileType: 5 }]
        },
        placement: {
          adjacency: "any",
          allowFirstPlacementAnywhere: false
        },
        maxPlayers: 64,
        tags: ["Alpha", "beta"],
        extras: {
          difficulty: "hard",
          npcScaling: { tier: 2 }
        }
      }
    });

    expect(result.version).toBe("1.2.3");
    expect(result.metadata.board.width).toBe(8);
    expect(result.metadata.board.height).toBe(6);
    expect(result.metadata.board.initialTiles).toEqual([{ x: 2, y: 2, tileType: 5 }]);
    expect(result.metadata.maxPlayers).toBe(64);
    expect(result.metadata.tags).toEqual(["Alpha", "beta"]);
    expect(result.metadata.placement.adjacency).toBe("any");
    expect(result.metadata.placement.allowFirstPlacementAnywhere).toBe(false);
    expect(result.metadata.extras).toEqual({
      difficulty: "hard",
      npcScaling: { tier: 2 }
    });
  });

  it("rejects invalid semantic version strings", async () => {
    await expect(
      service.publishRuleSet({
        version: "1.2",
        metadata: {}
      })
    ).rejects.toThrow(/semantic version/i);
  });

  it("rejects duplicate version publication", async () => {
    repositoryMocks.findByVersion.mockResolvedValue(createRuleSet({ version: "2.0.0" }));

    await expect(
      service.publishRuleSet({
        version: "2.0.0",
        metadata: {}
      })
    ).rejects.toThrow(/already exists/i);

    expect(repositoryMocks.create).not.toHaveBeenCalled();
  });

  it("retrieves and normalizes rule sets by version and id", async () => {
    const stored = createRuleSet({
      id: "ruleset-xyz",
      version: "3.0.0",
      metadataJson: {
        board: { width: 12, height: 12, initialTiles: [] },
        maxPlayers: 20,
        placement: { adjacency: "orthogonal", allowFirstPlacementAnywhere: true },
        tags: ["standard"],
        extras: { rotation: "clockwise" }
      }
    });

    repositoryMocks.findByVersion.mockResolvedValue(stored);
    repositoryMocks.findById.mockResolvedValue(stored);

    const byVersion = await service.requireRuleSetByVersion("3.0.0");
    const byId = await service.requireRuleSetById("ruleset-xyz");

    expect(byVersion.metadata.board.width).toBe(12);
    expect(byId.metadata.maxPlayers).toBe(20);
    expect(byId.metadata.extras).toEqual({ rotation: "clockwise" });
  });

  it("throws RuleSetNotFoundError when rule set is missing", async () => {
    repositoryMocks.findByVersion.mockResolvedValue(null);

    await expect(service.requireRuleSetByVersion("9.9.9")).rejects.toBeInstanceOf(RuleSetNotFoundError);
  });

  it("returns the latest rule set when available", async () => {
    const stored = createRuleSet({ version: "4.0.0" });
    repositoryMocks.findLatestVersion.mockResolvedValue(stored);

    const latest = await service.getLatestRuleSet();

    expect(latest?.version).toBe("4.0.0");
  });

  it("lists rule sets with cloned metadata objects", async () => {
    const stored = createRuleSet({
      metadataJson: {
        board: { width: 10, height: 10, initialTiles: [{ x: 0, y: 0, tileType: 1 }] },
        placement: { adjacency: "orthogonal", allowFirstPlacementAnywhere: true },
        maxPlayers: 32,
        tags: ["core"]
      }
    });

    repositoryMocks.listAll.mockImplementation(async () => [stored]);

    const firstList = await service.listRuleSets();
    firstList[0].metadata.board.width = 999;
    firstList[0].metadata.board.initialTiles[0].x = 5;

    const secondList = await service.listRuleSets();

    expect(secondList[0].metadata.board.width).toBe(10);
    expect(secondList[0].metadata.board.initialTiles[0]).toEqual({ x: 0, y: 0, tileType: 1 });
  });
});
