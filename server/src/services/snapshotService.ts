import type {
  BattleRoomState,
  BattleRoomStatus,
  BoardCellState,
  BoardState,
  PlayerConnectionStatus
} from "@@/state/battleRoomState.js";
import type { MapSchema } from "@colyseus/schema";

export interface SnapshotServiceOptions {
  clock?: () => number;
}

export interface BoardCellSnapshot {
  tileType: number | null;
  lastUpdatedTick: number;
}

export interface BoardSnapshot {
  width: number;
  height: number;
  cells: BoardCellSnapshot[];
}

export interface PlayerSnapshot {
  id: string;
  displayName: string;
  status: PlayerConnectionStatus;
  initiative: number;
  lastActionTick: number;
  reconnectGraceEndsAt: number | null;
}

export interface NpcSnapshot {
  npcId: string;
  archetype: string;
  priorityTier: number;
  currentTick: number;
  metadata: Record<string, string>;
}

export interface PendingActionSnapshot {
  actionId: string;
  type: string;
  enqueuedAt: number;
}

export interface BattleSnapshot {
  instanceId: string;
  rulesetVersion: string;
  status: BattleRoomStatus;
  tick: number;
  startedAt: number;
  timestamp: number;
  board: BoardSnapshot;
  players: Record<string, PlayerSnapshot>;
  npcs: Record<string, NpcSnapshot>;
  pendingActions: PendingActionSnapshot[];
}

export interface PlayerViewSnapshot
  extends Pick<BattleSnapshot, "instanceId" | "rulesetVersion" | "status" | "tick" | "timestamp" | "board" | "npcs" | "pendingActions" | "startedAt"> {
  players: Record<string, PlayerSnapshot>;
}

export interface BoardDeltaEntry {
  index: number;
  tileType: number | null;
  tick: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBoardCells(board: BoardState): BoardCellSnapshot[] {
  const cells: BoardCellSnapshot[] = [];
  for (let index = 0; index < board.cells.length; index += 1) {
    const cell: BoardCellState = board.cells[index];
    cells.push({
      tileType: cell.effectiveTileType,
      lastUpdatedTick: cell.lastUpdatedTick
    });
  }
  return cells;
}

function mapPlayersFromRecord(players: Record<string, unknown>): Record<string, PlayerSnapshot> {
  const result: Record<string, PlayerSnapshot> = {};
  for (const [playerId, value] of Object.entries(players)) {
    const snapshotCandidate = value as Record<string, unknown>;
    result[playerId] = {
      id: typeof snapshotCandidate.playerId === "string"
        ? snapshotCandidate.playerId
        : typeof snapshotCandidate.id === "string"
          ? snapshotCandidate.id
          : playerId,
      displayName: typeof snapshotCandidate.displayName === "string" ? snapshotCandidate.displayName : "",
      status: (snapshotCandidate.status as PlayerConnectionStatus) ?? "active",
      initiative: typeof snapshotCandidate.initiative === "number" ? snapshotCandidate.initiative : 0,
      lastActionTick: typeof snapshotCandidate.lastActionTick === "number" ? snapshotCandidate.lastActionTick : 0,
      reconnectGraceEndsAt:
        typeof snapshotCandidate.reconnectGraceEndsAt === "number"
          ? snapshotCandidate.reconnectGraceEndsAt
          : typeof snapshotCandidate.reconnectDeadline === "number"
            ? snapshotCandidate.reconnectDeadline
            : null
    };
  }
  return result;
}

function mapNpcsFromRecord(npcs: Record<string, unknown>): Record<string, NpcSnapshot> {
  const result: Record<string, NpcSnapshot> = {};
  for (const [npcId, value] of Object.entries(npcs)) {
    const candidate = value as Record<string, unknown>;
    const metadataSource = isObject(candidate.metadata) ? (candidate.metadata as Record<string, unknown>) : {};
    const metadata: Record<string, string> = {};
    for (const [key, metadataValue] of Object.entries(metadataSource)) {
      metadata[key] = typeof metadataValue === "string" ? metadataValue : String(metadataValue);
    }

    result[npcId] = {
      npcId: typeof candidate.npcId === "string" ? candidate.npcId : npcId,
      archetype: typeof candidate.archetype === "string" ? candidate.archetype : "",
      priorityTier: typeof candidate.priorityTier === "number" ? candidate.priorityTier : 0,
      currentTick: typeof candidate.currentTick === "number" ? candidate.currentTick : 0,
      metadata
    };
  }
  return result;
}

export class SnapshotService {
  private readonly clock: () => number;

