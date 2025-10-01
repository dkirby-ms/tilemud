import { describe, expect, it } from "vitest";
import {
  ActionValidator,
  TilePlacementValidationError,
  toTilePlacementActionLike,
  validateActionFormatOrThrow,
  validateTilePlacementOrThrow,
  type PlacementRules,
  type TilePlacementActionLike,
  type TilePlacementValidationContext
} from "../../src/actions/validation.js";
import type { TilePlacementActionRequest } from "../../src/actions/actionRequest.js";

type BoardCell = { tileType: number | null; placedByPlayer?: string; placedAtTick?: number };

type TestBoard = {
  width: number;
  height: number;
  cells: BoardCell[];
};

const DEFAULT_PLACEMENT_RULES: PlacementRules = {
  adjacency: "orthogonal",
  allowFirstPlacementAnywhere: true
};

function createBoard(width = 5, height = 5): TestBoard {
  return {
    width,
    height,
    cells: Array.from({ length: width * height }, () => ({ tileType: null }))
  };
}

function setTile(board: TestBoard, position: { x: number; y: number }, tileType = 1): void {
  const index = ActionValidator.positionToIndex(position, board.width);
  board.cells[index] = {
    tileType,
    placedByPlayer: "seed",
    placedAtTick: 1
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function createValidAction(overrides: Partial<TilePlacementActionLike> = {}): TilePlacementActionLike {
  return {
    playerId: "player-1",
    position: { x: 2, y: 2 },
    tileType: 1,
    tick: 10,
    ...overrides
  };
}

function createContext(overrides: Partial<TilePlacementValidationContext> = {}): TilePlacementValidationContext {
  const board = overrides.board ?? createBoard();
  return {
    board,
    currentTick: 10,
    activePlayerId: "player-1",
    playerInitiative: 8,
    lastActionTick: 7,
    placementRules: DEFAULT_PLACEMENT_RULES,
    ...overrides
  };
}

describe("ActionValidator.validateTilePlacement", () => {
  it("validates a successful tile placement", () => {
    const context = createContext();
    const result = ActionValidator.validateTilePlacement(createValidAction(), context);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects placement by unauthorized player", () => {
    const context = createContext();
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ playerId: "another" }),
      context
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_PLAYER",
      message: "Action attempted by unauthorized player",
      field: "playerId"
    });
  });

  it("rejects placement outside board bounds", () => {
    const board = createBoard(3, 3);
    const context = createContext({ board });
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ position: { x: 5, y: 1 } }),
      context
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "POSITION_OUT_OF_BOUNDS",
      message: "Tile position is outside board boundaries",
      field: "position"
    });
  });

  it("rejects invalid tile types", () => {
    const context = createContext();
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ tileType: 42 }),
      context
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_TILE_TYPE",
      message: "Invalid tile type specified",
      field: "tileType"
    });
  });

  it("rejects placement on occupied cells", () => {
    const board = createBoard();
    setTile(board, { x: 2, y: 2 }, 4);
    const context = createContext({ board });
    const result = ActionValidator.validateTilePlacement(createValidAction(), context);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "POSITION_OCCUPIED",
      message: "Position is already occupied by another tile",
      field: "position"
    });
  });

  it("rejects actions with invalid timing", () => {
    const context = createContext();
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ tick: 5 }),
      context
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_TIMING",
      message: "Action timing is invalid for current game state",
      field: "tick"
    });
  });

  it("rejects actions submitted too frequently", () => {
    const context = createContext();
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ tick: 8 }),
      context
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "ACTION_TOO_FREQUENT",
      message: "Actions cannot be submitted too frequently",
      field: "tick"
    });
  });

  it("allows the first tile to be placed anywhere when permitted", () => {
    const board = createBoard();
    const context = createContext({ board });
    const result = ActionValidator.validateTilePlacement(createValidAction(), context);

    expect(result.isValid).toBe(true);
  });

  it("enforces adjacency rules for subsequent tiles", () => {
    const board = createBoard();
    setTile(board, { x: 1, y: 1 }, 3);
    const context = createContext({ board });
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ position: { x: 4, y: 4 } }),
      context
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_ADJACENCY",
      message: "Tile placement violates adjacency rules",
      field: "position"
    });
  });

  it("supports diagonal adjacency when rules allow it", () => {
    const board = createBoard();
    setTile(board, { x: 1, y: 1 }, 3);
    const placementRules: PlacementRules = { adjacency: "any", allowFirstPlacementAnywhere: true };
    const context = createContext({ board, placementRules });
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ position: { x: 2, y: 2 } }),
      context
    );

    expect(result.isValid).toBe(true);
  });

  it("allows distant placement when adjacency disabled", () => {
    const board = createBoard();
    setTile(board, { x: 1, y: 1 }, 2);
    const placementRules: PlacementRules = { adjacency: "none", allowFirstPlacementAnywhere: true };
    const context = createContext({ board, placementRules });
    const result = ActionValidator.validateTilePlacement(
      createValidAction({ position: { x: 4, y: 4 } }),
      context
    );

    expect(result.isValid).toBe(true);
  });

  it("accumulates multiple validation errors", () => {
    const context = createContext();
    const result = ActionValidator.validateTilePlacement(
      createValidAction({
        playerId: "wrong",
        position: { x: -1, y: 999 },
        tileType: 99,
        tick: 5
      }),
      context
    );

    expect(result.isValid).toBe(false);
    const codes = result.errors.map((error) => error.code);
    expect(codes).toEqual(
      expect.arrayContaining(["INVALID_PLAYER", "POSITION_OUT_OF_BOUNDS", "INVALID_TILE_TYPE", "INVALID_TIMING"])
    );
  });
});

