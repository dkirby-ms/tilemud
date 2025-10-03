import { beforeEach, describe, expect, it } from "vitest";
import {
  eventAckSchema,
  eventDegradedSchema,
  eventStateDeltaSchema,
  eventVersionMismatchSchema,
  sessionBootstrapResponseSchema
} from "@/types";
import { useSessionStore } from "@/features/session/sessionStore";

const iso = () => new Date().toISOString();

describe("Session store state transitions", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it("enters connecting state and records client version when starting a connection", () => {
    useSessionStore.getState().startConnect("1.2.3-test");

    const state = useSessionStore.getState();
    expect(state.status).toBe("connecting");
    expect(state.metadata.clientVersion).toBe("1.2.3-test");
    expect(state.reconnect.attempts).toBe(0);
  });

  it("applies bootstrap payload and hydrates gameplay snapshot", () => {
    const bootstrap = sessionBootstrapResponseSchema.parse({
      version: "2.0.0",
      issuedAt: iso(),
      session: {
        sessionId: "session-123",
        userId: "user-456",
        status: "active",
        protocolVersion: "2.0.0",
        lastSequenceNumber: 9
      },
      state: {
        character: {
          characterId: "char-1",
          displayName: "Hero",
          position: { x: 10, y: 12 },
          stats: { hp: 30 },
          inventory: { gold: 100 }
        },
        world: {
          tiles: []
        }
      },
      reconnect: {
        token: "reconnect-token",
        expiresAt: iso()
      },
      realtime: {
        room: "GameRoom",
        roomId: "room-1"
      }
    });

    useSessionStore.getState().applyBootstrap(bootstrap, "2.0.0-client");

    const state = useSessionStore.getState();
    expect(state.metadata.sessionId).toBe("session-123");
    expect(state.metadata.serverVersion).toBe("2.0.0");
    expect(state.lastAckSequence).toBe(9);
    expect(state.gameplay.sequence).toBe(9);
    expect(state.gameplay.character).toMatchObject({ displayName: "Hero" });
  });

  it("promotes to active on handshake acknowledgement and resets reconnect attempts", () => {
    useSessionStore.getState().startConnect("1.0.0");
    const handshake = eventAckSchema.parse({
      type: "event.ack",
      payload: {
        reason: "handshake",
        sessionId: "session-123",
        sequence: 12,
        version: "1.0.0",
        acknowledgedIntents: [],
        acknowledgedAt: iso()
      }
    });

    useSessionStore.getState().handleAckEvent(handshake);

    const state = useSessionStore.getState();
    expect(state.status).toBe("active");
    expect(state.metadata.sessionId).toBe("session-123");
    expect(state.lastAckSequence).toBe(12);
    expect(state.reconnect.attempts).toBe(0);
  });

  it("updates sequence, reconnect token, and gameplay snapshot on state delta", () => {
    const bootstrap = sessionBootstrapResponseSchema.parse({
      version: "2.0.0",
      issuedAt: iso(),
      session: {
        sessionId: "session-abc",
        userId: "user-xyz",
        status: "active",
        protocolVersion: "2.0.0",
        lastSequenceNumber: 5
      },
      state: {},
      reconnect: {
        token: "reconnect-1",
        expiresAt: iso()
      }
    });

    useSessionStore.getState().applyBootstrap(bootstrap);

    const delta = eventStateDeltaSchema.parse({
      type: "event.state_delta",
      payload: {
        sequence: 7,
        issuedAt: iso(),
        character: {
          characterId: "char-22",
          displayName: "Scout",
          position: { x: 5, y: 9 },
          stats: { hp: 24 },
          inventory: { potions: 2 }
        },
        reconnectToken: {
          token: "reconnect-2",
          expiresAt: iso()
        }
      }
    });

    useSessionStore.getState().handleStateDelta(delta);

    const state = useSessionStore.getState();
    expect(state.status).toBe("active");
    expect(state.lastAckSequence).toBe(7);
    expect(state.reconnect.token).toBe("reconnect-2");
    expect(state.gameplay.sequence).toBe(7);
    expect(state.gameplay.character?.displayName).toBe("Scout");
  });

  it("tracks degraded dependencies and surface status changes", () => {
    const degraded = eventDegradedSchema.parse({
      type: "event.degraded",
      payload: {
        dependency: "redis",
        status: "degraded",
        observedAt: iso(),
        message: "Redis latency high"
      }
    });

    useSessionStore.getState().handleDegradedEvent(degraded);

    let state = useSessionStore.getState();
    expect(state.status).toBe("degraded");
    expect(state.degradedDependencies.redis?.message).toBe("Redis latency high");

    const recovered = eventDegradedSchema.parse({
      type: "event.degraded",
      payload: {
        dependency: "redis",
        status: "recovered",
        observedAt: iso()
      }
    });

    useSessionStore.getState().handleDegradedEvent(recovered);
    state = useSessionStore.getState();
    expect(state.status).toBe("active");
    expect(state.degradedDependencies.redis).toBeUndefined();
  });

  it("enters update required state on version mismatch events", () => {
    const mismatch = eventVersionMismatchSchema.parse({
      type: "event.version_mismatch",
      payload: {
        expectedVersion: "3.0.0",
        receivedVersion: "2.9.0",
        message: "Client build is outdated"
      }
    });

    useSessionStore.getState().handleVersionMismatch(mismatch);

    const state = useSessionStore.getState();
    expect(state.status).toBe("update_required");
    expect(state.versionMismatch?.expectedVersion).toBe("3.0.0");
  });

  it("allocates monotonically increasing intent sequences", () => {
    useSessionStore.getState().startConnect("1.0.0");
    const first = useSessionStore.getState().nextSequence();
    const second = useSessionStore.getState().nextSequence();
    expect(second).toBe(first + 1);
  });
});
