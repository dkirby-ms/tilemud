import { describe, expect, it } from "vitest";
import { eventStateDeltaSchema } from "@/types";
import { applyStateDelta, createInitialGameplayState } from "@/features/state/stateReducer";

const iso = () => new Date().toISOString();

describe("State delta reducer", () => {
  it("applies new snapshots and preserves prior data when fields omitted", () => {
    const initial = createInitialGameplayState();
    const firstDelta = eventStateDeltaSchema.parse({
      type: "event.state_delta",
      payload: {
        sequence: 10,
        issuedAt: iso(),
        character: {
          characterId: "char-1",
          displayName: "Scout",
          position: { x: 2, y: 4 },
          stats: { hp: 20 },
          inventory: { arrows: 5 }
        },
        world: {
          tiles: []
        },
        effects: [
          { type: "spawn", actionId: "a-1" }
        ],
        reconnectToken: {
          token: "rt-1",
          expiresAt: iso()
        }
      }
    });

    const afterFirst = applyStateDelta(initial, firstDelta.payload);
    expect(afterFirst.sequence).toBe(10);
    expect(afterFirst.character?.displayName).toBe("Scout");
    expect(afterFirst.effects).toHaveLength(1);

    const secondDelta = eventStateDeltaSchema.parse({
      type: "event.state_delta",
      payload: {
        sequence: 11,
        issuedAt: iso(),
        effects: [
          { type: "move", actionId: "a-2" },
          { type: "effect", actionId: "a-3" }
        ]
      }
    });

    const afterSecond = applyStateDelta(afterFirst, secondDelta.payload);
    expect(afterSecond.sequence).toBe(11);
    expect(afterSecond.character?.displayName).toBe("Scout");
    expect(afterSecond.effects).toHaveLength(3);
    expect(afterSecond.effects.at(-1)?.actionId).toBe("a-3");
    expect(afterSecond.reconnectToken?.token).toBe("rt-1");
  });

  it("limits effect history to latest entries", () => {
    let state = createInitialGameplayState();

    for (let index = 0; index < 25; index += 1) {
      const delta = eventStateDeltaSchema.parse({
        type: "event.state_delta",
        payload: {
          sequence: index + 1,
          issuedAt: iso(),
          effects: [{ type: "tick", actionId: `effect-${index}` }]
        }
      });
      state = applyStateDelta(state, delta.payload);
    }

    expect(state.sequence).toBe(25);
    expect(state.effects).toHaveLength(20);
    expect(state.effects[0]?.actionId).toBe("effect-5");
  });
});
