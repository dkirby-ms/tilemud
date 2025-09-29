import { describe, expect, it } from "vitest";

// Snapshot data structures
interface PlayerSnapshot {
  id: string;
  status: "active" | "disconnected";
  initiative: number;
  lastActionTick: number;
}

interface BoardSnapshot {
  width: number;
  height: number;
  cells: Array<{ tileType: number | null; lastUpdatedTick: number }>;
}

interface BattleSnapshot {
  instanceId: string;
  tick: number;
  players: Record<string, PlayerSnapshot>;
  board: BoardSnapshot;
  timestamp: number;
}

// Snapshot serializer utilities
class SnapshotSerializer {
  static serialize(snapshot: BattleSnapshot): string {
    return JSON.stringify(snapshot);
  }

  static deserialize(data: string): BattleSnapshot {
    const parsed = JSON.parse(data);
    
    // Validate required fields
    if (!parsed.instanceId || typeof parsed.tick !== "number") {
      throw new Error("Invalid snapshot format: missing instanceId or tick");
    }
    
    if (!parsed.players || typeof parsed.players !== "object") {
      throw new Error("Invalid snapshot format: missing or invalid players");
    }
    
    if (!parsed.board || !Array.isArray(parsed.board.cells)) {
      throw new Error("Invalid snapshot format: missing or invalid board");
    }
    
    return parsed as BattleSnapshot;
  }

  static extractPlayerView(snapshot: BattleSnapshot, playerId: string): Partial<BattleSnapshot> {
    // Return only the data that a specific player should see
    const playerData = snapshot.players[playerId];
    if (!playerData) {
      throw new Error(`Player ${playerId} not found in snapshot`);
    }

    return {
      instanceId: snapshot.instanceId,
      tick: snapshot.tick,
      players: {
        [playerId]: playerData,
        // Include other active players but hide sensitive data
        ...Object.fromEntries(
          Object.entries(snapshot.players)
            .filter(([id, player]) => id !== playerId && player.status === "active")
            .map(([id, player]) => [
              id, 
              { 
                id: player.id, 
                status: player.status, 
                initiative: player.initiative,
                lastActionTick: 0 // Hide specific action timing from other players
              }
            ])
        )
      },
      board: snapshot.board,
      timestamp: snapshot.timestamp
    };
  }

  static calculateSnapshotSize(snapshot: BattleSnapshot): number {
    return new TextEncoder().encode(this.serialize(snapshot)).length;
  }

  static compressBoardDelta(oldBoard: BoardSnapshot, newBoard: BoardSnapshot): Array<{ index: number; tileType: number | null; tick: number }> {
    const changes: Array<{ index: number; tileType: number | null; tick: number }> = [];
    
    if (oldBoard.cells.length !== newBoard.cells.length) {
      throw new Error("Board size mismatch in delta calculation");
    }
    
    for (let i = 0; i < newBoard.cells.length; i++) {
      const oldCell = oldBoard.cells[i];
      const newCell = newBoard.cells[i];
      
      if (oldCell.tileType !== newCell.tileType || oldCell.lastUpdatedTick !== newCell.lastUpdatedTick) {
        changes.push({
          index: i,
          tileType: newCell.tileType,
          tick: newCell.lastUpdatedTick
        });
      }
    }
    
    return changes;
  }
}

describe("Snapshot Serializer", () => {
  const sampleSnapshot: BattleSnapshot = {
    instanceId: "battle-123",
    tick: 42,
    players: {
      "player-1": {
        id: "player-1",
        status: "active",
        initiative: 10,
        lastActionTick: 40
      },
      "player-2": {
        id: "player-2",
        status: "disconnected",
        initiative: 7,
        lastActionTick: 35
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
    timestamp: 1640995200000
  };

  it("serializes and deserializes snapshots correctly", () => {
    const serialized = SnapshotSerializer.serialize(sampleSnapshot);
    expect(typeof serialized).toBe("string");
    
    const deserialized = SnapshotSerializer.deserialize(serialized);
    expect(deserialized).toEqual(sampleSnapshot);
  });

  it("validates snapshot format during deserialization", () => {
    expect(() => {
      SnapshotSerializer.deserialize("{}");
    }).toThrow("Invalid snapshot format: missing instanceId or tick");

    expect(() => {
      SnapshotSerializer.deserialize('{"instanceId": "test", "tick": 1}');
    }).toThrow("Invalid snapshot format: missing or invalid players");

    expect(() => {
      SnapshotSerializer.deserialize('{"instanceId": "test", "tick": 1, "players": {}}');
    }).toThrow("Invalid snapshot format: missing or invalid board");
  });

  it("extracts player-specific view correctly", () => {
    const playerView = SnapshotSerializer.extractPlayerView(sampleSnapshot, "player-1");
    
    expect(playerView.instanceId).toBe("battle-123");
    expect(playerView.tick).toBe(42);
    expect(playerView.board).toEqual(sampleSnapshot.board);
    
    // Should include the requesting player's full data
    expect(playerView.players!["player-1"]).toEqual(sampleSnapshot.players["player-1"]);
    
    // Should not include disconnected players
    expect(playerView.players!["player-2"]).toBeUndefined();
    
    // If there were other active players, their lastActionTick should be hidden
    // (tested with a modified sample below)
  });

  it("hides sensitive data from other players in view", () => {
    const multiPlayerSnapshot: BattleSnapshot = {
      ...sampleSnapshot,
      players: {
        ...sampleSnapshot.players,
        "player-2": { ...sampleSnapshot.players["player-2"], status: "active" }
      }
    };
    
    const playerView = SnapshotSerializer.extractPlayerView(multiPlayerSnapshot, "player-1");
    
    // Should include other active players but hide their action timing
    expect(playerView.players!["player-2"].lastActionTick).toBe(0);
    expect(playerView.players!["player-2"].initiative).toBe(7); // But keep initiative visible
  });

  it("throws error when extracting view for non-existent player", () => {
    expect(() => {
      SnapshotSerializer.extractPlayerView(sampleSnapshot, "non-existent");
    }).toThrow("Player non-existent not found in snapshot");
  });

  it("calculates snapshot size in bytes", () => {
    const size = SnapshotSerializer.calculateSnapshotSize(sampleSnapshot);
    expect(size).toBeGreaterThan(0);
    expect(typeof size).toBe("number");
    
    // Should be reasonable size (not too large)
    expect(size).toBeLessThan(10000); // Less than 10KB for this sample
  });

  it("compresses board delta efficiently", () => {
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
        ...oldBoard.cells.slice(0, 8), // Keep first 8 cells unchanged
        { tileType: 3, lastUpdatedTick: 41 } // Only change the last cell
      ]
    };

    const changes = SnapshotSerializer.compressBoardDelta(oldBoard, newBoard);
    
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      index: 8,
      tileType: 3,
      tick: 41
    });
  });

  it("handles empty delta when boards are identical", () => {
    const changes = SnapshotSerializer.compressBoardDelta(sampleSnapshot.board, sampleSnapshot.board);
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
      SnapshotSerializer.compressBoardDelta(sampleSnapshot.board, smallerBoard);
    }).toThrow("Board size mismatch in delta calculation");
  });
});