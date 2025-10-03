import { describe, expect, it, vi } from "vitest";
import { registerRooms } from "../../src/rooms/registerRooms.js";
import { BattleRoom, type BattleRoomDependencies } from "../../src/rooms/BattleRoom.js";
import { LobbyRoom } from "../../src/rooms/LobbyRoom.js";
import { GameRoom, type GameRoomDependencies } from "../../src/rooms/GameRoom.js";
import type { IRoomCache } from "colyseus";
import { createInMemoryRateLimiter } from "../../src/services/rateLimiter.js";
import { SnapshotService } from "../../src/services/snapshotService.js";
import { PlayerSessionStore } from "../../src/models/playerSession.js";
import { MetricsService } from "../../src/services/metricsService.js";
import { VersionService } from "../../src/services/versionService.js";
import { ActionSequenceService } from "../../src/services/actionSequenceService.js";
import { ActionDurabilityService } from "../../src/services/actionDurabilityService.js";
import type { ActionEventRepository } from "../../src/models/actionEvent.js";
import type { CharacterProfileRepository } from "../../src/models/characterProfile.js";
import type { RuleSetDetail } from "../../src/services/rulesetService.js";

function createRuleSetDetail(version = "1.0.0"): RuleSetDetail {
  return {
    id: `ruleset-${version}`,
    version,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    metadata: {
      description: "Test ruleset",
      tags: ["test"],
      maxPlayers: 32,
      board: {
        width: 6,
        height: 6,
        initialTiles: []
      },
      placement: {
        adjacency: "orthogonal",
        allowFirstPlacementAnywhere: true
      },
      extras: {}
    }
  } satisfies RuleSetDetail;
}

function createBattleRoomDependencies(): BattleRoomDependencies {
  const rateLimiter = createInMemoryRateLimiter();
  const snapshotService = new SnapshotService();
  return {
    rateLimiter,
    snapshotService,
    outcomeService: {
      recordOutcome: vi.fn()
    },
    reconnectService: {
      createSession: vi.fn(),
      attemptReconnect: vi.fn(),
      removeSession: vi.fn()
    },
    messageService: {
      sendPrivateMessage: vi.fn()
    },
    ruleSetService: {
      requireRuleSetByVersion: vi.fn(async (_version: string) => createRuleSetDetail())
    }
  } satisfies BattleRoomDependencies;
}

function createGameRoomDependencies(): GameRoomDependencies {
  const sessions = new PlayerSessionStore();
  const metrics = new MetricsService();
  const versionService = new VersionService({ currentVersion: "1.0.0", supportedVersions: ["1.0.0"] });
  const sequenceService = new ActionSequenceService(sessions);

  const actionRepository: ActionEventRepository = {
    appendAction: vi.fn(async (input) => ({
      actionId: `action-${input.sessionId}-${input.sequenceNumber}`,
      sessionId: input.sessionId,
      userId: input.userId,
      characterId: input.characterId,
      sequenceNumber: input.sequenceNumber,
      actionType: input.actionType,
      payload: input.payload,
      persistedAt: new Date()
    })),
    listRecentForCharacter: vi.fn(async () => []),
    getLatestForSession: vi.fn(async () => null),
    getBySessionAndSequence: vi.fn(async () => null)
  } satisfies ActionEventRepository;

  const durabilityService = new ActionDurabilityService({ repository: actionRepository });

  const characterProfiles: CharacterProfileRepository = {
    createProfile: vi.fn(async (input) => ({
      characterId: input.characterId,
      userId: input.userId,
      displayName: input.displayName,
      positionX: input.positionX,
      positionY: input.positionY,
      health: input.health,
      inventory: input.inventory,
      stats: input.stats,
      updatedAt: new Date()
    })),
    getProfile: vi.fn(async () => null),
    updateProfile: vi.fn(async (input) => ({
      characterId: input.characterId,
      userId: input.userId,
      displayName: input.displayName ?? "Updated Hero",
      positionX: input.positionX ?? 0,
      positionY: input.positionY ?? 0,
      health: input.health ?? 100,
      inventory: input.inventory ?? {},
      stats: input.stats ?? {},
      updatedAt: new Date()
    }))
  } satisfies CharacterProfileRepository;

  return {
    sessions,
    characterProfiles,
    metrics,
    versionService,
    sequenceService,
    durabilityService,
    logger: console,
    now: () => new Date()
  } satisfies GameRoomDependencies;
}