describe("ActionValidator.validateActionFormat", () => {
  it("validates a correctly shaped action", () => {
    const result = ActionValidator.validateActionFormat(asRecord(createValidAction()));

    expect(result.isValid).toBe(true);
  });

  it("reports format issues", () => {
    const result = ActionValidator.validateActionFormat(asRecord({
      playerId: 123,
      position: "oops"
    }));

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(4);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["MISSING_PLAYER_ID", "MISSING_POSITION", "MISSING_TILE_TYPE", "MISSING_TICK"])
    );
  });

  it("validates coordinate numeric types", () => {
    const result = ActionValidator.validateActionFormat(asRecord({
      playerId: "player-1",
      position: { x: "oops", y: null },
      tileType: 1,
      tick: 10
    }));

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "INVALID_POSITION_FORMAT",
      message: "Position x and y must be numbers",
      field: "position"
    });
  });
});

describe("ActionValidator utilities", () => {
  it("converts between position and index", () => {
    const width = 5;

    expect(ActionValidator.positionToIndex({ x: 0, y: 0 }, width)).toBe(0);
    expect(ActionValidator.positionToIndex({ x: 2, y: 1 }, width)).toBe(7);
    expect(ActionValidator.positionToIndex({ x: 4, y: 3 }, width)).toBe(19);

    expect(ActionValidator.indexToPosition(0, width)).toEqual({ x: 0, y: 0 });
    expect(ActionValidator.indexToPosition(7, width)).toEqual({ x: 2, y: 1 });
    expect(ActionValidator.indexToPosition(19, width)).toEqual({ x: 4, y: 3 });
  });

  it("maps a tile placement request to an action-like structure", () => {
    const request: TilePlacementActionRequest = {
      id: "action-1",
      type: "tile_placement",
      instanceId: "instance-1",
      timestamp: 1000,
      playerId: "player-1",
      playerInitiative: 7,
      payload: {
        position: { x: 3, y: 4 },
        tileType: 2,
        clientRequestId: "client-req-1",
        orientation: 1
      },
      metadata: undefined,
      requestedTick: 12,
      lastActionTick: 8
    };

    const mapped = toTilePlacementActionLike(request);

    expect(mapped).toEqual({
      playerId: "player-1",
      position: { x: 3, y: 4 },
      tileType: 2,
      orientation: 1,
      tick: 12,
      requestId: "client-req-1"
    });
  });
});

describe("Exception helpers", () => {
  it("throws TilePlacementValidationError when placement invalid", () => {
    const context = createContext();

    expect(() =>
      validateTilePlacementOrThrow(
        createValidAction({ playerId: "unauthorized" }),
        context,
        "req-123"
      )
    ).toThrowError(TilePlacementValidationError);
  });

  it("throws TilePlacementValidationError when format invalid", () => {
    expect(() => validateActionFormatOrThrow(asRecord({ position: 42 }), "req-456")).toThrowError(
      TilePlacementValidationError
    );
  });

  it("passes through when validation succeeds", () => {
    const context = createContext();

    expect(() => validateTilePlacementOrThrow(createValidAction(), context)).not.toThrow();
    expect(() => validateActionFormatOrThrow(asRecord(createValidAction()))).not.toThrow();
  });
});