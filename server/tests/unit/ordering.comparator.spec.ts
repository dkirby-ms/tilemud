import { describe, expect, it } from "vitest";

interface PendingAction {
  id: string;
  type: "tile_placement" | "npc_event" | "scripted_event";
  priorityTier?: number; // npc/scripted only
  playerInitiative?: number; // tile placement only
  timestamp: number; // enqueue time
  payload: unknown;
}

// Ordering comparator (per tick batch):
// 1. priorityTier ascending (undefined -> +infinity)
// 2. type precedence: npc/scripted before tile_placement
// 3. playerInitiative descending
// 4. timestamp ascending
// 5. id lexicographic as final tie-breaker
function compareActions(a: PendingAction, b: PendingAction): number {
  // 1. Priority tier (undefined treated as +infinity)
  const aPriority = a.priorityTier ?? Number.POSITIVE_INFINITY;
  const bPriority = b.priorityTier ?? Number.POSITIVE_INFINITY;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }

  // 2. Type precedence: npc/scripted before tile_placement
  const typeOrder = { npc_event: 0, scripted_event: 0, tile_placement: 1 };
  const aTypeOrder = typeOrder[a.type];
  const bTypeOrder = typeOrder[b.type];
  if (aTypeOrder !== bTypeOrder) {
    return aTypeOrder - bTypeOrder;
  }

  // 3. Player initiative descending (for tile_placement only)
  if (a.type === "tile_placement" && b.type === "tile_placement") {
    const aInitiative = a.playerInitiative ?? 0;
    const bInitiative = b.playerInitiative ?? 0;
    if (aInitiative !== bInitiative) {
      return bInitiative - aInitiative; // descending
    }
  }

  // 4. Timestamp ascending
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }

  // 5. ID lexicographic
  return a.id.localeCompare(b.id);
}

describe("Action Ordering Comparator", () => {
  it("orders by priority tier ascending (undefined treated as infinity)", () => {
    const actions: PendingAction[] = [
      { id: "c", type: "scripted_event", priorityTier: 3, timestamp: 100, payload: {} },
      { id: "a", type: "npc_event", priorityTier: 1, timestamp: 100, payload: {} },
      { id: "d", type: "tile_placement", timestamp: 100, payload: {} }, // no priorityTier
      { id: "b", type: "scripted_event", priorityTier: 2, timestamp: 100, payload: {} }
    ];

    const sorted = actions.sort(compareActions);

    expect(sorted.map(a => a.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("orders npc/scripted events before tile placements at same priority tier", () => {
    const actions: PendingAction[] = [
      { id: "tile", type: "tile_placement", timestamp: 100, payload: {} },
      { id: "npc", type: "npc_event", priorityTier: undefined, timestamp: 100, payload: {} },
      { id: "script", type: "scripted_event", priorityTier: undefined, timestamp: 100, payload: {} }
    ];

    const sorted = actions.sort(compareActions);

    // npc and scripted should come before tile (they all have same priority tier = infinity)
    expect(sorted[0].id).toEqual("npc");
    expect(sorted[1].id).toEqual("script");
    expect(sorted[2].id).toEqual("tile");
  });

  it("orders tile placements by player initiative descending", () => {
    const actions: PendingAction[] = [
      { id: "low", type: "tile_placement", playerInitiative: 5, timestamp: 100, payload: {} },
      { id: "high", type: "tile_placement", playerInitiative: 10, timestamp: 100, payload: {} },
      { id: "mid", type: "tile_placement", playerInitiative: 7, timestamp: 100, payload: {} }
    ];

    const sorted = actions.sort(compareActions);

    expect(sorted.map(a => a.id)).toEqual(["high", "mid", "low"]);
  });

  it("uses timestamp as tiebreaker for same initiative", () => {
    const actions: PendingAction[] = [
      { id: "later", type: "tile_placement", playerInitiative: 5, timestamp: 200, payload: {} },
      { id: "earlier", type: "tile_placement", playerInitiative: 5, timestamp: 100, payload: {} }
    ];

    const sorted = actions.sort(compareActions);

    expect(sorted.map(a => a.id)).toEqual(["earlier", "later"]);
  });

  it("uses id lexicographic as final tiebreaker", () => {
    const actions: PendingAction[] = [
      { id: "zebra", type: "tile_placement", playerInitiative: 5, timestamp: 100, payload: {} },
      { id: "alpha", type: "tile_placement", playerInitiative: 5, timestamp: 100, payload: {} },
      { id: "beta", type: "tile_placement", playerInitiative: 5, timestamp: 100, payload: {} }
    ];

    const sorted = actions.sort(compareActions);

    expect(sorted.map(a => a.id)).toEqual(["alpha", "beta", "zebra"]);
  });

  it("handles complex mixed scenario deterministically", () => {
    const actions: PendingAction[] = [
      { id: "tile-high", type: "tile_placement", playerInitiative: 10, timestamp: 150, payload: {} },
      { id: "npc-p2", type: "npc_event", priorityTier: 2, timestamp: 100, payload: {} },
      { id: "script-p1", type: "scripted_event", priorityTier: 1, timestamp: 200, payload: {} },
      { id: "tile-low", type: "tile_placement", playerInitiative: 3, timestamp: 120, payload: {} },
      { id: "npc-p1", type: "npc_event", priorityTier: 1, timestamp: 180, payload: {} }
    ];

    const sorted = actions.sort(compareActions);

    // Expected order:
    // 1. script-p1 (priority 1, earliest by tier)
    // 2. npc-p1 (priority 1, but timestamp later than script-p1)
    // 3. npc-p2 (priority 2)
    // 4. tile-high (no priority tier = infinity, but higher initiative)
    // 5. tile-low (no priority tier = infinity, lower initiative)
    expect(sorted.map(a => a.id)).toEqual([
      "script-p1", "npc-p1", "npc-p2", "tile-high", "tile-low"
    ]);
  });
});