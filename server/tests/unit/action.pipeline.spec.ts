import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ActionPipeline } from "../../src/services/actionPipeline.js";
import type { ActionRequest, TilePlacementActionRequest, NpcEventActionRequest, ScriptedEventActionRequest } from "../../src/actions/actionRequest.js";
import type { RateLimitDecision, RateLimiterService } from "../../src/services/rateLimiter.js";
import { RateLimitError } from "../../src/models/errorCodes.js";

function createTileAction(overrides: Partial<TilePlacementActionRequest> = {}): TilePlacementActionRequest {
  return {
    id: overrides.id ?? "tile-1",
    type: "tile_placement",
    instanceId: overrides.instanceId ?? "instance-1",
    timestamp: overrides.timestamp ?? 100,
    playerId: overrides.playerId ?? "player-1",
    playerInitiative: overrides.playerInitiative ?? 10,
    lastActionTick: overrides.lastActionTick ?? 5,
    payload: overrides.payload ?? {
      position: { x: 1, y: 2 },
      tileType: 3
    },
    metadata: overrides.metadata,
    requestedTick: overrides.requestedTick,
    // orientation optional via payload; already satisfied
  } as TilePlacementActionRequest;
}

function createNpcAction(overrides: Partial<NpcEventActionRequest> = {}): NpcEventActionRequest {
  return {
    id: overrides.id ?? "npc-1",
    type: "npc_event",
    instanceId: overrides.instanceId ?? "instance-1",
    timestamp: overrides.timestamp ?? 90,
    npcId: overrides.npcId ?? "npc-a",
    priorityTier: overrides.priorityTier ?? 1,
    payload: overrides.payload ?? {
      eventType: "spawn",
      data: { strength: 5 }
    },
    metadata: overrides.metadata,
    requestedTick: overrides.requestedTick
  } as NpcEventActionRequest;
}

function createScriptedAction(overrides: Partial<ScriptedEventActionRequest> = {}): ScriptedEventActionRequest {
  return {
    id: overrides.id ?? "script-1",
    type: "scripted_event",
    instanceId: overrides.instanceId ?? "instance-1",
    timestamp: overrides.timestamp ?? 95,
    scriptId: overrides.scriptId ?? "script-a",
    priorityTier: overrides.priorityTier ?? 0,
    payload: overrides.payload ?? {
      triggerId: "trigger-1",
      eventType: "environmental"
    },
    metadata: overrides.metadata,
    requestedTick: overrides.requestedTick
  } as ScriptedEventActionRequest;
}

