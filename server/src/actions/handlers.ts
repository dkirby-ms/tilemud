import type {
  ActionRequest,
  NpcEventActionRequest,
  ScriptedEventActionRequest,
  TilePlacementActionRequest
} from "./actionRequest.js";
import {
  toTilePlacementActionLike,
  validateTilePlacementOrThrow,
  type BoardLike,
  type PlacementRules,
  TilePlacementValidationError
} from "./validation.js";
import type { BattleRoomState } from "../state/battleRoomState.js";
import { NpcState } from "../state/battleRoomState.js";
import type {
  RuleSetDetail,
  RuleSetPlacementRules,
  RuleSetService
} from "@@/services/rulesetService.js";
import { TileMudError } from "../models/errorCodes.js";

type PlacementAdjacency = PlacementRules["adjacency"];

export type ActionRejectionReason = "validation" | "conflict" | "state" | "unknown";

type ExtractApplied<T> = T extends { status: "applied" } ? T : never;

export interface TilePlacementEffect {
  type: "tile_placement";
  playerId: string;
  position: { x: number; y: number };
  tileType: number;
  previousTileType: number | null;
  tick: number;
}

export interface NpcEventEffect {
  type: "npc_event";
  npcId: string;
  eventType: string;
  data?: unknown;
  tick: number;
}

export interface ScriptedEventEffect {
  type: "scripted_event";
  scriptId: string;
  triggerId: string;
  eventType: string;
  data?: unknown;
  tick: number;
}

export type ActionEffect = TilePlacementEffect | NpcEventEffect | ScriptedEventEffect;

export interface ActionAppliedResolution {
  status: "applied";
  action: ActionRequest;
  instanceId: string;
  tick: number;
  effects: ActionEffect[];
  requestId?: string;
  resolvedAt: number;
}

export interface ActionRejectedResolution {
  status: "rejected";
  action: ActionRequest;
  instanceId: string;
  reason: ActionRejectionReason;
  error: Error;
  requestId?: string;
  resolvedAt: number;
  details?: Record<string, unknown>;
}

export type ActionResolution = ActionAppliedResolution | ActionRejectedResolution;

export interface ActionHandlerContext {
  state: BattleRoomState;
}

export interface ActionHandlerDependencies {
  rulesetService: Pick<RuleSetService, "requireRuleSetByVersion">;
  now?: () => number;
}

const DEFAULT_PLACEMENT_RULES: PlacementRules = Object.freeze({
  adjacency: "orthogonal",
  allowFirstPlacementAnywhere: true
});

function normalizePlacementRules(rules?: RuleSetPlacementRules | PlacementRules): PlacementRules {
  if (!rules) {
    return DEFAULT_PLACEMENT_RULES;
  }

  const adjacency: PlacementAdjacency =
    rules.adjacency === "none" || rules.adjacency === "any" || rules.adjacency === "orthogonal"
      ? rules.adjacency
      : "orthogonal";

  return {
    adjacency,
    allowFirstPlacementAnywhere: Boolean(rules.allowFirstPlacementAnywhere)
  } satisfies PlacementRules;
}

function extractRequestId(action: ActionRequest): string | undefined {
  if (action.type === "tile_placement") {
    return action.payload.clientRequestId;
  }
  return action.metadata?.dedupeKey;
}

function serializeMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toBoardLike(board: BattleRoomState["board"]): BoardLike {
  return {
    width: board.width,
    height: board.height,
    cells: Array.from(board.cells, (cell) => ({
      tileType: cell.hasTile ? cell.tileType : null,
      placedByPlayer: cell.lastUpdatedBy ?? undefined,
      placedAtTick: cell.lastUpdatedTick ?? undefined,
      effectiveTileType: () => cell.effectiveTileType
    }))
  } satisfies BoardLike;
}

export class ActionHandlerService {
  private readonly rulesetService: Pick<RuleSetService, "requireRuleSetByVersion">;
  private readonly clock: () => number;
  private readonly placementRulesCache = new Map<string, PlacementRules>();

  constructor(dependencies: ActionHandlerDependencies) {
    this.rulesetService = dependencies.rulesetService;
    this.clock = dependencies.now ?? (() => Date.now());
  }

  async handle(action: ActionRequest, context: ActionHandlerContext): Promise<ActionResolution> {
    const { state } = context;
    const requestId = extractRequestId(action);

    if (action.instanceId !== state.instanceId) {
      const error = new TileMudError("CROSS_INSTANCE_ACTION", {
        expected: state.instanceId,
        received: action.instanceId
      }, requestId);
      return this.reject(action, "state", error, requestId, { instanceId: state.instanceId });
    }

    if (state.status !== "active") {
      const error = new TileMudError("INSTANCE_TERMINATED", { status: state.status }, requestId);
      return this.reject(action, "state", error, requestId);
    }

    switch (action.type) {
      case "tile_placement":
        return this.handleTilePlacement(action, state, requestId);
      case "npc_event":
        return this.handleNpcEvent(action, state);
      case "scripted_event":
        return this.handleScriptedEvent(action, state);
      default: {
        const error = new Error(`Unsupported action type: ${String((action as ActionRequest).type)}`);
        return this.reject(action, "unknown", error, requestId);
      }
    }
  }

