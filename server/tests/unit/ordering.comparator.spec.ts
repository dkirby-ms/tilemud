import { describe, expect, it } from "vitest";
import {
  compareActionRequests,
  comparePriorityDescriptors
} from "../../src/actions/ordering.js";
import {
  getActionPriorityDescriptor,
  type ActionPriorityDescriptor,
  type ActionRequest,
  type NpcEventActionRequest,
  type ScriptedEventActionRequest,
  type TilePlacementActionRequest
} from "../../src/actions/actionRequest.js";

const INSTANCE_ID = "instance-1";

function baseRequest(id: string, timestamp: number) {
  return {
    id,
    instanceId: INSTANCE_ID,
    timestamp,
    requestedTick: timestamp,
    metadata: undefined
  };
}

function createTilePlacement(
  options: {
    id: string;
    timestamp: number;
    initiative: number;
    position?: { x: number; y: number };
  }
): TilePlacementActionRequest {
  const { id, timestamp, initiative, position = { x: 0, y: 0 } } = options;
  return {
    ...baseRequest(id, timestamp),
    type: "tile_placement",
    playerId: `${id}-player`,
    playerInitiative: initiative,
    lastActionTick: 0,
    payload: {
      position,
      tileType: 1
    }
  };
}

function createNpcEvent(
  options: { id: string; timestamp: number; priorityTier: number }
): NpcEventActionRequest {
  const { id, timestamp, priorityTier } = options;
  return {
    ...baseRequest(id, timestamp),
    type: "npc_event",
    npcId: `${id}-npc`,
    priorityTier,
    payload: {
      eventType: "move"
    }
  };
}

function createScriptedEvent(
  options: { id: string; timestamp: number; priorityTier: number }
): ScriptedEventActionRequest {
  const { id, timestamp, priorityTier } = options;
  return {
    ...baseRequest(id, timestamp),
    type: "scripted_event",
    scriptId: `${id}-script`,
    priorityTier,
    payload: {
      triggerId: `${id}-trigger`,
      eventType: "hazard"
    }
  };
}

function descriptor(overrides: Partial<ActionPriorityDescriptor>): ActionPriorityDescriptor {
  return {
    priorityTier: Number.POSITIVE_INFINITY,
    categoryRank: 0,
    initiativeRank: 0,
    timestamp: 0,
    ...overrides
  };
}

describe("comparePriorityDescriptors", () => {
  it("orders by priority tier ascending", () => {
    const ordered = [
      descriptor({ priorityTier: 1 }),
      descriptor({ priorityTier: 2 }),
      descriptor({ priorityTier: 10 })
    ].sort(comparePriorityDescriptors);

    expect(ordered.map((entry) => entry.priorityTier)).toEqual([1, 2, 10]);
  });

  it("orders by category rank when priority matches", () => {
    const ordered = [
      descriptor({ categoryRank: 5 }),
      descriptor({ categoryRank: 2 }),
      descriptor({ categoryRank: 7 })
    ].sort(comparePriorityDescriptors);

    expect(ordered.map((entry) => entry.categoryRank)).toEqual([2, 5, 7]);
  });

  it("orders by initiative rank when priority and category match", () => {
    const ordered = [
      descriptor({ initiativeRank: -10 }),
      descriptor({ initiativeRank: -1 }),
      descriptor({ initiativeRank: -7 })
    ].sort(comparePriorityDescriptors);

    expect(ordered.map((entry) => entry.initiativeRank)).toEqual([-10, -7, -1]);
  });

  it("orders by timestamp when other ranks match", () => {
    const ordered = [
      descriptor({ timestamp: 500 }),
      descriptor({ timestamp: 100 }),
      descriptor({ timestamp: 300 })
    ].sort(comparePriorityDescriptors);

    expect(ordered.map((entry) => entry.timestamp)).toEqual([100, 300, 500]);
  });
});

