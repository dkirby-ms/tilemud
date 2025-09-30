import { ArraySchema, MapSchema, Schema, defineTypes } from "@colyseus/schema";
import type { ActionRequest } from "../actions/actionRequest.js";

export type BattleRoomStatus = "active" | "ending" | "ended" | "terminated";
export type PlayerConnectionStatus = "active" | "disconnected";

export interface BoardDimensions {
  width: number;
  height: number;
}

export interface BoardCoordinate {
  x: number;
  y: number;
}

export interface CreateBattleRoomStateOptions {
  instanceId: string;
  rulesetVersion: string;
  board: BoardDimensions;
  /** Epoch milliseconds for when the instance began. Defaults to `Date.now()`. */
  startedAt?: number;
  /** Starting tick for the simulation. Defaults to 0. */
  initialTick?: number;
}

export class BoardCellState extends Schema {
  /**
   * Tile type identifier stored as a signed integer. A value of -1 indicates the cell is empty.
   */
  tileType = -1;
  lastUpdatedTick = 0;
  lastUpdatedByPlayerId = "";

  get hasTile(): boolean {
    return this.tileType >= 0;
  }

  get effectiveTileType(): number | null {
    return this.hasTile ? this.tileType : null;
  }

  get lastUpdatedBy(): string | null {
    return this.lastUpdatedByPlayerId === "" ? null : this.lastUpdatedByPlayerId;
  }

  clearMetadata(): void {
    this.lastUpdatedTick = 0;
    this.lastUpdatedByPlayerId = "";
  }
}

defineTypes(BoardCellState, {
  tileType: "int16",
  lastUpdatedTick: "uint32",
  lastUpdatedByPlayerId: "string"
});

export class BoardState extends Schema {
  width = 0;
  height = 0;
  cells = new ArraySchema<BoardCellState>();

  constructor(dimensions?: BoardDimensions) {
    super();
    if (dimensions) {
      this.configure(dimensions);
    }
  }

  configure({ width, height }: BoardDimensions): void {
    this.width = width;
    this.height = height;
    this.cells = new ArraySchema<BoardCellState>();

    const total = width * height;
    for (let index = 0; index < total; index += 1) {
      this.cells.push(new BoardCellState());
    }
  }

  coordinateToIndex({ x, y }: BoardCoordinate): number {
    return y * this.width + x;
  }

  isWithinBounds({ x, y }: BoardCoordinate): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getCell(coordinate: BoardCoordinate): BoardCellState | undefined {
    if (!this.isWithinBounds(coordinate)) {
      return undefined;
    }
    const index = this.coordinateToIndex(coordinate);
    return this.cells[index];
  }

  applyTilePlacement(coordinate: BoardCoordinate, tileType: number, tick: number, playerId: string): void {
    const cell = this.getCell(coordinate);
    if (!cell) {
      throw new RangeError(`Coordinate (${coordinate.x}, ${coordinate.y}) is outside board bounds.`);
    }

    cell.tileType = tileType;
    cell.lastUpdatedTick = tick;
    cell.lastUpdatedByPlayerId = playerId;
  }

  clearTile(coordinate: BoardCoordinate, tick: number): void {
    const cell = this.getCell(coordinate);
    if (!cell) {
      throw new RangeError(`Coordinate (${coordinate.x}, ${coordinate.y}) is outside board bounds.`);
    }

    cell.tileType = -1;
    cell.lastUpdatedTick = tick;
    cell.lastUpdatedByPlayerId = "";
  }
}

defineTypes(BoardState, {
  width: "uint16",
  height: "uint16",
  cells: { array: BoardCellState }
});

export class PlayerSessionState extends Schema {
  playerId!: string;
  displayName = "";
  status: PlayerConnectionStatus = "active";
  initiative = 0;
  lastActionTick = 0;
  reconnectGraceEndsAt = 0;

  get hasDisplayName(): boolean {
    return this.displayName !== "";
  }

  get reconnectDeadline(): number | null {
    return this.reconnectGraceEndsAt === 0 ? null : this.reconnectGraceEndsAt;
  }

  set reconnectDeadline(value: number | null) {
    this.reconnectGraceEndsAt = value ?? 0;
  }
}

defineTypes(PlayerSessionState, {
  playerId: "string",
  displayName: "string",
  status: "string",
  initiative: "int16",
  lastActionTick: "uint32",
  reconnectGraceEndsAt: "uint64"
});

export class NpcState extends Schema {
  npcId!: string;
  archetype = "";
  priorityTier = 0;
  currentTick = 0;
  metadata = new MapSchema<string>();
}

defineTypes(NpcState, {
  npcId: "string",
  archetype: "string",
  priorityTier: "int16",
  currentTick: "uint32",
  metadata: { map: "string" }
});

export class PendingActionState extends Schema {
  actionId!: string;
  type!: string;
  enqueuedAt!: number;
}

defineTypes(PendingActionState, {
  actionId: "string",
  type: "string",
  enqueuedAt: "uint64"
});

export class BattleRoomState extends Schema {
  instanceId!: string;
  rulesetVersion!: string;
  status: BattleRoomStatus = "active";
  tick = 0;
  startedAt = Date.now();
  board = new BoardState();
  players = new MapSchema<PlayerSessionState>();
  npcs = new MapSchema<NpcState>();
  pendingActions = new ArraySchema<PendingActionState>();

  get playerCount(): number {
    return this.players.size;
  }

  enqueueAction(action: ActionRequest): void {
    const entry = new PendingActionState();
    entry.actionId = action.id;
    entry.type = action.type;
    entry.enqueuedAt = action.timestamp;
    this.pendingActions.push(entry);
  }

  clearPendingActions(): void {
    this.pendingActions.splice(0, this.pendingActions.length);
  }
}

defineTypes(BattleRoomState, {
  instanceId: "string",
  rulesetVersion: "string",
  status: "string",
  tick: "uint32",
  startedAt: "uint64",
  board: BoardState,
  players: { map: PlayerSessionState },
  npcs: { map: NpcState },
  pendingActions: { array: PendingActionState }
});

export function createBattleRoomState(options: CreateBattleRoomStateOptions): BattleRoomState {
  const state = new BattleRoomState();
  state.instanceId = options.instanceId;
  state.rulesetVersion = options.rulesetVersion;
  state.status = "active";
  state.tick = options.initialTick ?? 0;
  state.startedAt = options.startedAt ?? Date.now();
  state.board.configure(options.board);
  return state;
}

export function isBoardCoordinateWithinBounds(
  board: BoardState,
  coordinate: BoardCoordinate
): boolean {
  return board.isWithinBounds(coordinate);
}
