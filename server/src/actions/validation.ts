import { ValidationError as TileMudValidationError } from "@@/models/errorCodes.js";
import type { ActionRequest, TilePlacementActionRequest } from "./actionRequest.js";

export interface TilePosition {
  x: number;
  y: number;
}

export interface TilePlacementActionLike {
  playerId: string;
  position: TilePosition;
  tileType: number;
  tick: number;
  requestId?: string;
  orientation?: number;
}

export interface BoardCellLike {
  tileType: number | null;
  placedByPlayer?: string;
  placedAtTick?: number;
}

export interface BoardLike {
  width: number;
  height: number;
  cells: Array<BoardCellLike | unknown>;
}

export interface TilePlacementValidationContext {
  board: BoardLike;
  currentTick: number;
  activePlayerId: string;
  playerInitiative: number;
  lastActionTick: number;
  placementRules?: PlacementRules;
}

export type PlacementAdjacency = "none" | "orthogonal" | "any";

export interface PlacementRules {
  adjacency: PlacementAdjacency;
  allowFirstPlacementAnywhere: boolean;
}

export interface ValidationIssue {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
}

const DEFAULT_PLACEMENT_RULES: PlacementRules = Object.freeze({
  adjacency: "orthogonal" as PlacementAdjacency,
  allowFirstPlacementAnywhere: true
});

const VALID_TILE_TYPES = new Set([1, 2, 3, 4, 5]);
const MIN_TICK_GAP = 2;
const MAX_FUTURE_BUFFER = 5;

function resolveTileType(cell: BoardCellLike | unknown): number | null {
  if (!cell || typeof cell !== "object") {
    return null;
  }

  if ("effectiveTileType" in (cell as Record<string, unknown>)) {
    const value = (cell as { effectiveTileType?: () => number | null }).effectiveTileType?.();
    if (typeof value === "number") {
      return value;
    }
    if (value === null || value === undefined) {
      return null;
    }
  }

  if ("tileType" in (cell as Record<string, unknown>)) {
    const raw = (cell as { tileType: unknown }).tileType;
    if (typeof raw === "number") {
      return raw >= 0 ? raw : null;
    }
  }

  return null;
}

function boardHasAnyTiles(board: BoardLike): boolean {
  return board.cells.some((cell) => resolveTileType(cell) !== null);
}

function isPositionInBounds(position: TilePosition, board: BoardLike): boolean {
  return (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    position.x >= 0 &&
    position.x < board.width &&
    position.y >= 0 &&
    position.y < board.height
  );
}

function isPositionOccupied(position: TilePosition, board: BoardLike): boolean {
  const index = ActionValidator.positionToIndex(position, board.width);
  if (index < 0 || index >= board.cells.length) {
    return true;
  }
  const cell = board.cells[index];
  const tileType = resolveTileType(cell ?? null);
  return tileType !== null;
}

function clampLimit(limit: number | undefined, fallback: number): number {
  const numeric = typeof limit === "number" ? limit : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(numeric));
}

function normalizeSince(value: Date | string | number | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isValidTileType(tileType: number): boolean {
  return Number.isInteger(tileType) && VALID_TILE_TYPES.has(tileType);
}

function validateTick(actionTick: number, context: TilePlacementValidationContext): boolean {
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

function validateSequentialTick(actionTick: number, lastActionTick: number): boolean {
  return actionTick >= lastActionTick + MIN_TICK_GAP;
}

function hasAdjacentTile(position: TilePosition, board: BoardLike, adjacency: PlacementAdjacency): boolean {
  const neighbors: TilePosition[] = adjacency === "any"
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

function isPlacementAdjacencyValid(
  position: TilePosition,
  board: BoardLike,
  rules: PlacementRules
): boolean {
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
  public readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], requestId?: string) {
    super({ issues }, requestId);
    this.name = "TilePlacementValidationError";
    this.issues = issues;
  }
}

export class ActionValidator {
  static validateTilePlacement(
    action: TilePlacementActionLike,
    context: TilePlacementValidationContext
  ): ValidationResult {
    const errors: ValidationIssue[] = [];
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

  static validateActionFormat(action: Partial<TilePlacementActionLike> & Record<string, unknown>): ValidationResult {
    const errors: ValidationIssue[] = [];

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
    } else {
      const { x, y } = action.position as TilePosition;
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

  static positionToIndex(position: TilePosition, boardWidth: number): number {
    return position.y * boardWidth + position.x;
  }

  static indexToPosition(index: number, boardWidth: number): TilePosition {
    return {
      x: index % boardWidth,
      y: Math.floor(index / boardWidth)
    };
  }

  static isActionRequest(value: unknown): value is ActionRequest {
    return Boolean(value && typeof value === "object" && "type" in (value as Record<string, unknown>));
  }
}

export function toTilePlacementActionLike(action: TilePlacementActionRequest): TilePlacementActionLike {
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

export function validateTilePlacementOrThrow(
  action: TilePlacementActionLike,
  context: TilePlacementValidationContext,
  requestId?: string
): void {
  const result = ActionValidator.validateTilePlacement(action, context);
  if (!result.isValid) {
    throw new TilePlacementValidationError(result.errors, requestId ?? action.requestId);
  }
}

export function validateActionFormatOrThrow(
  action: Partial<TilePlacementActionLike> & Record<string, unknown>,
  requestId?: string
): void {
  const result = ActionValidator.validateActionFormat(action);
  if (!result.isValid) {
    throw new TilePlacementValidationError(result.errors, requestId);
  }
}

export function normalizeListLimit(limit?: number): number {
  return clampLimit(limit, 50);
}

export function normalizeSinceTimestamp(value?: Date | string | number): Date | undefined {
  return normalizeSince(value);
}
