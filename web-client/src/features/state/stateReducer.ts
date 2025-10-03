import type { EventStateDelta } from "@/types";

export interface GameplayState {
  sequence: number;
  issuedAt: string | null;
  character: EventStateDelta["payload"]["character"] | null;
  world: EventStateDelta["payload"]["world"] | null;
  effects: NonNullable<EventStateDelta["payload"]["effects"]>;
  reconnectToken: EventStateDelta["payload"]["reconnectToken"] | null;
  lastUpdatedAt: string | null;
}

const EFFECT_HISTORY_LIMIT = 20;

const deepClone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

export const createInitialGameplayState = (): GameplayState => ({
  sequence: 0,
  issuedAt: null,
  character: null,
  world: null,
  effects: [],
  reconnectToken: null,
  lastUpdatedAt: null
});

export const applyStateDelta = (
  state: GameplayState,
  delta: EventStateDelta["payload"]
): GameplayState => {
  const nextEffects = delta.effects
    ? [...state.effects, ...delta.effects].slice(-EFFECT_HISTORY_LIMIT)
    : state.effects;

  return {
    sequence: delta.sequence,
    issuedAt: delta.issuedAt,
    character: delta.character ? deepClone(delta.character) : state.character,
    world: delta.world ? deepClone(delta.world) : state.world,
    effects: nextEffects,
    reconnectToken: delta.reconnectToken ? deepClone(delta.reconnectToken) : state.reconnectToken,
    lastUpdatedAt: new Date().toISOString()
  } satisfies GameplayState;
};
