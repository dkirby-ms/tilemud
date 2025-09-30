import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BattleRoom, type BattleRoomCreateOptions, type BattleRoomDependencies } from "../../src/rooms/BattleRoom.js";
import { createInMemoryRateLimiter } from "../../src/services/rateLimiter.js";
import { SnapshotService } from "../../src/services/snapshotService.js";
import type { RuleSetDetail, RuleSetService } from "../../src/services/rulesetService.js";
import type { ActionRequest } from "../../src/actions/actionRequest.js";

interface CreateDependenciesOptions {
  now?: () => number;
}

class StubRuleSetService implements Pick<RuleSetService, "requireRuleSetByVersion"> {
  constructor(private readonly detail: RuleSetDetail) {}

  async requireRuleSetByVersion(): Promise<RuleSetDetail> {
    return this.detail;
  }
}

function createRuleSetDetail(): RuleSetDetail {
  return {
    id: "ruleset-id",
    version: "1.0.0",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    metadata: {
      description: "Test ruleset",
      tags: ["test"],
      maxPlayers: 32,
      board: {
        width: 6,
        height: 6,
        initialTiles: [{ x: 1, y: 1, tileType: 2 }]
      },
      placement: {
        adjacency: "orthogonal",
        allowFirstPlacementAnywhere: true
      },
      extras: {}
    }
  };
}

function createDependencies(options: CreateDependenciesOptions = {}): BattleRoomDependencies {
  const now = options.now ?? (() => Date.now());

  const ruleSetDetail = createRuleSetDetail();

  return {
    rateLimiter: createInMemoryRateLimiter({ clock: now }),
    snapshotService: new SnapshotService({ clock: now }),
    outcomeService: {
      recordOutcome: vi.fn()
    },
    reconnectService: {
      createSession: vi.fn().mockImplementation(async ({ playerId, instanceId, sessionId, playerState, gracePeriodMs }) => ({
        playerId,
        instanceId,
        sessionId,
        disconnectedAt: now(),
        gracePeriodMs: gracePeriodMs ?? 60_000,
        playerState
      })),
      attemptReconnect: vi.fn(),
      removeSession: vi.fn()
    },
    messageService: {
      sendPrivateMessage: vi.fn()
    },
    ruleSetService: new StubRuleSetService(ruleSetDetail),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    now,
    defaultGracePeriodMs: 60_000
  };
}

function createClient(sessionId: string): Client {
  return {
    id: sessionId,
    sessionId,
    state: 1,
    auth: {},
    userData: {},
    _enqueuedMessages: [],
    send: vi.fn(),
    error: vi.fn(),
    leave: vi.fn()
  } as unknown as Client;
}

async function createRoom(overrides: Partial<BattleRoomDependencies> = {}): Promise<{
  room: BattleRoom;
  dependencies: BattleRoomDependencies;
}> {
  const dependencies = { ...createDependencies(), ...overrides } as BattleRoomDependencies;
  const room = new BattleRoom();
  room.setMetadata = vi.fn();
  await room.onCreate({
    instanceId: "instance-1",
    rulesetVersion: "1.0.0",
    services: dependencies
  } satisfies BattleRoomCreateOptions);
  return { room, dependencies };
}

describe("BattleRoom", () => {
  let room: BattleRoom;
  let dependencies: BattleRoomDependencies;

  beforeEach(async () => {
    ({ room, dependencies } = await createRoom());
  });

  it("configures board dimensions and initial tiles from ruleset metadata", () => {
    expect(room.state.instanceId).toBe("instance-1");
    expect(room.state.rulesetVersion).toBe("1.0.0");
    expect(room.state.board.width).toBe(6);
    expect(room.state.board.height).toBe(6);

    const cell = room.state.board.getCell({ x: 1, y: 1 });
    expect(cell?.tileType).toBe(2);
  });

  it("registers joining players in state", async () => {
    const client = createClient("session-1");

    await room.onJoin(client, {
      playerId: "player-1",
      displayName: "Player One",
      initiative: 12
    });

    const player = room.state.players.get("player-1");
    expect(player).toBeDefined();
    expect(player?.displayName).toBe("Player One");
    expect(player?.initiative).toBe(12);
    expect(player?.status).toBe("active");
  });

  it("processes tile placement actions via action handler", async () => {
    const client = createClient("session-1");

    await room.onJoin(client, {
      playerId: "player-1",
      displayName: "Player One",
      initiative: 10
    });

    const action: ActionRequest = {
      id: "action-1",
      type: "tile_placement",
      instanceId: "instance-1",
      timestamp: 2,
      requestedTick: 4,
      playerId: "player-1",
      playerInitiative: 10,
      lastActionTick: 0,
      payload: {
        position: { x: 1, y: 2 },
        tileType: 4,
        clientRequestId: "req-1"
      }
    } as ActionRequest;

    await (room as unknown as { handleActionSubmit: (client: Client, message: unknown) => Promise<void> })
      .handleActionSubmit(client, action);

    const cell = room.state.board.getCell({ x: 1, y: 2 });
    expect(cell?.tileType).toBe(4);
    expect(room.state.pendingActions.length).toBe(0);

    const player = room.state.players.get("player-1");
    expect(player?.lastActionTick).toBe(4);
  });

  it("creates reconnect session when player disconnects unexpectedly", async () => {
    const now = () => 50_000;
    ({ room, dependencies } = await createRoom({ now }));

    const client = createClient("session-1");
    await room.onJoin(client, {
      playerId: "player-2",
      displayName: "Player Two",
      initiative: 9
    });

    await room.onLeave(client, false);

    const createSession = dependencies.reconnectService.createSession as ReturnType<typeof vi.fn>;
    expect(createSession).toHaveBeenCalled();

    const player = room.state.players.get("player-2");
    expect(player?.status).toBe("disconnected");
    expect(player?.reconnectGraceEndsAt).toBeGreaterThan(now());
  });
});