  constructor(options: SnapshotServiceOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  createSnapshot(state: BattleRoomState): BattleSnapshot {
    const timestamp = this.clock();

    const players: Record<string, PlayerSnapshot> = {};
    state.players.forEach(player => {
      players[player.playerId] = {
        id: player.playerId,
        displayName: player.displayName,
        status: player.status,
        initiative: player.initiative,
        lastActionTick: player.lastActionTick,
        reconnectGraceEndsAt: player.reconnectDeadline
      };
    });

    const npcs: Record<string, NpcSnapshot> = {};
    state.npcs.forEach(npc => {
      const metadata: Record<string, string> = {};
      npc.metadata.forEach((value, key) => {
        metadata[key] = value;
      });
      npcs[npc.npcId] = {
        npcId: npc.npcId,
        archetype: npc.archetype,
        priorityTier: npc.priorityTier,
        currentTick: npc.currentTick,
        metadata
      };
    });

    const board: BoardSnapshot = {
      width: state.board.width,
      height: state.board.height,
      cells: parseBoardCells(state.board)
    };

    const pendingActions: PendingActionSnapshot[] = state.pendingActions.map(action => ({
      actionId: action.actionId,
      type: action.type,
      enqueuedAt: action.enqueuedAt
    }));

    return {
      instanceId: state.instanceId,
      rulesetVersion: state.rulesetVersion,
      status: state.status,
      tick: state.tick,
      startedAt: state.startedAt,
      timestamp,
      board,
      players,
      npcs,
      pendingActions
    };
  }

  serialize(snapshot: BattleSnapshot): string {
    return SnapshotService.serializeSnapshot(snapshot);
  }

  deserialize(data: string): BattleSnapshot {
    return SnapshotService.deserializeSnapshot(data);
  }

  extractPlayerView(snapshot: BattleSnapshot, playerId: string): PlayerViewSnapshot {
    const player = snapshot.players[playerId];
    if (!player) {
      throw new Error(`Player ${playerId} not found in snapshot`);
    }

    const visiblePlayers: Record<string, PlayerSnapshot> = {
      [playerId]: { ...player }
    };

    for (const [id, entry] of Object.entries(snapshot.players)) {
      if (id === playerId) {
        continue;
      }
      if (entry.status !== "active") {
        continue;
      }
      visiblePlayers[id] = {
        ...entry,
        lastActionTick: 0,
        reconnectGraceEndsAt: null
      };
    }

    return {
      instanceId: snapshot.instanceId,
      rulesetVersion: snapshot.rulesetVersion,
      status: snapshot.status,
      tick: snapshot.tick,
      timestamp: snapshot.timestamp,
      board: snapshot.board,
      players: visiblePlayers,
      npcs: snapshot.npcs,
      pendingActions: snapshot.pendingActions,
      startedAt: snapshot.startedAt
    } as PlayerViewSnapshot;
  }

  calculateSnapshotSize(snapshot: BattleSnapshot): number {
    return SnapshotService.calculateSnapshotSize(snapshot);
  }

  static serializeSnapshot(snapshot: BattleSnapshot): string {
    return JSON.stringify(snapshot);
  }

  static deserializeSnapshot(data: string): BattleSnapshot {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      throw new Error("Invalid snapshot format: missing instanceId or tick");
    }

    if (!isObject(parsed) || typeof parsed.instanceId !== "string" || typeof parsed.tick !== "number") {
      throw new Error("Invalid snapshot format: missing instanceId or tick");
    }

    if (!isObject(parsed.players)) {
      throw new Error("Invalid snapshot format: missing or invalid players");
    }

    if (!isObject(parsed.board) || !Array.isArray((parsed.board as { cells?: unknown }).cells)) {
      throw new Error("Invalid snapshot format: missing or invalid board");
    }

  const players = mapPlayersFromRecord(parsed.players as Record<string, unknown>);
    const boardDetails = parsed.board as { width?: number; height?: number; cells: BoardCellSnapshot[] };
    const board: BoardSnapshot = {
      width: boardDetails.width ?? 0,
      height: boardDetails.height ?? 0,
      cells: boardDetails.cells.map(cell => ({
        tileType: cell.tileType ?? null,
        lastUpdatedTick: cell.lastUpdatedTick ?? 0
      }))
    };

  const npcs = isObject(parsed.npcs) ? mapNpcsFromRecord(parsed.npcs as Record<string, unknown>) : {};
    const pendingActions = Array.isArray(parsed.pendingActions)
      ? (parsed.pendingActions as PendingActionSnapshot[]).map(action => ({
          actionId: typeof action.actionId === "string" ? action.actionId : "",
          type: typeof action.type === "string" ? action.type : "",
          enqueuedAt: typeof action.enqueuedAt === "number" ? action.enqueuedAt : 0
        }))
      : [];

    return {
      instanceId: parsed.instanceId,
      rulesetVersion: typeof parsed.rulesetVersion === "string" ? parsed.rulesetVersion : "",
      status: (parsed.status as BattleRoomStatus) ?? "active",
      tick: parsed.tick,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      board,
      players,
      npcs,
      pendingActions
    };
  }

