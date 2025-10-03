import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import type {
  EventAck,
  EventDegraded,
  EventStateDelta,
  EventVersionMismatch,
  SessionBootstrapResponse
} from "@/types";
import { CLIENT_BUILD_VERSION } from "@/app/version";
import {
  applyStateDelta as reduceGameplayState,
  createInitialGameplayState,
  type GameplayState
} from "@/features/state/stateReducer";

const RECONNECT_SCHEDULE_MS = Object.freeze([1000, 2000, 4000, 8000, 16000] as const);
const LATENCY_SAMPLE_LIMIT = 32;

type SessionStatus =
  | "idle"
  | "connecting"
  | "active"
  | "reconnecting"
  | "degraded"
  | "update_required"
  | "unavailable"
  | "terminated";

export type SessionDependency = "redis" | "postgres" | "metrics" | "unknown";

export interface DependencyState {
  status: "degraded" | "recovered";
  observedAt: string;
  message?: string;
}

export interface VersionMismatchState {
  expectedVersion: string;
  receivedVersion: string;
  disconnectAt?: string;
  message?: string;
}

export interface LatencyMetrics {
  lastMs: number | null;
  samples: number[];
  p95Ms: number | null;
  updatedAt: string | null;
}

export interface SessionMetadata {
  sessionId: string | null;
  userId: string | null;
  protocolVersion: string | null;
  clientVersion: string;
  serverVersion: string | null;
  establishedAt: string | null;
}

export interface ReconnectState {
  token: string | null;
  expiresAt: string | null;
  attempts: number;
  maxAttempts: number;
  scheduleMs: readonly number[];
}

export interface SessionStateSnapshot {
  sequence: number | null;
  issuedAt: string | null;
  character?: EventStateDelta["payload"]["character"];
  world?: EventStateDelta["payload"]["world"];
  effects?: EventStateDelta["payload"]["effects"];
  reconnectToken?: EventStateDelta["payload"]["reconnectToken"];
}

export interface SessionStoreState {
  status: SessionStatus;
  metadata: SessionMetadata;
  reconnect: ReconnectState;
  latency: LatencyMetrics;
  lastAckSequence: number;
  nextClientSequence: number;
  lastAckAt: string | null;
  lastState: SessionStateSnapshot | null;
  gameplay: GameplayState;
  versionMismatch: VersionMismatchState | null;
  degradedDependencies: Partial<Record<SessionDependency, DependencyState>>;
  lastError: string | null;
  /** Initiate a connection attempt */
  startConnect: (clientVersion?: string) => void;
  /** Apply REST bootstrap payload */
  applyBootstrap: (payload: SessionBootstrapResponse, clientVersion?: string) => void;
  /** Handle acknowledgement events */
  handleAckEvent: (event: EventAck) => void;
  /** Handle state delta events */
  handleStateDelta: (event: EventStateDelta) => void;
  /** Handle degraded dependency notifications */
  handleDegradedEvent: (event: EventDegraded) => void;
  /** Handle version mismatch notifications */
  handleVersionMismatch: (event: EventVersionMismatch) => void;
  /** Clear version mismatch banner after refresh */
  clearVersionMismatch: () => void;
  /** Increment reconnect attempts and transition status */
  incrementReconnectAttempt: () => number;
  /** Mark reconnect success and reset counters */
  markReconnectSuccess: () => void;
  /** Hard transition to unavailable */
  markUnavailable: (reason?: string) => void;
  /** Mark terminal disconnect */
  markTerminated: (reason?: string) => void;
  /** Advance client-side sequence counter */
  nextSequence: () => number;
  /** Reset store to initial state */
  reset: () => void;
}

const computeP95 = (samples: number[]): number | null => {
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.floor(0.95 * (sorted.length - 1)));
  const candidate = sorted[index];
  return typeof candidate === "number" ? candidate : sorted[sorted.length - 1] ?? null;
};

const clampSamples = (samples: number[]): number[] => {
  if (samples.length <= LATENCY_SAMPLE_LIMIT) {
    return samples;
  }
  return samples.slice(samples.length - LATENCY_SAMPLE_LIMIT);
};

const resolveDegradedStatus = (
  currentStatus: SessionStatus,
  hasDegraded: boolean
): SessionStatus => {
  if (hasDegraded) {
    if (currentStatus === "reconnecting" || currentStatus === "update_required") {
      return currentStatus;
    }
    return "degraded";
  }

  if (currentStatus === "degraded") {
    return "active";
  }

  return currentStatus;
};

type SessionStoreActions = Pick<
  SessionStoreState,
  | "startConnect"
  | "applyBootstrap"
  | "handleAckEvent"
  | "handleStateDelta"
  | "handleDegradedEvent"
  | "handleVersionMismatch"
  | "clearVersionMismatch"
  | "incrementReconnectAttempt"
  | "markReconnectSuccess"
  | "markUnavailable"
  | "markTerminated"
  | "nextSequence"
  | "reset"
>;

type SessionStoreData = Omit<SessionStoreState, keyof SessionStoreActions>;

