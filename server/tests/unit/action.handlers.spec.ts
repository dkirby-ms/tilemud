import { beforeEach, describe, expect, it } from "vitest";
import type {
  ActionRequest as _ActionRequest, // retained for potential future test additions
  NpcEventActionRequest,
  ScriptedEventActionRequest,
  TilePlacementActionRequest
} from "../../src/actions/actionRequest.js";
import { ActionHandlerService, type ActionResolution } from "../../src/actions/handlers.js";
import { TilePlacementValidationError } from "../../src/actions/validation.js";
import { TileMudError } from "../../src/models/errorCodes.js";
import { BattleRoomState, PlayerSessionState, createBattleRoomState } from "../../src/state/battleRoomState.js";
import type {
  RuleSetDetail,
  RuleSetMetadata,
  RuleSetService
} from "../../src/services/rulesetService.js";

class FakeRuleSetService implements Pick<RuleSetService, "requireRuleSetByVersion"> {
  constructor(private readonly metadata: RuleSetMetadata) {}

  async requireRuleSetByVersion(version: string): Promise<RuleSetDetail> {
    return {
      id: `ruleset-${version}`,
      version,
      createdAt: new Date(0),
      metadata: {
        description: this.metadata.description,
        tags: [...this.metadata.tags],
        maxPlayers: this.metadata.maxPlayers,
        board: {
          width: this.metadata.board.width,
          height: this.metadata.board.height,
          initialTiles: this.metadata.board.initialTiles.map((tile) => ({ ...tile }))
        },
        placement: {
          adjacency: this.metadata.placement.adjacency,
          allowFirstPlacementAnywhere: this.metadata.placement.allowFirstPlacementAnywhere
        },
        extras: { ...this.metadata.extras }
      }
    };
  }
}

function createRuleSetMetadata(): RuleSetMetadata {
  return {
    description: "Test ruleset",
    tags: [],
    maxPlayers: 32,
    board: {
      width: 8,
      height: 8,
      initialTiles: []
    },
    placement: {
      adjacency: "orthogonal",
      allowFirstPlacementAnywhere: true
    },
    extras: {}
  };
}

function addPlayer(state: BattleRoomState, overrides: Partial<PlayerSessionState> = {}): PlayerSessionState {
  const player = new PlayerSessionState();
  player.playerId = overrides.playerId ?? `player-${state.players.size + 1}`;
  player.displayName = overrides.displayName ?? player.playerId;
  player.status = overrides.status ?? "active";
  player.initiative = overrides.initiative ?? 10;
  player.lastActionTick = overrides.lastActionTick ?? 0;
  player.reconnectDeadline = overrides.reconnectDeadline ?? null;
  state.players.set(player.playerId, player);
  return player;
}

function createTilePlacementAction(overrides: Partial<TilePlacementActionRequest> = {}): TilePlacementActionRequest {
  return {
    id: overrides.id ?? "action-1",
    type: "tile_placement",
    instanceId: overrides.instanceId ?? "instance-1",
    timestamp: overrides.timestamp ?? 1_000,
    requestedTick: overrides.requestedTick ?? 12,
    playerId: overrides.playerId ?? "player-1",
    playerInitiative: overrides.playerInitiative ?? 10,
    lastActionTick: overrides.lastActionTick ?? 0,
    payload: overrides.payload ?? {
      position: { x: 2, y: 3 },
      tileType: 3,
      clientRequestId: "client-req"
    },
    metadata: overrides.metadata
  } as TilePlacementActionRequest;
}

function createNpcEventAction(overrides: Partial<NpcEventActionRequest> = {}): NpcEventActionRequest {
  return {
    id: overrides.id ?? "npc-action",
    type: "npc_event",
    instanceId: overrides.instanceId ?? "instance-1",
    timestamp: overrides.timestamp ?? 2_000,
    requestedTick: overrides.requestedTick ?? 15,
    npcId: overrides.npcId ?? "npc-1",
    priorityTier: overrides.priorityTier ?? 1,
    payload: overrides.payload ?? {
      eventType: "move",
      data: { direction: "north" }
    },
    metadata: overrides.metadata
  } as NpcEventActionRequest;
}