  private async handleTilePlacement(
    action: TilePlacementActionRequest,
    state: BattleRoomState,
    requestId?: string
  ): Promise<ActionResolution> {
    const player = state.players.get(action.playerId);
    if (!player) {
      const error = new TileMudError("INVALID_TILE_PLACEMENT", { reason: "player_not_found" }, requestId);
      return this.reject(action, "validation", error, requestId);
    }

    if (player.status !== "active") {
      const error = new TileMudError("INVALID_TILE_PLACEMENT", { reason: "player_inactive" }, requestId);
      return this.reject(action, "state", error, requestId);
    }

    const placementRules = await this.resolvePlacementRules(state.rulesetVersion);
    const actionLike = toTilePlacementActionLike(action);

    try {
      validateTilePlacementOrThrow(actionLike, {
        board: toBoardLike(state.board),
        currentTick: state.tick,
        activePlayerId: player.playerId,
        playerInitiative: player.initiative,
        lastActionTick: player.lastActionTick,
        placementRules
      }, requestId);
    } catch (error) {
      if (error instanceof TilePlacementValidationError) {
        const conflictIssue = error.issues.find((issue) => issue.code === "POSITION_OCCUPIED");
        if (conflictIssue) {
          const cell = state.board.getCell(action.payload.position);
          const conflictError = new TileMudError(
            "PRECEDENCE_CONFLICT",
            {
              position: action.payload.position,
              occupantPlayerId: cell?.lastUpdatedBy ?? null,
              occupantTick: cell?.lastUpdatedTick ?? null
            },
            requestId
          );
          return this.reject(action, "conflict", conflictError, requestId, { issues: error.issues });
        }

        return this.reject(action, "validation", error, requestId, { issues: error.issues });
      }

      return this.reject(action, "unknown", error as Error, requestId);
    }

    const tick = action.requestedTick ?? action.timestamp;
    const coordinate = action.payload.position;
    const existing = state.board.getCell(coordinate);
    const previousTileType = existing?.effectiveTileType ?? null;

    state.board.applyTilePlacement(coordinate, action.payload.tileType, tick, action.playerId);
    player.lastActionTick = tick;
    state.tick = Math.max(state.tick, tick);

    const effect: TilePlacementEffect = {
      type: "tile_placement",
      playerId: action.playerId,
      position: { ...coordinate },
      tileType: action.payload.tileType,
      previousTileType,
      tick
    };

    return this.apply(action, [effect], tick, requestId);
  }

  private handleNpcEvent(action: NpcEventActionRequest, state: BattleRoomState): ActionResolution {
    const tick = action.requestedTick ?? action.timestamp;
    const npc = state.npcs.get(action.npcId) ?? new NpcState();

    if (!state.npcs.has(action.npcId)) {
      npc.npcId = action.npcId;
    }

    npc.priorityTier = action.priorityTier;
    npc.currentTick = tick;
    npc.metadata.set("lastEventType", action.payload.eventType);

    if (action.payload.data && typeof action.payload.data === "object") {
      for (const [key, value] of Object.entries(action.payload.data as Record<string, unknown>)) {
        npc.metadata.set(key, serializeMetadataValue(value));
      }
    }

    state.npcs.set(action.npcId, npc);
    state.tick = Math.max(state.tick, tick);

    const effect: NpcEventEffect = {
      type: "npc_event",
      npcId: action.npcId,
      eventType: action.payload.eventType,
      data: action.payload.data,
      tick
    };

    return this.apply(action, [effect], tick);
  }

  private handleScriptedEvent(action: ScriptedEventActionRequest, state: BattleRoomState): ActionResolution {
    const tick = action.requestedTick ?? action.timestamp;
    state.tick = Math.max(state.tick, tick);

    const effect: ScriptedEventEffect = {
      type: "scripted_event",
      scriptId: action.scriptId,
      triggerId: action.payload.triggerId,
      eventType: action.payload.eventType,
      data: action.payload.data,
      tick
    };

    return this.apply(action, [effect], tick);
  }

  private apply(
    action: ActionRequest,
    effects: ActionEffect[],
    tick: number,
    requestId?: string
  ): ActionAppliedResolution {
    return {
      status: "applied",
      action,
      instanceId: action.instanceId,
      tick,
      effects,
      requestId,
      resolvedAt: this.clock()
    } satisfies ActionAppliedResolution;
  }

  private reject(
    action: ActionRequest,
    reason: ActionRejectionReason,
    error: Error,
    requestId?: string,
    details?: Record<string, unknown>
  ): ActionRejectedResolution {
    return {
      status: "rejected",
      action,
      instanceId: action.instanceId,
      reason,
      error,
      requestId,
      resolvedAt: this.clock(),
      details
    } satisfies ActionRejectedResolution;
  }

  private async resolvePlacementRules(version: string): Promise<PlacementRules> {
    const cached = this.placementRulesCache.get(version);
    if (cached) {
      return cached;
    }

    const detail: RuleSetDetail = await this.rulesetService.requireRuleSetByVersion(version);
    const rules = normalizePlacementRules(detail.metadata?.placement ?? DEFAULT_PLACEMENT_RULES);
    this.placementRulesCache.set(version, rules);
    return rules;
  }
}

export type AppliedActionResolution = ExtractApplied<ActionResolution>;
