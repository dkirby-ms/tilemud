import { ArraySchema, MapSchema, Schema, defineTypes } from "@colyseus/schema";
export class BoardCellState extends Schema {
    /**
     * Tile type identifier stored as a signed integer. A value of -1 indicates the cell is empty.
     */
    tileType = -1;
    lastUpdatedTick = 0;
    lastUpdatedByPlayerId = "";
    get hasTile() {
        return this.tileType >= 0;
    }
    get effectiveTileType() {
        return this.hasTile ? this.tileType : null;
    }
    get lastUpdatedBy() {
        return this.lastUpdatedByPlayerId === "" ? null : this.lastUpdatedByPlayerId;
    }
    clearMetadata() {
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
    cells = new ArraySchema();
    constructor(dimensions) {
        super();
        if (dimensions) {
            this.configure(dimensions);
        }
    }
    configure({ width, height }) {
        this.width = width;
        this.height = height;
        this.cells = new ArraySchema();
        const total = width * height;
        for (let index = 0; index < total; index += 1) {
            this.cells.push(new BoardCellState());
        }
    }
    coordinateToIndex({ x, y }) {
        return y * this.width + x;
    }
    isWithinBounds({ x, y }) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }
    getCell(coordinate) {
        if (!this.isWithinBounds(coordinate)) {
            return undefined;
        }
        const index = this.coordinateToIndex(coordinate);
        return this.cells[index];
    }
    applyTilePlacement(coordinate, tileType, tick, playerId) {
        const cell = this.getCell(coordinate);
        if (!cell) {
            throw new RangeError(`Coordinate (${coordinate.x}, ${coordinate.y}) is outside board bounds.`);
        }
        cell.tileType = tileType;
        cell.lastUpdatedTick = tick;
        cell.lastUpdatedByPlayerId = playerId;
    }
    clearTile(coordinate, tick) {
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
    playerId;
    displayName = "";
    status = "active";
    initiative = 0;
    lastActionTick = 0;
    reconnectGraceEndsAt = 0;
    get hasDisplayName() {
        return this.displayName !== "";
    }
    get reconnectDeadline() {
        return this.reconnectGraceEndsAt === 0 ? null : this.reconnectGraceEndsAt;
    }
    set reconnectDeadline(value) {
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
    npcId;
    archetype = "";
    priorityTier = 0;
    currentTick = 0;
    metadata = new MapSchema();
}
defineTypes(NpcState, {
    npcId: "string",
    archetype: "string",
    priorityTier: "int16",
    currentTick: "uint32",
    metadata: { map: "string" }
});
export class PendingActionState extends Schema {
    actionId;
    type;
    enqueuedAt;
}
defineTypes(PendingActionState, {
    actionId: "string",
    type: "string",
    enqueuedAt: "uint64"
});
export class BattleRoomState extends Schema {
    instanceId;
    rulesetVersion;
    status = "active";
    tick = 0;
    startedAt = Date.now();
    board = new BoardState();
    players = new MapSchema();
    npcs = new MapSchema();
    pendingActions = new ArraySchema();
    get playerCount() {
        return this.players.size;
    }
    enqueueAction(action) {
        const entry = new PendingActionState();
        entry.actionId = action.id;
        entry.type = action.type;
        entry.enqueuedAt = action.timestamp;
        this.pendingActions.push(entry);
    }
    clearPendingActions() {
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
export function createBattleRoomState(options) {
    const state = new BattleRoomState();
    state.instanceId = options.instanceId;
    state.rulesetVersion = options.rulesetVersion;
    state.status = "active";
    state.tick = options.initialTick ?? 0;
    state.startedAt = options.startedAt ?? Date.now();
    state.board.configure(options.board);
    return state;
}
export function isBoardCoordinateWithinBounds(board, coordinate) {
    return board.isWithinBounds(coordinate);
}
//# sourceMappingURL=battleRoomState.js.map