import { ValidationError as TileMudValidationError } from "../models/errorCodes.js";
const DEFAULT_PLACEMENT_RULES = Object.freeze({
    adjacency: "orthogonal",
    allowFirstPlacementAnywhere: true
});
const VALID_TILE_TYPES = new Set([1, 2, 3, 4, 5]);
const MIN_TICK_GAP = 2;
const MAX_FUTURE_BUFFER = 5;
function resolveTileType(cell) {
    if (!cell || typeof cell !== "object") {
        return null;
    }
    if ("effectiveTileType" in cell) {
        const value = cell.effectiveTileType?.();
        if (typeof value === "number") {
            return value;
        }
        if (value === null || value === undefined) {
            return null;
        }
    }
    if ("tileType" in cell) {
        const raw = cell.tileType;
        if (typeof raw === "number") {
            return raw >= 0 ? raw : null;
        }
    }
    return null;
}
function boardHasAnyTiles(board) {
    return board.cells.some((cell) => resolveTileType(cell) !== null);
}
function isPositionInBounds(position, board) {
    return (Number.isInteger(position.x) &&
        Number.isInteger(position.y) &&
        position.x >= 0 &&
        position.x < board.width &&
        position.y >= 0 &&
        position.y < board.height);
}
function isPositionOccupied(position, board) {
    const index = ActionValidator.positionToIndex(position, board.width);
    if (index < 0 || index >= board.cells.length) {
        return true;
    }
    const cell = board.cells[index];
    const tileType = resolveTileType(cell ?? null);
    return tileType !== null;
}
function clampLimit(limit, fallback) {
    const numeric = typeof limit === "number" ? limit : Number.NaN;
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.max(1, Math.trunc(numeric));
}
function normalizeSince(value) {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function isValidTileType(tileType) {
    return Number.isInteger(tileType) && VALID_TILE_TYPES.has(tileType);
}
function validateTick(actionTick, context) {
    if (!Number.isInteger(actionTick)) {
        return false;
    }
    if (actionTick < context.currentTick) {
        return false;
    }
    if (actionTick > context.currentTick + MAX_FUTURE_BUFFER) {
        return false;
    }
    return true;
}
function validateSequentialTick(actionTick, lastActionTick) {
    return actionTick >= lastActionTick + MIN_TICK_GAP;
}
function hasAdjacentTile(position, board, adjacency) {
    const neighbors = adjacency === "any"
        ? [
            { x: position.x - 1, y: position.y - 1 },
            { x: position.x, y: position.y - 1 },
            { x: position.x + 1, y: position.y - 1 },
            { x: position.x - 1, y: position.y },
            { x: position.x + 1, y: position.y },
            { x: position.x - 1, y: position.y + 1 },
            { x: position.x, y: position.y + 1 },
            { x: position.x + 1, y: position.y + 1 }
        ]
        : [
            { x: position.x - 1, y: position.y },
            { x: position.x + 1, y: position.y },
            { x: position.x, y: position.y - 1 },
            { x: position.x, y: position.y + 1 }
        ];
    for (const neighbor of neighbors) {
        if (!isPositionInBounds(neighbor, board)) {
            continue;
        }
        const index = ActionValidator.positionToIndex(neighbor, board.width);
        if (index < 0 || index >= board.cells.length) {
            continue;
        }
        if (resolveTileType(board.cells[index]) !== null) {
            return true;
        }
    }
    return false;
}
function isPlacementAdjacencyValid(position, board, rules) {
    if (rules.adjacency === "none") {
        return true;
    }
    const hasTiles = boardHasAnyTiles(board);
    if (!hasTiles) {
        return rules.allowFirstPlacementAnywhere;
    }
    return hasAdjacentTile(position, board, rules.adjacency);
}
export class TilePlacementValidationError extends TileMudValidationError {
    issues;
    constructor(issues, requestId) {
        super({ issues }, requestId);
        this.name = "TilePlacementValidationError";
        this.issues = issues;
    }
}
export class ActionValidator {
    static validateTilePlacement(action, context) {
        const errors = [];
        const placementRules = context.placementRules ?? DEFAULT_PLACEMENT_RULES;
        if (action.playerId !== context.activePlayerId) {
            errors.push({
                code: "INVALID_PLAYER",
                message: "Action attempted by unauthorized player",
                field: "playerId"
            });
        }
        if (!isPositionInBounds(action.position, context.board)) {
            errors.push({
                code: "POSITION_OUT_OF_BOUNDS",
                message: "Tile position is outside board boundaries",
                field: "position"
            });
        }
        if (!isValidTileType(action.tileType)) {
            errors.push({
                code: "INVALID_TILE_TYPE",
                message: "Invalid tile type specified",
                field: "tileType"
            });
        }
        if (isPositionInBounds(action.position, context.board) && isPositionOccupied(action.position, context.board)) {
            errors.push({
                code: "POSITION_OCCUPIED",
                message: "Position is already occupied by another tile",
                field: "position"
            });
        }
        if (!validateTick(action.tick, context)) {
            errors.push({
                code: "INVALID_TIMING",
                message: "Action timing is invalid for current game state",
                field: "tick"
            });
        }
        if (!validateSequentialTick(action.tick, context.lastActionTick)) {
            errors.push({
                code: "ACTION_TOO_FREQUENT",
                message: "Actions cannot be submitted too frequently",
                field: "tick"
            });
        }
        if (!isPlacementAdjacencyValid(action.position, context.board, placementRules)) {
            errors.push({
                code: "INVALID_ADJACENCY",
                message: "Tile placement violates adjacency rules",
                field: "position"
            });
        }
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    static validateActionFormat(action) {
        const errors = [];
        if (!action.playerId || typeof action.playerId !== "string") {
            errors.push({
                code: "MISSING_PLAYER_ID",
                message: "Player ID is required and must be a string",
                field: "playerId"
            });
        }
        if (!action.position || typeof action.position !== "object") {
            errors.push({
                code: "MISSING_POSITION",
                message: "Position is required and must be an object",
                field: "position"
            });
        }
        else {
            const { x, y } = action.position;
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                errors.push({
                    code: "INVALID_POSITION_FORMAT",
                    message: "Position x and y must be numbers",
                    field: "position"
                });
            }
        }
        if (typeof action.tileType !== "number") {
            errors.push({
                code: "MISSING_TILE_TYPE",
                message: "Tile type is required and must be a number",
                field: "tileType"
            });
        }
        if (typeof action.tick !== "number") {
            errors.push({
                code: "MISSING_TICK",
                message: "Tick is required and must be a number",
                field: "tick"
            });
        }
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    static positionToIndex(position, boardWidth) {
        return position.y * boardWidth + position.x;
    }
    static indexToPosition(index, boardWidth) {
        return {
            x: index % boardWidth,
            y: Math.floor(index / boardWidth)
        };
    }
    static isActionRequest(value) {
        return Boolean(value && typeof value === "object" && "type" in value);
    }
}
export function toTilePlacementActionLike(action) {
    return {
        playerId: action.playerId,
        position: {
            x: action.payload.position.x,
            y: action.payload.position.y
        },
        tileType: action.payload.tileType,
        orientation: action.payload.orientation,
        tick: action.requestedTick ?? action.timestamp,
        requestId: action.payload.clientRequestId
    };
}
export function validateTilePlacementOrThrow(action, context, requestId) {
    const result = ActionValidator.validateTilePlacement(action, context);
    if (!result.isValid) {
        throw new TilePlacementValidationError(result.errors, requestId ?? action.requestId);
    }
}
export function validateActionFormatOrThrow(action, requestId) {
    const result = ActionValidator.validateActionFormat(action);
    if (!result.isValid) {
        throw new TilePlacementValidationError(result.errors, requestId);
    }
}
export function normalizeListLimit(limit) {
    return clampLimit(limit, 50);
}
export function normalizeSinceTimestamp(value) {
    return normalizeSince(value);
}
//# sourceMappingURL=validation.js.map