const createBaseState = (): SessionStoreData => ({
  status: "idle",
  metadata: {
    sessionId: null,
    userId: null,
    protocolVersion: null,
    clientVersion: CLIENT_BUILD_VERSION,
    serverVersion: null,
    establishedAt: null
  },
  reconnect: {
    token: null,
    expiresAt: null,
    attempts: 0,
    maxAttempts: RECONNECT_SCHEDULE_MS.length,
    scheduleMs: RECONNECT_SCHEDULE_MS
  },
  latency: {
    lastMs: null,
    samples: [],
    p95Ms: null,
    updatedAt: null
  },
  lastAckSequence: 0,
  nextClientSequence: 1,
  lastAckAt: null,
  lastState: null,
  gameplay: createInitialGameplayState(),
  versionMismatch: null,
  degradedDependencies: {},
  lastError: null
});

const createSessionStore = () =>
  create<SessionStoreState>()(
    devtools(
      subscribeWithSelector((set, get) => {
        const actions: SessionStoreActions = {
          startConnect: (clientVersion: string = CLIENT_BUILD_VERSION) => {
            set((state) => ({
              status: state.status === "active" ? "active" : "connecting",
              metadata: {
                ...state.metadata,
                clientVersion,
                establishedAt: state.metadata.establishedAt
              },
              reconnect: {
                ...state.reconnect,
                attempts: 0
              },
              versionMismatch: null,
              lastError: null
            }));
          },
          applyBootstrap: (payload, clientVersion) => {
            const hasAuthoritativeState = Boolean(payload.state?.character ?? payload.state?.world);
            const gameplayFromBootstrap = reduceGameplayState(createInitialGameplayState(), {
              sequence: payload.session.lastSequenceNumber,
              issuedAt: payload.issuedAt,
              character: payload.state.character,
              world: payload.state.world,
              effects: undefined,
              reconnectToken: payload.reconnect
            });
            set((state) => ({
              status: state.status === "idle" ? "connecting" : state.status,
              metadata: {
                sessionId: payload.session.sessionId,
                userId: payload.session.userId,
                protocolVersion: payload.session.protocolVersion,
                clientVersion: clientVersion ?? state.metadata.clientVersion ?? CLIENT_BUILD_VERSION,
                serverVersion: payload.version,
                establishedAt: state.metadata.establishedAt ?? new Date().toISOString()
              },
              reconnect: {
                ...state.reconnect,
                token: payload.reconnect.token,
                expiresAt: payload.reconnect.expiresAt,
                attempts: 0
              },
              lastAckSequence: payload.session.lastSequenceNumber,
              nextClientSequence: payload.session.lastSequenceNumber + 1,
              lastState: {
                sequence: hasAuthoritativeState ? payload.session.lastSequenceNumber : null,
                issuedAt: hasAuthoritativeState ? payload.issuedAt : null,
                character: payload.state.character,
                world: payload.state.world,
                reconnectToken: payload.reconnect
              },
              gameplay: gameplayFromBootstrap,
              lastError: null
            }));
          },
          handleAckEvent: (event) => {
            const payload = event.payload;
            if ((payload as { reason?: string | undefined }).reason === "handshake") {
              const handshake = payload as Extract<EventAck["payload"], { reason: "handshake" }>;
              set((state) => ({
                status:
                  state.degradedDependencies && Object.keys(state.degradedDependencies).length > 0
                    ? "degraded"
                    : "active",
                metadata: {
                  ...state.metadata,
                  sessionId: handshake.sessionId,
                  serverVersion: handshake.version,
                  establishedAt: state.metadata.establishedAt ?? handshake.acknowledgedAt ?? new Date().toISOString()
                },
                lastAckSequence: handshake.sequence,
                nextClientSequence: handshake.sequence + 1,
                lastAckAt: handshake.acknowledgedAt ?? new Date().toISOString(),
                latency: {
                  ...state.latency,
                  lastMs: state.latency.lastMs,
                  samples: state.latency.samples,
                  p95Ms: state.latency.p95Ms,
                  updatedAt: handshake.acknowledgedAt ?? new Date().toISOString()
                },
                versionMismatch: null,
                reconnect: {
                  ...state.reconnect,
                  attempts: 0
                },
                lastError: null
              }));
              return;
            }

            const ack = payload as Extract<EventAck["payload"], { status: string }>;
            set((state) => {
              const isProgress = ack.status === "applied" || ack.status === "duplicate";
              const nextLastAck = isProgress ? Math.max(state.lastAckSequence, ack.sequence) : state.lastAckSequence;
              const nextSamples = ack.latencyMs
                ? clampSamples([...state.latency.samples, ack.latencyMs])
                : state.latency.samples;
              return {
                status: state.status === "reconnecting" ? "active" : state.status,
                lastAckSequence: nextLastAck,
                nextClientSequence: Math.max(state.nextClientSequence, nextLastAck + 1),
                latency: {
                  lastMs: ack.latencyMs ?? state.latency.lastMs,
                  samples: nextSamples,
                  p95Ms: computeP95(nextSamples),
                  updatedAt: ack.acknowledgedAt ?? state.latency.updatedAt
                },
                lastAckAt: ack.acknowledgedAt ?? state.lastAckAt,
                lastError: ack.status === "rejected" ? ack.message ?? "Intent rejected" : state.lastError
              };
            });
          },
          handleStateDelta: (event) => {
            const { payload } = event;
            set((state) => {
              const nextLastAck = Math.max(state.lastAckSequence, payload.sequence);
              const nextReconnectToken = payload.reconnectToken ?? state.lastState?.reconnectToken;
              const degradedActive = state.degradedDependencies && Object.keys(state.degradedDependencies).length > 0;
              const nextGameplay = reduceGameplayState(state.gameplay, payload);
              return {
                status:
                  state.status === "connecting" || state.status === "reconnecting"
                    ? degradedActive
                      ? "degraded"
                      : "active"
                    : state.status,
                lastAckSequence: nextLastAck,
                nextClientSequence: Math.max(state.nextClientSequence, nextLastAck + 1),
                reconnect: {
                  ...state.reconnect,
                  token: nextReconnectToken ? nextReconnectToken.token : state.reconnect.token,
                  expiresAt: nextReconnectToken ? nextReconnectToken.expiresAt : state.reconnect.expiresAt
                },
                lastState: {
                  sequence: payload.sequence,
                  issuedAt: payload.issuedAt,
                  character: payload.character ?? state.lastState?.character,
                  world: payload.world ?? state.lastState?.world,
                  effects: payload.effects ?? state.lastState?.effects,
                  reconnectToken: nextReconnectToken ?? state.lastState?.reconnectToken
                },
                gameplay: nextGameplay
              };
            });
          },
          handleDegradedEvent: (event) => {
            set((state) => {
              let nextMap = { ...state.degradedDependencies };
              if (event.payload.status === "degraded") {
                const dependencyState: DependencyState = {
                  status: event.payload.status,
                  observedAt: event.payload.observedAt
                };
                if (event.payload.message) {
                  dependencyState.message = event.payload.message;
                }
                nextMap = {
                  ...nextMap,
                  [event.payload.dependency]: dependencyState
                };
              } else {
                const { [event.payload.dependency]: removedValue, ...rest } = nextMap;
                void removedValue;
                nextMap = rest;
              }
              const hasDegraded = Object.keys(nextMap).length > 0;
              return {
                degradedDependencies: nextMap,
                status: resolveDegradedStatus(state.status, hasDegraded)
              };
            });
          },
          handleVersionMismatch: (event) => {
            const mismatch: VersionMismatchState = {
              expectedVersion: event.payload.expectedVersion,
              receivedVersion: event.payload.receivedVersion
            };
            if (event.payload.disconnectAt) {
              mismatch.disconnectAt = event.payload.disconnectAt;
            }
            if (event.payload.message) {
              mismatch.message = event.payload.message;
            }
            set({
              status: "update_required",
              versionMismatch: mismatch
            });
          },
          clearVersionMismatch: () => {
            set((state) => ({
              versionMismatch: null,
              status: state.status === "update_required" ? "connecting" : state.status
            }));
          },
          incrementReconnectAttempt: () => {
            set((state) => ({
              reconnect: {
                ...state.reconnect,
                attempts: Math.min(state.reconnect.attempts + 1, state.reconnect.maxAttempts)
              },
              status: "reconnecting"
            }));
            const { reconnect } = get();
            const schedule = reconnect.scheduleMs.length > 0 ? reconnect.scheduleMs : RECONNECT_SCHEDULE_MS;
            const safeIndex = Math.min(reconnect.attempts - 1, Math.max(schedule.length - 1, 0));
            const fallback =
              schedule[schedule.length - 1] ??
              RECONNECT_SCHEDULE_MS[RECONNECT_SCHEDULE_MS.length - 1] ??
              RECONNECT_SCHEDULE_MS[0];
            const value = schedule[safeIndex] ?? fallback;
            return value;
          },
          markReconnectSuccess: () => {
            set((state) => ({
              status: Object.keys(state.degradedDependencies).length > 0 ? "degraded" : "active",
              reconnect: {
                ...state.reconnect,
                attempts: 0
              }
            }));
          },
          markUnavailable: (reason) => {
            set(() => ({
              status: "unavailable",
              lastError: reason ?? "Service unavailable"
            }));
          },
          markTerminated: (reason) => {
            set(() => ({
              status: "terminated",
              lastError: reason ?? null
            }));
          },
          nextSequence: () => {
            const current = get().nextClientSequence;
            set(() => ({ nextClientSequence: current + 1 }));
            return current;
          },
          reset: () => {
            set(() => ({
              ...createBaseState(),
              ...actions
            }));
          }
        };

        return {
          ...createBaseState(),
          ...actions
        };
      })
    )
  );

export const useSessionStore = createSessionStore();

export const getSessionState = () => useSessionStore.getState();
