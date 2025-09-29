import { describe, expect, it } from "vitest";

// Tile placement validation types
interface TilePosition {
  x: number;
  y: number;
}

interface PlacementAction {
  playerId: string;
  position: TilePosition;
  tileType: number;
  tick: number;
}

interface BoardState {
  width: number;
  height: number;
  cells: Array<{ tileType: number | null; placedByPlayer?: string; placedAtTick?: number }>;
}

interface ValidationContext {
  board: BoardState;
  currentTick: number;
  activePlayerId: string;
  playerInitiative: number;
  lastActionTick: number;
}

// Validation result types
interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

// Action validation utilities
class ActionValidator {
  static validateTilePlacement(action: PlacementAction, context: ValidationContext): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate player authorization
    if (action.playerId !== context.activePlayerId) {
      errors.push({
        code: "INVALID_PLAYER",
        message: "Action attempted by unauthorized player",
        field: "playerId"
      });
    }

    // Validate position bounds
    if (!this.isPositionInBounds(action.position, context.board)) {
      errors.push({
        code: "POSITION_OUT_OF_BOUNDS",
        message: "Tile position is outside board boundaries",
        field: "position"
      });
    }

    // Validate tile type
    if (!this.isValidTileType(action.tileType)) {
      errors.push({
        code: "INVALID_TILE_TYPE",
        message: "Invalid tile type specified",
        field: "tileType"
      });
    }

    // Validate position availability
    if (this.isPositionOccupied(action.position, context.board)) {
      errors.push({
        code: "POSITION_OCCUPIED",
        message: "Position is already occupied by another tile",
        field: "position"
      });
    }

    // Validate timing constraints
    if (!this.isActionTimingValid(action.tick, context)) {
      errors.push({
        code: "INVALID_TIMING",
        message: "Action timing is invalid for current game state",
        field: "tick"
      });
    }

    // Validate sequential action constraints
    if (!this.isSequentialActionValid(action.tick, context.lastActionTick)) {
      errors.push({
        code: "ACTION_TOO_FREQUENT",
        message: "Actions cannot be submitted too frequently",
        field: "tick"
      });
    }

    // Validate placement adjacency rules (game-specific)
    if (!this.isPlacementAdjacencyValid(action.position, context.board)) {
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

  static validateActionFormat(action: any): ValidationResult {
    const errors: ValidationError[] = [];

    // Check required fields
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
      if (typeof action.position.x !== "number" || typeof action.position.y !== "number") {
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

  private static isPositionInBounds(position: TilePosition, board: BoardState): boolean {
    return position.x >= 0 && 
           position.x < board.width && 
           position.y >= 0 && 
           position.y < board.height;
  }

  private static isValidTileType(tileType: number): boolean {
    // Valid tile types: 1-5 (game-specific rule)
    return tileType >= 1 && tileType <= 5 && Number.isInteger(tileType);
  }

  private static isPositionOccupied(position: TilePosition, board: BoardState): boolean {
    const cellIndex = position.y * board.width + position.x;
    if (cellIndex >= board.cells.length) return true; // Out of bounds is considered occupied
    
    return board.cells[cellIndex].tileType !== null;
  }

  private static isActionTimingValid(actionTick: number, context: ValidationContext): boolean {
    // Action tick should be at or after current game tick
    return actionTick >= context.currentTick && actionTick <= context.currentTick + 5; // Allow some future buffer
  }

  private static isSequentialActionValid(actionTick: number, lastActionTick: number): boolean {
    // Minimum 2 ticks between actions
    return actionTick >= lastActionTick + 2;
  }

  private static isPlacementAdjacencyValid(position: TilePosition, board: BoardState): boolean {
    // For this game, tiles must be placed adjacent to existing tiles (except for the first tile)
    const adjacentPositions = [
      { x: position.x - 1, y: position.y },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y - 1 },
      { x: position.x, y: position.y + 1 }
    ];

    // Check if board is empty (first move)
    const hasAnyTiles = board.cells.some(cell => cell.tileType !== null);
    if (!hasAnyTiles) return true;

    // Check if at least one adjacent position has a tile
    return adjacentPositions.some(adjPos => {
      if (!this.isPositionInBounds(adjPos, board)) return false;
      const cellIndex = adjPos.y * board.width + adjPos.x;
      return board.cells[cellIndex].tileType !== null;
    });
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
}

describe("Action Validation", () => {
  const createSampleBoard = (width = 5, height = 5): BoardState => ({
    width,
    height,
    cells: Array(width * height).fill(null).map(() => ({ tileType: null }))
  });

  const createValidAction = (): PlacementAction => ({
    playerId: "player-1",
    position: { x: 2, y: 2 },
    tileType: 1,
    tick: 10
  });

  const createValidContext = (board?: BoardState): ValidationContext => ({
    board: board || createSampleBoard(),
    currentTick: 10,
    activePlayerId: "player-1",
    playerInitiative: 8,
    lastActionTick: 7
  });

  it("validates successful tile placement", () => {
    const action = createValidAction();
    const context = createValidContext();
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects placement by unauthorized player", () => {
    const action = { ...createValidAction(), playerId: "player-2" };
    const context = createValidContext();
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_PLAYER",
      message: "Action attempted by unauthorized player",
      field: "playerId"
    });
  });

  it("rejects placement outside board boundaries", () => {
    const board = createSampleBoard(3, 3);
    const action = { ...createValidAction(), position: { x: 5, y: 2 } };
    const context = createValidContext(board);
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "POSITION_OUT_OF_BOUNDS",
      message: "Tile position is outside board boundaries",
      field: "position"
    });
  });

