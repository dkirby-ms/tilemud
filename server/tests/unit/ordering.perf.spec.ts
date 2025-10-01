import { describe, it, expect } from "vitest";
import { compareActionRequests } from "../../src/actions/ordering.js";
import type { ActionRequest, TilePlacementActionRequest } from "../../src/actions/actionRequest.js";

function createTile(i: number): TilePlacementActionRequest {
  return {
    id: `tile-${i}`,
    instanceId: "perf-instance",
    type: "tile_placement",
    playerId: `player-${i % 50}`,
    playerInitiative: (i * 37) % 100,
    lastActionTick: 0,
    timestamp: i,
    requestedTick: i,
    metadata: undefined,
    payload: {
      position: { x: (i * 13) % 16, y: (i * 17) % 16 },
      tileType: (i * 7) % 3
    }
  };
}

describe("Ordering comparator performance", () => {
  it("sorts 10k mixed actions under threshold", () => {
    const count = 10_000;
    const actions: ActionRequest[] = Array.from({ length: count }, (_, i) => createTile(i));
    const start = performance.now();
    const sorted = [...actions].sort(compareActionRequests);
    const duration = performance.now() - start;
    // Basic sanity: sorted array length unchanged
    expect(sorted.length).toBe(count);
    // Performance threshold (adjust if flaky in CI): 250ms for 10k simple comparisons
    expect(duration).toBeLessThan(250);
  });
});
