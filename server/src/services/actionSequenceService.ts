import type { PlayerSessionState, PlayerSessionStore } from "../models/playerSession.js";
import type { MetricsService } from "./metricsService.js";

export type SequenceStatus =
  | "accept"
  | "duplicate"
  | "out_of_order"
  | "gap"
  | "missing_session"
  | "invalid";

export type SequenceErrorCode =
  | "SEQ_OUT_OF_ORDER"
  | "SEQ_GAP_DETECTED"
  | "SEQ_SESSION_MISSING"
  | "SEQ_INVALID_SEQUENCE";

export interface SequenceEvaluationBase {
  sessionId: string;
  sequence: number;
  previousSequence: number | null;
  expectedNext: number;
  status: SequenceStatus;
}

export interface SequenceAcceptResult extends SequenceEvaluationBase {
  status: "accept";
  requiresFullResync: false;
  message?: string;
}

export interface SequenceDuplicateResult extends SequenceEvaluationBase {
  status: "duplicate";
  requiresFullResync: false;
  message?: string;
}

export interface SequenceOutOfOrderResult extends SequenceEvaluationBase {
  status: "out_of_order";
  errorCode: SequenceErrorCode;
  requiresFullResync: false;
  message: string;
}

export interface SequenceGapResult extends SequenceEvaluationBase {
  status: "gap";
  errorCode: SequenceErrorCode;
  missingCount: number;
  requiresFullResync: true;
  message: string;
}

export interface SequenceMissingSessionResult extends SequenceEvaluationBase {
  status: "missing_session";
  errorCode: SequenceErrorCode;
  requiresFullResync: true;
  message: string;
}

export interface SequenceInvalidResult extends SequenceEvaluationBase {
  status: "invalid";
  errorCode: SequenceErrorCode;
  requiresFullResync: false;
  message: string;
}

export type SequenceEvaluationResult =
  | SequenceAcceptResult
  | SequenceDuplicateResult
  | SequenceOutOfOrderResult
  | SequenceGapResult
  | SequenceMissingSessionResult
  | SequenceInvalidResult;

export interface EvaluateSequenceInput {
  sessionId: string;
  sequence: number;
}

export interface AcknowledgeSequenceInput {
  sessionId: string;
  sequence: number;
}

export interface ActionSequenceServiceOptions {
  metrics?: MetricsService;
  now?: () => Date;
  pendingSnapshotTtlMs?: number;
}

const DEFAULT_PENDING_SNAPSHOT_TTL_MS = 60_000;

interface PendingSnapshotEntry {
  result: SequenceGapResult | SequenceMissingSessionResult;
  scheduledAt: Date;
}

export class ActionSequenceService {
  private readonly sessions: PlayerSessionStore;
  private readonly metrics?: MetricsService;
  private readonly now: () => Date;
  private readonly pendingSnapshotTtlMs: number;
  private readonly pendingSnapshots = new Map<string, PendingSnapshotEntry>();

  constructor(sessions: PlayerSessionStore, options: ActionSequenceServiceOptions = {}) {
    this.sessions = sessions;
    this.metrics = options.metrics;
    this.now = options.now ?? (() => new Date());
    this.pendingSnapshotTtlMs = Math.max(1_000, options.pendingSnapshotTtlMs ?? DEFAULT_PENDING_SNAPSHOT_TTL_MS);
  }

  evaluate(input: EvaluateSequenceInput): SequenceEvaluationResult {
    const session = this.sessions.get(input.sessionId);

    if (!session) {
      const result = this.createMissingSessionResult(input.sessionId, input.sequence);
      this.scheduleFullSnapshot(result);
      return result;
    }

    if (!Number.isInteger(input.sequence) || input.sequence < 0) {
      return this.createInvalidResult(session, input.sequence);
    }

    const lastSequence = session.lastSequenceNumber ?? 0;
    const expectedNext = lastSequence + 1;

    if (input.sequence === expectedNext) {
      return this.createAcceptResult(session, input.sequence, lastSequence, expectedNext);
    }

    if (input.sequence === lastSequence) {
      return this.createDuplicateResult(session, input.sequence, lastSequence, expectedNext);
    }

    if (input.sequence < expectedNext) {
      return this.createOutOfOrderResult(session, input.sequence, lastSequence, expectedNext);
    }

    const result = this.createGapResult(session, input.sequence, lastSequence, expectedNext);
    this.scheduleFullSnapshot(result);
    return result;
  }

  acknowledge(input: AcknowledgeSequenceInput): PlayerSessionState | null {
    this.pendingSnapshots.delete(input.sessionId);
    return this.sessions.recordActionSequence(input.sessionId, input.sequence);
  }

  getLastSequence(sessionId: string): number | null {
    const session = this.sessions.get(sessionId);
    return session ? session.lastSequenceNumber : null;
  }