describe("ActionPipeline", () => {
  let rateLimiter: Pick<RateLimiterService, "enforce">;
  let enforceMock: Mock<[string, string], Promise<RateLimitDecision>>;
  let pipeline: ActionPipeline;
  let rateDecision: RateLimitDecision;

  beforeEach(() => {
    rateDecision = {
      channel: "tile_action",
      allowed: true,
      limit: 5,
      remaining: 4,
      windowMs: 1_000
    };

  enforceMock = vi.fn<[string, string], Promise<RateLimitDecision>>().mockResolvedValue(rateDecision);
    rateLimiter = {
      enforce: enforceMock as RateLimiterService["enforce"]
    };

    pipeline = new ActionPipeline({ rateLimiter: rateLimiter as RateLimiterService });
  });

  it("enqueues tile actions and enforces rate limits", async () => {
    const tileAction = createTileAction();

    const result = await pipeline.enqueue(tileAction);

    expect(result.accepted).toBe(true);
    expect(result.rateLimit).toBe(rateDecision);
    expect(enforceMock).toHaveBeenCalledWith("tile_action", tileAction.playerId);
    expect(pipeline.size).toBe(1);
  });

  it("does not call rate limiter for non-tile actions", async () => {
    const npcAction = createNpcAction();

    const result = await pipeline.enqueue(npcAction);

    expect(result.accepted).toBe(true);
    expect(enforceMock).not.toHaveBeenCalled();
    expect(pipeline.size).toBe(1);
  });

  it("rejects duplicate IDs and dedupe keys", async () => {
    const first = createTileAction({ id: "dup", metadata: { dedupeKey: "key-1" } });
    const secondSameId = createTileAction({ id: "dup", metadata: { dedupeKey: "key-2" } });
    const thirdSameKey = createTileAction({ id: "different", metadata: { dedupeKey: "key-1" } });

    await pipeline.enqueue(first);
    const sameIdResult = await pipeline.enqueue(secondSameId);
    const sameKeyResult = await pipeline.enqueue(thirdSameKey);

    expect(sameIdResult.accepted).toBe(false);
    expect(sameIdResult.reason).toBe("duplicate");
    expect(sameKeyResult.accepted).toBe(false);
    expect(sameKeyResult.reason).toBe("duplicate");
    expect(pipeline.size).toBe(1);
  });

  it("rejects actions when the queue is full", async () => {
    pipeline = new ActionPipeline({ rateLimiter: rateLimiter as RateLimiterService, options: { maxQueueSize: 1 } });

    await pipeline.enqueue(createNpcAction({ id: "npc-a" }));
    const result = await pipeline.enqueue(createNpcAction({ id: "npc-b" }));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("queue_full");
    expect(pipeline.size).toBe(1);
  });

  it("orders actions according to priority rules when draining", async () => {
    const tileHigh = createTileAction({ id: "tile-high", playerInitiative: 15, timestamp: 150 });
    const tileLow = createTileAction({ id: "tile-low", playerInitiative: 5, timestamp: 160 });
    const npcPriority2 = createNpcAction({ id: "npc-p2", priorityTier: 2, timestamp: 90 });
    const npcPriority1 = createNpcAction({ id: "npc-p1", priorityTier: 1, timestamp: 120 });
    const scriptedPriority0 = createScriptedAction({ id: "scripted", priorityTier: 0, timestamp: 110 });

    enforceMock.mockResolvedValue(rateDecision);

    await pipeline.enqueue(tileHigh);
    await pipeline.enqueue(tileLow);
    await pipeline.enqueue(npcPriority2);
    await pipeline.enqueue(npcPriority1);
    await pipeline.enqueue(scriptedPriority0);

    const batch = pipeline.drainBatch();

    expect(batch.map((entry) => entry.action.id)).toEqual([
      "scripted",
      "npc-p1",
      "npc-p2",
      "tile-high",
      "tile-low"
    ]);
    expect(pipeline.size).toBe(0);
  });

  it("supports draining partial batches and retains remainder", async () => {
    await pipeline.enqueue(createNpcAction({ id: "npc-1", priorityTier: 0 }));
    await pipeline.enqueue(createTileAction({ id: "tile-1", playerInitiative: 12 }));
    await pipeline.enqueue(createTileAction({ id: "tile-2", playerInitiative: 4 }));

    const firstBatch = pipeline.drainBatch(2);

    expect(firstBatch).toHaveLength(2);
    expect(pipeline.size).toBe(1);

    const remaining = pipeline.drainBatch();
    expect(remaining).toHaveLength(1);
    expect(pipeline.size).toBe(0);
  });

  it("exposes ordered peek without mutating the queue", async () => {
    await pipeline.enqueue(createTileAction({ id: "tile-a", playerInitiative: 8 }));
    await pipeline.enqueue(createTileAction({ id: "tile-b", playerInitiative: 6 }));

    const peeked = pipeline.peek();
    expect(peeked.map((entry) => entry.action.id)).toEqual(["tile-a", "tile-b"]);
    expect(pipeline.size).toBe(2);
  });

  it("removes actions via predicate", async () => {
    await pipeline.enqueue(createTileAction({ id: "tile-a", playerId: "player-a" }));
    await pipeline.enqueue(createTileAction({ id: "tile-b", playerId: "player-b" }));

    const removed = pipeline.removeWhere((action: ActionRequest) => {
      if (action.type === "tile_placement") {
        return action.playerId === "player-a";
      }
      return false;
    });

    expect(removed).toBe(1);
    expect(pipeline.size).toBe(1);
    expect(pipeline.peek()[0].action.id).toBe("tile-b");
  });

  it("propagates rate limit errors", async () => {
    const error = new RateLimitError({ channel: "tile_action" });
    enforceMock.mockRejectedValue(error);

    await expect(pipeline.enqueue(createTileAction())).rejects.toBe(error);
  });
});
