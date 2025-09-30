import { beforeEach, describe, expect, it } from "vitest";
import {
  BattleSnapshot,
  BoardSnapshot,
  SnapshotService
} from "../../src/services/snapshotService.js";
import { createBattleRoomState, PlayerSessionState } from "../../src/state/battleRoomState.js";

describe("Snapshot Service", () => {
  let service: SnapshotService;

  const sampleSnapshot: BattleSnapshot = {
    instanceId: "battle-123",
    rulesetVersion: "ruleset-1.0.0",
    status: "active",
    tick: 42,
    startedAt: 1640995100000,
    timestamp: 1640995200000,
    players: {
      "player-1": {
        id: "player-1",
        displayName: "Player One",
        status: "active",
        initiative: 10,
        lastActionTick: 40,
        reconnectGraceEndsAt: null
      },
      "player-2": {
        id: "player-2",
        displayName: "Player Two",
        status: "disconnected",
        initiative: 7,
        lastActionTick: 35,
        reconnectGraceEndsAt: null
      }
    },
    board: {
      width: 3,
      height: 3,
      cells: [
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 1, lastUpdatedTick: 25 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 2, lastUpdatedTick: 30 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 1, lastUpdatedTick: 38 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 3, lastUpdatedTick: 41 }
      ]
    },
    npcs: {},
    pendingActions: []
  };

  beforeEach(() => {
    service = new SnapshotService();
  });

  it("serializes and deserializes snapshots correctly", () => {
    const serialized = service.serialize(sampleSnapshot);
    expect(typeof serialized).toBe("string");

    const deserialized = service.deserialize(serialized);
    expect(deserialized).toEqual(sampleSnapshot);
  });

  it("validates snapshot format during deserialization", () => {
    expect(() => {
      service.deserialize("{}");
    }).toThrow("Invalid snapshot format: missing instanceId or tick");

    expect(() => {
      service.deserialize('{"instanceId": "test", "tick": 1}');
    }).toThrow("Invalid snapshot format: missing or invalid players");

    expect(() => {
      service.deserialize('{"instanceId": "test", "tick": 1, "players": {}}');
    }).toThrow("Invalid snapshot format: missing or invalid board");
  });

  it("extracts player-specific view correctly", () => {
    const playerView = service.extractPlayerView(sampleSnapshot, "player-1");

    expect(playerView.instanceId).toBe("battle-123");
    expect(playerView.tick).toBe(42);
    expect(playerView.board).toEqual(sampleSnapshot.board);

    expect(playerView.players["player-1"]).toEqual(sampleSnapshot.players["player-1"]);
    expect(playerView.players["player-2"]).toBeUndefined();
  });

  it("hides sensitive data from other players in view", () => {
    const multiPlayerSnapshot: BattleSnapshot = {
      ...sampleSnapshot,
      players: {
        ...sampleSnapshot.players,
        "player-2": { ...sampleSnapshot.players["player-2"], status: "active" }
      }
    };

    const playerView = service.extractPlayerView(multiPlayerSnapshot, "player-1");

    expect(playerView.players["player-2"].lastActionTick).toBe(0);
    expect(playerView.players["player-2"].initiative).toBe(7);
  });

  it("throws error when extracting view for non-existent player", () => {
    expect(() => {
      service.extractPlayerView(sampleSnapshot, "non-existent");
    }).toThrow("Player non-existent not found in snapshot");
  });

  it("calculates snapshot size in bytes", () => {
    const size = service.calculateSnapshotSize(sampleSnapshot);
    expect(size).toBeGreaterThan(0);
    expect(typeof size).toBe("number");
    expect(size).toBeLessThan(10_000);
  });

  it("computes board delta efficiently", () => {
    const oldBoard: BoardSnapshot = {
      width: 3,
      height: 3,
      cells: [
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 1, lastUpdatedTick: 25 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 2, lastUpdatedTick: 30 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 1, lastUpdatedTick: 38 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: null, lastUpdatedTick: 0 }
      ]
    };

    const newBoard: BoardSnapshot = {
      ...oldBoard,
      cells: [
        ...oldBoard.cells.slice(0, 8),
        { tileType: 3, lastUpdatedTick: 41 }
      ]
    };

    const changes = SnapshotService.computeBoardDelta(oldBoard, newBoard);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ index: 8, tileType: 3, tick: 41 });
  });

  it("handles empty delta when boards are identical", () => {
    const changes = SnapshotService.computeBoardDelta(sampleSnapshot.board, sampleSnapshot.board);
    expect(changes).toHaveLength(0);
  });

  it("throws error for mismatched board sizes in delta", () => {
    const smallerBoard: BoardSnapshot = {
      width: 2,
      height: 2,
      cells: [
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 1, lastUpdatedTick: 25 },
        { tileType: null, lastUpdatedTick: 0 },
        { tileType: 2, lastUpdatedTick: 30 }
      ]
    };

    expect(() => {
      SnapshotService.computeBoardDelta(sampleSnapshot.board, smallerBoard);
    }).toThrow("Board size mismatch in delta calculation");
  });

  it("creates snapshots from battle room state", () => {
    const state = createBattleRoomState({
      instanceId: "instance-1",
      rulesetVersion: "ruleset-1.2.3",
      board: { width: 2, height: 2 },
      startedAt: 1_640_995_100_000,
      initialTick: 5
    });

    const player = new PlayerSessionState();
    player.playerId = "player-99";
    player.displayName = "Player 99";
    player.status = "active";
    player.initiative = 12;
    player.lastActionTick = 4;
    player.reconnectDeadline = 1_640_995_160_000;
    state.players.set(player.playerId, player);

    state.board.applyTilePlacement({ x: 1, y: 0 }, 3, 6, player.playerId);

    const snapshot = service.createSnapshot(state);

    expect(snapshot.instanceId).toBe("instance-1");
    expect(snapshot.rulesetVersion).toBe("ruleset-1.2.3");
    expect(snapshot.tick).toBe(5);
    expect(snapshot.players["player-99"].reconnectGraceEndsAt).toBe(1_640_995_160_000);
    expect(snapshot.board.cells[1]).toEqual({ tileType: 3, lastUpdatedTick: 6 });
  });
});