  resetSequence(sessionId: string, sequence: number): PlayerSessionState | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const normalized = Math.max(0, Math.floor(sequence));
    const updated = this.sessions.createOrUpdateSession({
      sessionId: session.sessionId,
      userId: session.userId,
      characterId: session.characterId,
      status: session.status,
      protocolVersion: session.protocolVersion,
      initialSequenceNumber: normalized,
      heartbeatAt: session.lastHeartbeatAt
    });

    this.pendingSnapshots.delete(sessionId);
    return updated;
  }

  consumePendingSnapshot(sessionId: string): SequenceGapResult | SequenceMissingSessionResult | null {
    this.expireStaleSnapshot(sessionId);
    const entry = this.pendingSnapshots.get(sessionId);
    if (!entry) {
      return null;
    }

    this.pendingSnapshots.delete(sessionId);
    return entry.result;
  }

  hasPendingSnapshot(sessionId: string): boolean {
    this.expireStaleSnapshot(sessionId);
    return this.pendingSnapshots.has(sessionId);
  }

  private createAcceptResult(
    session: PlayerSessionState,
    sequence: number,
    previousSequence: number,
    expectedNext: number
  ): SequenceAcceptResult {
    return {
      sessionId: session.sessionId,
      sequence,
      previousSequence,
      expectedNext,
      status: "accept",
      requiresFullResync: false,
      message: "Sequence accepted"
    } satisfies SequenceAcceptResult;
  }

  private createDuplicateResult(
    session: PlayerSessionState,
    sequence: number,
    previousSequence: number,
    expectedNext: number
  ): SequenceDuplicateResult {
    return {
      sessionId: session.sessionId,
      sequence,
      previousSequence,
      expectedNext,
      status: "duplicate",
      requiresFullResync: false,
      message: "Duplicate sequence received"
    } satisfies SequenceDuplicateResult;
  }

  private createOutOfOrderResult(
    session: PlayerSessionState,
    sequence: number,
    previousSequence: number,
    expectedNext: number
  ): SequenceOutOfOrderResult {
    return {
      sessionId: session.sessionId,
      sequence,
      previousSequence,
      expectedNext,
      status: "out_of_order",
      errorCode: "SEQ_OUT_OF_ORDER",
      requiresFullResync: false,
      message: `Received sequence ${sequence} but expected >= ${expectedNext}`
    } satisfies SequenceOutOfOrderResult;
  }

  private createGapResult(
    session: PlayerSessionState,
    sequence: number,
    previousSequence: number,
    expectedNext: number
  ): SequenceGapResult {
    const missingCount = Math.max(1, sequence - expectedNext);
    return {
      sessionId: session.sessionId,
      sequence,
      previousSequence,
      expectedNext,
      status: "gap",
      errorCode: "SEQ_GAP_DETECTED",
      missingCount,
      requiresFullResync: true,
      message: `Detected gap before sequence ${sequence}; missing ${missingCount} sequence(s)`
    } satisfies SequenceGapResult;
  }

  private createMissingSessionResult(sessionId: string, sequence: number): SequenceMissingSessionResult {
    return {
      sessionId,
      sequence,
      previousSequence: null,
      expectedNext: 1,
      status: "missing_session",
      errorCode: "SEQ_SESSION_MISSING",
      requiresFullResync: true,
      message: "Session not found while validating sequence"
    } satisfies SequenceMissingSessionResult;
  }

  private createInvalidResult(session: PlayerSessionState, sequence: number): SequenceInvalidResult {
    return {
      sessionId: session.sessionId,
      sequence,
      previousSequence: session.lastSequenceNumber ?? 0,
      expectedNext: (session.lastSequenceNumber ?? 0) + 1,
      status: "invalid",
      errorCode: "SEQ_INVALID_SEQUENCE",
      requiresFullResync: false,
      message: "Sequence must be a non-negative integer"
    } satisfies SequenceInvalidResult;
  }

  private scheduleFullSnapshot(result: SequenceGapResult | SequenceMissingSessionResult): void {
    const sessionId = result.sessionId;
    if (!sessionId) {
      return;
    }

    const entry = this.pendingSnapshots.get(sessionId);
    const now = this.now();
    if (entry && !this.isEntryExpired(entry, now)) {
      if (entry.result.sequence <= result.sequence) {
        entry.scheduledAt = now;
        return;
      }
    }

    if (!entry || this.isEntryExpired(entry, now)) {
      this.metrics?.recordForcedStateRefresh();
    }

    this.pendingSnapshots.set(sessionId, {
      result,
      scheduledAt: now
    });
  }

  private expireStaleSnapshot(sessionId: string): void {
    const entry = this.pendingSnapshots.get(sessionId);
    if (!entry) {
      return;
    }

    if (this.isEntryExpired(entry, this.now())) {
      this.pendingSnapshots.delete(sessionId);
    }
  }

  private isEntryExpired(entry: PendingSnapshotEntry, reference: Date): boolean {
    return reference.getTime() - entry.scheduledAt.getTime() > this.pendingSnapshotTtlMs;
  }
}
