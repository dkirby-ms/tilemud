import { describe, expect, it, vi } from "vitest";
import { registerRooms } from "../../src/rooms/registerRooms.js";
import { BattleRoom, type BattleRoomDependencies } from "../../src/rooms/BattleRoom.js";
import { LobbyRoom } from "../../src/rooms/LobbyRoom.js";
import type { IRoomCache } from "colyseus";
import { createInMemoryRateLimiter } from "../../src/services/rateLimiter.js";
import { SnapshotService } from "../../src/services/snapshotService.js";

function createRuleSetDetail(version = "1.0.0") {
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
  } as const;
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
      requireRuleSetByVersion: vi.fn(async () => createRuleSetDetail())
    }
  } satisfies BattleRoomDependencies;
}

describe("registerRooms", () => {
  it("registers battle and lobby rooms with defaults", async () => {
    const battleDependencies = createBattleRoomDependencies();
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
      }
    });

    expect(result).toEqual({
      battleRoomName: "battle",
      lobbyRoomName: "lobby",
      defaultRulesetVersion: "2.0.0"
    });

    expect(define).toHaveBeenCalledTimes(2);
    expect(define).toHaveBeenNthCalledWith(1, "battle", BattleRoom);

    const lobbyCall = define.mock.calls[1];
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
      lobby: {
        name: "custom-lobby",
        defaultRulesetVersion: "1.5.0",
        dependencies: {
          createRoom
        }
      }
    });

    expect(result).toEqual({
      battleRoomName: "custom-battle",
      lobbyRoomName: "custom-lobby",
      defaultRulesetVersion: "1.5.0"
    });

    expect(define).toHaveBeenNthCalledWith(1, "custom-battle", BattleRoom);
    const lobbyCall = define.mock.calls[1];
    expect(lobbyCall[0]).toBe("custom-lobby");
    expect(lobbyCall[2]).toEqual({
      defaultRulesetVersion: "1.5.0",
      services: expect.objectContaining({
        battleRoomType: "custom-battle",
        createRoom
      })
    });
  });

  it("throws when no ruleset available and none provided", async () => {
    const battleDependencies = createBattleRoomDependencies();
    const define = vi.fn();
    const ruleSetService = {
      getLatestRuleSet: vi.fn().mockResolvedValue(null)
    };

    await expect(
      registerRooms({
        gameServer: { define } as any,
        ruleSetService,
        battleRoom: {
          dependencies: battleDependencies
        }
      })
    ).rejects.toThrow("Unable to determine default ruleset version");

    expect(define).not.toHaveBeenCalled();
  });
});