describe("registerRooms", () => {
  it("registers battle and lobby rooms with defaults", async () => {
    const battleDependencies = createBattleRoomDependencies();
    const gameDependencies = createGameRoomDependencies();
    const define = vi.fn();
    const gameServer = { define };
    const latestRuleSet = createRuleSetDetail("2.0.0");

    const ruleSetService = {
      getLatestRuleSet: vi.fn().mockResolvedValue(latestRuleSet)
    };

    const result = await registerRooms({
      gameServer: gameServer as any,
      ruleSetService,
      battleRoom: {
        dependencies: battleDependencies
      },
      gameRoom: {
        dependencies: gameDependencies
      }
    });

    expect(result).toEqual({
      gameRoomName: "game",
      battleRoomName: "battle",
      lobbyRoomName: "lobby",
      defaultRulesetVersion: "2.0.0"
    });

    expect(define).toHaveBeenCalledTimes(3);
    expect(define).toHaveBeenNthCalledWith(1, "game", GameRoom, {
      services: expect.objectContaining({
        sessions: gameDependencies.sessions,
        characterProfiles: gameDependencies.characterProfiles,
        sequenceService: gameDependencies.sequenceService,
        durabilityService: gameDependencies.durabilityService
      })
    });

    expect(define).toHaveBeenNthCalledWith(2, "battle", BattleRoom);

    const lobbyCall = define.mock.calls[2];
    expect(lobbyCall[0]).toBe("lobby");
    expect(lobbyCall[1]).toBe(LobbyRoom);
    expect(lobbyCall[2]).toEqual({
      defaultRulesetVersion: "2.0.0",
      services: expect.objectContaining({
        battleRoomServices: expect.objectContaining({
          rateLimiter: battleDependencies.rateLimiter,
          snapshotService: battleDependencies.snapshotService
        }),
        battleRoomType: "battle"
      })
    });
  });

  it("respects explicit lobby configuration", async () => {
    const battleDependencies = createBattleRoomDependencies();
    const gameDependencies = createGameRoomDependencies();
    const define = vi.fn();
    const gameServer = { define };

    const ruleSetService = {
      getLatestRuleSet: vi.fn()
    };

    const createRoom = vi.fn(async (_roomName: string, _options: unknown): Promise<IRoomCache> => ({
      roomId: "mock-room",
      processId: "test-process",
      unlisted: false,
      locked: false,
      private: false,
      metadata: {},
      clients: 0,
      maxClients: 32,
      name: "mock-room"
    }));

    const result = await registerRooms({
      gameServer: gameServer as any,
      ruleSetService,
      battleRoom: {
        name: "custom-battle",
        dependencies: battleDependencies
      },
      gameRoom: {
        dependencies: gameDependencies
      },
      lobby: {
        name: "custom-lobby",
        defaultRulesetVersion: "1.5.0",
        dependencies: {
          createRoom
        }
      }
    });

    expect(result).toEqual({
      gameRoomName: "game",
      battleRoomName: "custom-battle",
      lobbyRoomName: "custom-lobby",
      defaultRulesetVersion: "1.5.0"
    });

    expect(define).toHaveBeenCalledTimes(3);

    expect(define).toHaveBeenNthCalledWith(1, "game", GameRoom, expect.any(Object));
    expect(define).toHaveBeenNthCalledWith(2, "custom-battle", BattleRoom);

    const lobbyCall = define.mock.calls[2];
    expect(lobbyCall[0]).toBe("custom-lobby");
    expect(lobbyCall[2]).toEqual({
      defaultRulesetVersion: "1.5.0",
      services: expect.objectContaining({
        battleRoomType: "custom-battle",
        createRoom
      })
    });
  });

  it("falls back to development ruleset version when none available", async () => {
    const battleDependencies = createBattleRoomDependencies();
    const gameDependencies = createGameRoomDependencies();
    const define = vi.fn();
    const ruleSetService = {
      getLatestRuleSet: vi.fn().mockResolvedValue(null)
    };

    const result = await registerRooms({
      gameServer: { define } as any,
      ruleSetService,
      battleRoom: {
        dependencies: battleDependencies
      },
      gameRoom: {
        dependencies: gameDependencies
      }
    });

    expect(result).toEqual({
      gameRoomName: "game",
      battleRoomName: "battle",
      lobbyRoomName: "lobby",
      defaultRulesetVersion: "0.0.0-dev"
    });

    expect(define).toHaveBeenCalledTimes(3);
    expect(define).toHaveBeenNthCalledWith(1, "game", GameRoom, expect.any(Object));
    expect(define).toHaveBeenNthCalledWith(2, "battle", BattleRoom);
    expect(define).toHaveBeenNthCalledWith(
      3,
      "lobby",
      LobbyRoom,
      expect.objectContaining({
        defaultRulesetVersion: "0.0.0-dev"
      })
    );
  });
});
