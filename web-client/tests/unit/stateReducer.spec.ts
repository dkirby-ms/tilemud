import { describe, expect, it, vi, afterEach } from "vitest";
import { applyStateDelta, createInitialGameplayState } from "@/features/state/stateReducer";
import { eventStateDeltaSchema } from "@/types";
import type { EventStateDelta } from "@/types";

const buildDelta = (payload: Record<string, unknown>): EventStateDelta["payload"] =>
  eventStateDeltaSchema.parse({ type: "event.state_delta", payload }).payload;

describe("stateReducer unit tests", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clones incoming payload structures to avoid shared references", () => {
    const initial = createInitialGameplayState();
    const payload: EventStateDelta["payload"] = buildDelta({
      sequence: 1,
      issuedAt: "2025-01-01T00:00:00.000Z",
      character: {
        characterId: "char-1",
        displayName: "Scout",
        position: { x: 2, y: 4 },
        stats: { hp: 20 },
        inventory: { arrows: 5 }
      },
      world: {
        tiles: [
          { x: 0, y: 0, type: "grass" }
        ]
      },
      reconnectToken: {
        token: "token-1",
        expiresAt: "2025-01-01T00:05:00.000Z"
      }
    });

    const next = applyStateDelta(initial, payload);

    expect(next.character).not.toBe(payload.character);
    expect(next.character?.stats).not.toBe(payload.character?.stats);
    expect(next.world).not.toBe(payload.world);
    expect(next.reconnectToken).not.toBe(payload.reconnectToken);

    if (!next.character || !payload.character) {
      throw new Error("character should be present");
    }

    if (!next.world || !payload.world) {
      throw new Error("world should be present");
    }

    if (!next.reconnectToken || !payload.reconnectToken) {
      throw new Error("reconnect token should be present");
    }

    next.character.displayName = "Sniper";
    (next.character.stats as Record<string, number>).hp = 12;
    next.world.tiles.push({ x: 1, y: 1, type: "stone" });
    next.reconnectToken.token = "token-2";

    expect(payload.character.displayName).toBe("Scout");
    expect((payload.character.stats as Record<string, number>).hp).toBe(20);
    expect(payload.world.tiles).toHaveLength(1);
    expect(payload.reconnectToken.token).toBe("token-1");
  });

  it("preserves prior references when delta omits optional sections", () => {
    const initial = createInitialGameplayState();
    const firstDelta = buildDelta({
      sequence: 10,
      issuedAt: "2025-01-01T00:00:00.000Z",
      character: {
        characterId: "char-2",
        displayName: "Ranger",
        position: { x: 10, y: 20 },
        stats: { hp: 30 },
        inventory: {}
      }
    });

    const afterFirst = applyStateDelta(initial, firstDelta);
    const characterRef = afterFirst.character;

    const secondDelta = buildDelta({
      sequence: 11,
      issuedAt: "2025-01-01T00:00:01.000Z"
    });

    const afterSecond = applyStateDelta(afterFirst, secondDelta);

    expect(afterSecond.character).toBe(characterRef);
    expect(afterSecond.character?.displayName).toBe("Ranger");
  });

  it("stamps lastUpdatedAt based on current clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    const initial = createInitialGameplayState();
    const first = applyStateDelta(initial, buildDelta({
      sequence: 1,
      issuedAt: "2025-01-01T00:00:00.000Z"
    }));

    expect(first.lastUpdatedAt).toBe("2025-01-01T00:00:00.000Z");

    vi.setSystemTime(new Date("2025-01-01T00:00:05.000Z"));
    const second = applyStateDelta(first, buildDelta({
      sequence: 2,
      issuedAt: "2025-01-01T00:00:05.000Z"
    }));

    expect(second.lastUpdatedAt).toBe("2025-01-01T00:00:05.000Z");
    expect(Date.parse(second.lastUpdatedAt ?? "")).not.toBeNaN();
  });
});