  static extractPlayerViewSnapshot(snapshot: BattleSnapshot, playerId: string): PlayerViewSnapshot {
    return new SnapshotService().extractPlayerView(snapshot, playerId);
  }

  static calculateSnapshotSize(snapshot: BattleSnapshot): number {
    return new TextEncoder().encode(SnapshotService.serializeSnapshot(snapshot)).length;
  }

  static computeBoardDelta(oldBoard: BoardSnapshot, newBoard: BoardSnapshot): BoardDeltaEntry[] {
    if (oldBoard.width !== newBoard.width || oldBoard.height !== newBoard.height) {
      throw new Error("Board size mismatch in delta calculation");
    }

    if (oldBoard.cells.length !== newBoard.cells.length) {
      throw new Error("Board size mismatch in delta calculation");
    }

    const changes: BoardDeltaEntry[] = [];

    for (let index = 0; index < newBoard.cells.length; index += 1) {
      const oldCell = oldBoard.cells[index];
      const newCell = newBoard.cells[index];

      if (!oldCell || !newCell) {
        continue;
      }

      if (oldCell.tileType !== newCell.tileType || oldCell.lastUpdatedTick !== newCell.lastUpdatedTick) {
        changes.push({
          index,
          tileType: newCell.tileType,
          tick: newCell.lastUpdatedTick
        });
      }
    }

    return changes;
  }
}

export function createBoardSnapshot(board: BoardState): BoardSnapshot {
  return {
    width: board.width,
    height: board.height,
    cells: parseBoardCells(board)
  };
}

export function createPlayerSnapshotRecord(players: MapSchema<any>): Record<string, PlayerSnapshot> {
  const result: Record<string, PlayerSnapshot> = {};
  players.forEach(player => {
    const identifier: string = typeof player.playerId === "string" ? player.playerId : player.id;
    result[identifier] = {
      id: identifier,
      displayName: typeof player.displayName === "string" ? player.displayName : "",
      status: player.status ?? "active",
      initiative: typeof player.initiative === "number" ? player.initiative : 0,
      lastActionTick: typeof player.lastActionTick === "number" ? player.lastActionTick : 0,
      reconnectGraceEndsAt:
        typeof player.reconnectDeadline === "number"
          ? player.reconnectDeadline
          : typeof player.reconnectGraceEndsAt === "number"
            ? player.reconnectGraceEndsAt
            : null
    };
  });
  return result;
}