  it("rejects invalid tile types", () => {
    const action = { ...createValidAction(), tileType: 10 }; // Invalid type
    const context = createValidContext();
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_TILE_TYPE",
      message: "Invalid tile type specified",
      field: "tileType"
    });
  });

  it("rejects placement on occupied positions", () => {
    const board = createSampleBoard();
    const cellIndex = ActionValidator.positionToIndex({ x: 2, y: 2 }, board.width);
    board.cells[cellIndex] = { tileType: 3, placedByPlayer: "player-2", placedAtTick: 5 };
    
    const action = createValidAction();
    const context = createValidContext(board);
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "POSITION_OCCUPIED",
      message: "Position is already occupied by another tile",
      field: "position"
    });
  });

  it("rejects actions with invalid timing", () => {
    const action = { ...createValidAction(), tick: 5 }; // Before current tick
    const context = createValidContext();
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_TIMING",
      message: "Action timing is invalid for current game state",
      field: "tick"
    });
  });

  it("rejects actions submitted too frequently", () => {
    const action = { ...createValidAction(), tick: 8 }; // Too soon after lastActionTick (7)
    const context = createValidContext();
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "ACTION_TOO_FREQUENT",
      message: "Actions cannot be submitted too frequently",
      field: "tick"
    });
  });

  it("allows first tile placement anywhere", () => {
    const board = createSampleBoard(); // Empty board
    const action = createValidAction();
    const context = createValidContext(board);
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(true);
  });

  it("enforces adjacency rules for subsequent tiles", () => {
    const board = createSampleBoard();
    // Place a tile at (1, 1)
    const existingTileIndex = ActionValidator.positionToIndex({ x: 1, y: 1 }, board.width);
    board.cells[existingTileIndex] = { tileType: 2, placedByPlayer: "player-2", placedAtTick: 5 };
    
    // Try to place at (4, 4) - not adjacent
    const action = { ...createValidAction(), position: { x: 4, y: 4 } };
    const context = createValidContext(board);
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_ADJACENCY",
      message: "Tile placement violates adjacency rules",
      field: "position"
    });
  });

  it("allows adjacent tile placement", () => {
    const board = createSampleBoard();
    // Place a tile at (2, 2)
    const existingTileIndex = ActionValidator.positionToIndex({ x: 2, y: 2 }, board.width);
    board.cells[existingTileIndex] = { tileType: 2, placedByPlayer: "player-2", placedAtTick: 5 };
    
    // Try to place at (2, 3) - adjacent
    const action = { ...createValidAction(), position: { x: 2, y: 3 } };
    const context = createValidContext(board);
    
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(true);
  });

  it("validates action format correctly", () => {
    const validAction = createValidAction();
    const result = ActionValidator.validateActionFormat(validAction);
    
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects malformed action objects", () => {
    const invalidAction = {
      playerId: 123, // Wrong type
      position: "invalid", // Wrong type
      // Missing tileType and tick
    };
    
    const result = ActionValidator.validateActionFormat(invalidAction);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(4); // All validation errors
    
    expect(result.errors).toContainEqual({
      code: "MISSING_PLAYER_ID",
      message: "Player ID is required and must be a string",
      field: "playerId"
    });
    
    expect(result.errors).toContainEqual({
      code: "MISSING_POSITION",
      message: "Position is required and must be an object",
      field: "position"
    });
  });

  it("handles position coordinate validation", () => {
    const invalidAction = {
      playerId: "player-1",
      position: { x: "invalid", y: null }, // Invalid coordinate types
      tileType: 1,
      tick: 10
    };
    
    const result = ActionValidator.validateActionFormat(invalidAction);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_POSITION_FORMAT",
      message: "Position x and y must be numbers",
      field: "position"
    });
  });

  it("converts between position and array index correctly", () => {
    const boardWidth = 5;
    
    // Test position to index
    expect(ActionValidator.positionToIndex({ x: 0, y: 0 }, boardWidth)).toBe(0);
    expect(ActionValidator.positionToIndex({ x: 2, y: 1 }, boardWidth)).toBe(7);
    expect(ActionValidator.positionToIndex({ x: 4, y: 3 }, boardWidth)).toBe(19);
    
    // Test index to position
    expect(ActionValidator.indexToPosition(0, boardWidth)).toEqual({ x: 0, y: 0 });
    expect(ActionValidator.indexToPosition(7, boardWidth)).toEqual({ x: 2, y: 1 });
    expect(ActionValidator.indexToPosition(19, boardWidth)).toEqual({ x: 4, y: 3 });
  });

  it("accumulates multiple validation errors", () => {
    const action = {
      playerId: "wrong-player",
      position: { x: -1, y: 10 }, // Out of bounds
      tileType: 99, // Invalid type
      tick: 5 // Invalid timing
    };
    
    const context = createValidContext();
    const result = ActionValidator.validateTilePlacement(action, context);
    
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
    
    const errorCodes = result.errors.map(e => e.code);
    expect(errorCodes).toContain("INVALID_PLAYER");
    expect(errorCodes).toContain("POSITION_OUT_OF_BOUNDS");
    expect(errorCodes).toContain("INVALID_TILE_TYPE");
    expect(errorCodes).toContain("INVALID_TIMING");
  });
});