describe("compareActionRequests", () => {
  it("orders by priority tier ascending", () => {
    const actions: ActionRequest[] = [
      createScriptedEvent({ id: "script-3", priorityTier: 3, timestamp: 100 }),
      createNpcEvent({ id: "npc-1", priorityTier: 1, timestamp: 100 }),
      createScriptedEvent({ id: "script-2", priorityTier: 2, timestamp: 100 }),
      createTilePlacement({ id: "tile", initiative: 5, timestamp: 100 })
    ];

    const sorted = [...actions].sort(compareActionRequests);

    expect(sorted.map((action) => action.id)).toEqual(["npc-1", "script-2", "script-3", "tile"]);
  });

  it("orders NPC and scripted events ahead of tile placements when priority ties", () => {
    const equalPriority = Number.POSITIVE_INFINITY;
    const actions: ActionRequest[] = [
      createTilePlacement({ id: "tile", initiative: 5, timestamp: 100 }),
      createNpcEvent({ id: "npc", priorityTier: equalPriority, timestamp: 100 }),
      createScriptedEvent({ id: "script", priorityTier: equalPriority, timestamp: 100 })
    ];

    const sorted = [...actions].sort(compareActionRequests);

    expect(sorted.map((action) => action.id)).toEqual(["npc", "script", "tile"]);
  });

  it("orders tile placements by initiative descending", () => {
    const actions: ActionRequest[] = [
      createTilePlacement({ id: "low", initiative: 5, timestamp: 100 }),
      createTilePlacement({ id: "high", initiative: 10, timestamp: 100 }),
      createTilePlacement({ id: "mid", initiative: 7, timestamp: 100 })
    ];

    const sorted = [...actions].sort(compareActionRequests);

    expect(sorted.map((action) => action.id)).toEqual(["high", "mid", "low"]);
  });

  it("uses timestamp as a tie breaker", () => {
    const actions: ActionRequest[] = [
      createTilePlacement({ id: "later", initiative: 5, timestamp: 200 }),
      createTilePlacement({ id: "earlier", initiative: 5, timestamp: 100 })
    ];

    const sorted = [...actions].sort(compareActionRequests);

    expect(sorted.map((action) => action.id)).toEqual(["earlier", "later"]);
  });

  it("uses id as final tie breaker", () => {
    const actions: ActionRequest[] = [
      createTilePlacement({ id: "zebra", initiative: 5, timestamp: 100 }),
      createTilePlacement({ id: "alpha", initiative: 5, timestamp: 100 }),
      createTilePlacement({ id: "beta", initiative: 5, timestamp: 100 })
    ];

    const sorted = [...actions].sort(compareActionRequests);

    expect(sorted.map((action) => action.id)).toEqual(["alpha", "beta", "zebra"]);
  });

  it("handles complex mixed scenarios deterministically", () => {
    const actions: ActionRequest[] = [
      createTilePlacement({ id: "tile-high", initiative: 10, timestamp: 150 }),
      createNpcEvent({ id: "npc-p2", priorityTier: 2, timestamp: 100 }),
      createScriptedEvent({ id: "script-p1", priorityTier: 1, timestamp: 200 }),
      createTilePlacement({ id: "tile-low", initiative: 3, timestamp: 120 }),
      createNpcEvent({ id: "npc-p1", priorityTier: 1, timestamp: 180 })
    ];

    const sorted = [...actions].sort(compareActionRequests);

    expect(sorted.map((action) => action.id)).toEqual([
      "npc-p1",
      "script-p1",
      "npc-p2",
      "tile-high",
      "tile-low"
    ]);
  });

  it("aligns with priority descriptors", () => {
    const action = createTilePlacement({ id: "sample", initiative: 9, timestamp: 50 });
    const descriptor = getActionPriorityDescriptor(action);

    expect(descriptor.priorityTier).toBe(Number.POSITIVE_INFINITY);
    expect(descriptor.categoryRank).toBeGreaterThan(0);
    expect(descriptor.initiativeRank).toBe(-9);
  });
});