function createScriptedEventAction(
  overrides: Partial<ScriptedEventActionRequest> = {}
): ScriptedEventActionRequest {
  return {
    id: overrides.id ?? "scripted-action",
    type: "scripted_event",
    instanceId: overrides.instanceId ?? "instance-1",
    timestamp: overrides.timestamp ?? 3_000,
    requestedTick: overrides.requestedTick ?? 18,
    scriptId: overrides.scriptId ?? "script-1",
    priorityTier: overrides.priorityTier ?? 0,
    payload: overrides.payload ?? {
      triggerId: "trigger-1",
      eventType: "environmental",
      data: { severity: "medium" }
    },
    metadata: overrides.metadata
  } as ScriptedEventActionRequest;
}

describe("ActionHandlerService", () => {
  let state: BattleRoomState;
  let handler: ActionHandlerService;
  let rulesetService: FakeRuleSetService;

  beforeEach(() => {
    state = createBattleRoomState({
      instanceId: "instance-1",
      rulesetVersion: "1.0.0",
      board: { width: 6, height: 6 },
      initialTick: 10
    });

    rulesetService = new FakeRuleSetService(createRuleSetMetadata());
    handler = new ActionHandlerService({ rulesetService });
  });

  function expectApplied(resolution: ActionResolution): asserts resolution is Extract<ActionResolution, { status: "applied" }> {
    expect(resolution.status).toBe("applied");
  }

  function expectRejected(resolution: ActionResolution): asserts resolution is Extract<ActionResolution, { status: "rejected" }> {
    expect(resolution.status).toBe("rejected");
  }

  it("rejects actions targeting a different instance", async () => {
    addPlayer(state, { playerId: "player-1" });
    const action = createTilePlacementAction({ instanceId: "other-instance" });

    const result = await handler.handle(action, { state });

    expectRejected(result);
    expect(result.reason).toBe("state");
    expect(result.error).toBeInstanceOf(TileMudError);
    expect((result.error as TileMudError).code).toBe("CROSS_INSTANCE_ACTION");
  });

  it("rejects actions when room is not active", async () => {
    addPlayer(state, { playerId: "player-1" });
    state.status = "ended";
    const action = createTilePlacementAction();

    const result = await handler.handle(action, { state });

    expectRejected(result);
    expect(result.reason).toBe("state");
    expect(result.error).toBeInstanceOf(TileMudError);
    expect((result.error as TileMudError).code).toBe("INSTANCE_TERMINATED");
  });

  it("applies a tile placement and updates state", async () => {
    const player = addPlayer(state, { playerId: "player-1", lastActionTick: 4, initiative: 12 });
    const action = createTilePlacementAction({ playerId: player.playerId, lastActionTick: player.lastActionTick });

    const result = await handler.handle(action, { state });

    expectApplied(result);
    expect(result.effects).toHaveLength(1);
  const effect = result.effects[0];
  expect(effect.type).toBe("tile_placement");
  const tileEffect = effect.type === "tile_placement" ? effect : undefined;
  expect(tileEffect?.position).toEqual({ x: 2, y: 3 });
  expect(tileEffect?.tileType).toBe(3);
  expect(tileEffect?.previousTileType).toBeNull();
  expect(tileEffect?.playerId).toBe(player.playerId);

    const cell = state.board.getCell({ x: 2, y: 3 });
    expect(cell?.tileType).toBe(3);
    expect(cell?.lastUpdatedBy).toBe(player.playerId);
    expect(cell?.lastUpdatedTick).toBe(action.requestedTick ?? action.timestamp);

    expect(player.lastActionTick).toBe(action.requestedTick ?? action.timestamp);
    expect(state.tick).toBe(action.requestedTick ?? action.timestamp);
    expect(result.requestId).toBe("client-req");
  });

  it("rejects tile placements for missing players", async () => {
    const action = createTilePlacementAction({ playerId: "ghost" });

    const result = await handler.handle(action, { state });

    expectRejected(result);
    expect(result.reason).toBe("validation");
    expect(result.error).toBeInstanceOf(TileMudError);
    expect((result.error as TileMudError).code).toBe("INVALID_TILE_PLACEMENT");
  });

  it("rejects invalid tile placements with validation error", async () => {
    const player = addPlayer(state, { playerId: "player-1", lastActionTick: 4 });
    const action = createTilePlacementAction({
      playerId: player.playerId,
      lastActionTick: player.lastActionTick,
      payload: {
        position: { x: 10, y: 10 },
        tileType: 42,
        clientRequestId: "client-req"
      }
    });

    const result = await handler.handle(action, { state });

    expectRejected(result);
    expect(result.reason).toBe("validation");
    expect(result.error).toBeInstanceOf(TilePlacementValidationError);
    expect(result.requestId).toBe("client-req");
  });

  it("returns conflict error when tile already occupied", async () => {
    const firstPlayer = addPlayer(state, { playerId: "player-1", lastActionTick: 4, initiative: 12 });
    const secondPlayer = addPlayer(state, { playerId: "player-2", lastActionTick: 4, initiative: 8 });

    const firstAction = createTilePlacementAction({
      id: "first",
      playerId: firstPlayer.playerId,
      lastActionTick: firstPlayer.lastActionTick,
      payload: {
        position: { x: 1, y: 1 },
        tileType: 2,
        clientRequestId: "first-req"
      }
    });

    const secondAction = createTilePlacementAction({
      id: "second",
      playerId: secondPlayer.playerId,
      lastActionTick: secondPlayer.lastActionTick,
      payload: {
        position: { x: 1, y: 1 },
        tileType: 4,
        clientRequestId: "second-req"
      }
    });

    const firstResult = await handler.handle(firstAction, { state });
    expectApplied(firstResult);

  const secondResult = await handler.handle(secondAction, { state });

    expectRejected(secondResult);
    expect(secondResult.reason).toBe("conflict");
    expect(secondResult.error).toBeInstanceOf(TileMudError);
    expect((secondResult.error as TileMudError).code).toBe("PRECEDENCE_CONFLICT");
    expect(secondResult.requestId).toBe("second-req");

    const cell = state.board.getCell({ x: 1, y: 1 });
    expect(cell?.tileType).toBe(2);
    expect(cell?.lastUpdatedBy).toBe(firstPlayer.playerId);
  });

  it("stores NPC event updates in state metadata", async () => {
    addPlayer(state, { playerId: "observer" });
    const action = createNpcEventAction();

    const result = await handler.handle(action, { state });

    expectApplied(result);
    expect(result.effects).toHaveLength(1);
  const effect = result.effects[0];
  expect(effect.type).toBe("npc_event");
  const npcEffect = effect.type === "npc_event" ? effect : undefined;
  expect(npcEffect?.npcId).toBe(action.npcId);
  expect(npcEffect?.eventType).toBe(action.payload.eventType);
  expect(npcEffect?.data).toEqual(action.payload.data);

  const npc = state.npcs.get(action.npcId);
  expect(npc).toBeDefined();
  expect(npc?.currentTick).toBe(action.requestedTick ?? action.timestamp);
  expect(npc?.metadata.get("lastEventType")).toBe(action.payload.eventType);
    expect(state.tick).toBeGreaterThanOrEqual(action.requestedTick ?? action.timestamp);
  });

  it("applies scripted events and advances tick", async () => {
    addPlayer(state, { playerId: "observer" });
    const action = createScriptedEventAction();

    const result = await handler.handle(action, { state });

    expectApplied(result);
    expect(result.effects).toHaveLength(1);
  const effect = result.effects[0];
  expect(effect.type).toBe("scripted_event");
  const scriptedEffect = effect.type === "scripted_event" ? effect : undefined;
  expect(scriptedEffect?.scriptId).toBe(action.scriptId);
  expect(scriptedEffect?.eventType).toBe(action.payload.eventType);
  expect(scriptedEffect?.data).toEqual(action.payload.data);
    expect(state.tick).toBe(action.requestedTick ?? action.timestamp);
  });
});
