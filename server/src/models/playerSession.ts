import { performance } from "node:perf_hooks";

export type PlayerSessionStatus = "connecting" | "active" | "reconnecting" | "terminating";

export interface PlayerSessionState {
  sessionId: string;
  userId: string;
  characterId: string;
  status: PlayerSessionStatus;
  protocolVersion: string;
  lastSequenceNumber: number;
  lastHeartbeatAt: Date;
  reconnectAttempts: number;
  createdAt: Date;
}

export interface CreatePlayerSessionOptions {
  sessionId: string;
  userId: string;
  characterId: string;
  protocolVersion: string;
  status?: PlayerSessionStatus;
  initialSequenceNumber?: number;
  heartbeatAt?: Date;
}

export class PlayerSessionStore {
  private readonly sessions = new Map<string, PlayerSessionState>();

  createOrUpdateSession(options: CreatePlayerSessionOptions): PlayerSessionState {
    const now = options.heartbeatAt ?? new Date();
    const existing = this.sessions.get(options.sessionId);

    if (existing) {
      const updated: PlayerSessionState = {
        ...existing,
        userId: options.userId,
        characterId: options.characterId,
        protocolVersion: options.protocolVersion,
        status: options.status ?? existing.status,
        lastSequenceNumber: options.initialSequenceNumber ?? existing.lastSequenceNumber,
        lastHeartbeatAt: now
      };
      this.sessions.set(options.sessionId, updated);
      return structuredClone(updated);
    }

    const initial: PlayerSessionState = {
      sessionId: options.sessionId,
      userId: options.userId,
      characterId: options.characterId,
      protocolVersion: options.protocolVersion,
      status: options.status ?? "connecting",
      lastSequenceNumber: options.initialSequenceNumber ?? 0,
      lastHeartbeatAt: now,
      reconnectAttempts: 0,
      createdAt: now
    };

    this.sessions.set(options.sessionId, initial);
    return structuredClone(initial);
  }

  get(sessionId: string): PlayerSessionState | null {
    const state = this.sessions.get(sessionId);
    return state ? structuredClone(state) : null;
  }

  setStatus(sessionId: string, status: PlayerSessionStatus): PlayerSessionState | null {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return null;
    }
    const updated = { ...current, status };
    this.sessions.set(sessionId, updated);
    return structuredClone(updated);
  }

  recordActionSequence(sessionId: string, sequenceNumber: number): PlayerSessionState | null {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return null;
    }

    if (sequenceNumber > current.lastSequenceNumber) {
      current.lastSequenceNumber = sequenceNumber;
    }

    current.lastHeartbeatAt = new Date();
    this.sessions.set(sessionId, current);
    return structuredClone(current);
  }

  recordHeartbeat(sessionId: string, heartbeatAt = new Date()): PlayerSessionState | null {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return null;
    }

    current.lastHeartbeatAt = heartbeatAt;
    this.sessions.set(sessionId, current);
    return structuredClone(current);
  }

  incrementReconnectAttempts(sessionId: string): PlayerSessionState | null {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return null;
    }

    current.reconnectAttempts += 1;
    this.sessions.set(sessionId, current);
    return structuredClone(current);
  }

  resetReconnectAttempts(sessionId: string): PlayerSessionState | null {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return null;
    }

    current.reconnectAttempts = 0;
    this.sessions.set(sessionId, current);
    return structuredClone(current);
  }

  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  listSessions(): PlayerSessionState[] {
    return Array.from(this.sessions.values(), (state) => structuredClone(state));
  }

  pruneStaleSessions(maxIdleMs: number, referenceTime = new Date()): string[] {
    const expired: string[] = [];
    for (const [sessionId, state] of this.sessions.entries()) {
      if (referenceTime.getTime() - state.lastHeartbeatAt.getTime() > maxIdleMs) {
        this.sessions.delete(sessionId);
        expired.push(sessionId);
      }
    }
    return expired;
  }
}

export function isSessionInactive(state: PlayerSessionState, maxIdleMs: number, referenceTime = new Date()): boolean {
  return referenceTime.getTime() - state.lastHeartbeatAt.getTime() > maxIdleMs;
}

export function markSessionTerminating(store: PlayerSessionStore, sessionId: string): PlayerSessionState | null {
  return store.setStatus(sessionId, "terminating");
}
