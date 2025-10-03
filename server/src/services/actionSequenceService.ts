import type { PlayerSessionState, PlayerSessionStore } from "../models/playerSession.js";

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

export class ActionSequenceService {
  constructor(private readonly sessions: PlayerSessionStore) {}

  evaluate(input: EvaluateSequenceInput): SequenceEvaluationResult {
    const session = this.sessions.get(input.sessionId);

    if (!session) {
      return this.createMissingSessionResult(input.sessionId, input.sequence);
    }

    if (!Number.isInteger(input.sequence) || input.sequence < 0) {
      return this.createInvalidResult(session, input.sequence);
    }

    const lastSequence = session.lastSequenceNumber ?? 0;
    const expectedNext = lastSequence + 1;

    if (input.sequence === expectedNext) {
      return {
        sessionId: session.sessionId,
        sequence: input.sequence,
        previousSequence: lastSequence,
        expectedNext,
        status: "accept",
        requiresFullResync: false,
        message: "Sequence accepted"
      } satisfies SequenceAcceptResult;
    }

    if (input.sequence === lastSequence) {
      return {
        sessionId: session.sessionId,
        sequence: input.sequence,
        previousSequence: lastSequence,
        expectedNext,
        status: "duplicate",
        requiresFullResync: false,
        message: "Duplicate sequence received"
      } satisfies SequenceDuplicateResult;
    }

    if (input.sequence < expectedNext) {
      return {
        sessionId: session.sessionId,
        sequence: input.sequence,
        previousSequence: lastSequence,
        expectedNext,
        status: "out_of_order",
        errorCode: "SEQ_OUT_OF_ORDER",
        requiresFullResync: false,
        message: `Received sequence ${input.sequence} but expected >= ${expectedNext}`
      } satisfies SequenceOutOfOrderResult;
    }

    const missingCount = input.sequence - expectedNext;

    return {
      sessionId: session.sessionId,
      sequence: input.sequence,
      previousSequence: lastSequence,
      expectedNext,
      status: "gap",
      errorCode: "SEQ_GAP_DETECTED",
      missingCount,
      requiresFullResync: true,
      message: `Detected gap before sequence ${input.sequence}; missing ${missingCount} sequence(s)`
    } satisfies SequenceGapResult;
  }

  acknowledge(input: AcknowledgeSequenceInput): PlayerSessionState | null {
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
    return this.sessions.createOrUpdateSession({
      sessionId: session.sessionId,
      userId: session.userId,
      characterId: session.characterId,
      protocolVersion: session.protocolVersion,
      status: session.status,
      initialSequenceNumber: normalized,
      heartbeatAt: session.lastHeartbeatAt
    });
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
}
