# Data Model: Session Admission & Queue

**Feature**: 004-users-of-the  
**Status**: Draft Complete (Phase 1)  

## Entities

### CharacterSession
| Field | Type | Notes |
|-------|------|-------|
| sessionId | UUID | Generated on admission (and on replacement). |
| characterId | UUID | Foreign key to character domain (authoritative). |
| userId | UUID | For rate limit and ownership enforcement. |
| instanceId | string | Target game server instance identifier. |
| state | enum(SessionState) | pending | active | grace | terminating. |
| admittedAt | epoch ms | For latency measurement & TTL heuristics. |
| lastHeartbeatAt | epoch ms | Server-updated for cleanup. |
| replacementOf | UUID? | Prior session replaced (audit). |
| reconnectionToken | UUID? | Single-use token (rotated on successful reconnect). |
| graceExpiresAt | epoch ms? | Present only in grace state. |

### ConnectionAttempt (transient)
| Field | Type | Notes |
| attemptId | UUID | Trace across logs. |
| characterId | UUID | From client active selection. |
| userId | UUID | Auth context. |
| instanceId | string | Instance target. |
| startedAt | epoch ms | For 10s timeout race. |
| outcome | enum(AttemptOutcome) | success | queued | failed | timeout. |
| failureReason | enum(FailureReason)? | Only if failed. |
| queuedRank | number? | Position at enqueue time (0-based). |

### QueueEntry (Redis sorted set logical view)
| Field | Type | Notes |
| characterId | UUID | Uniqueness enforced; cannot enqueue twice. |
| userId | UUID | For rate limiting, authorization. |
| instanceId | string | Partition key; queue is per instance. |
| enqueuedAt | epoch ms | Score in sorted set. |
| attemptId | UUID | Correlate back to attempt & logs. |

### RateLimitRecord (logical)
| Field | Type | Notes |
| userId | UUID | Scope of current limit. |
| windowStart | epoch ms | Rolling calculation anchor. |
| failures | int | Count in rolling window. |
| lockedUntil | epoch ms? | If in lockout. |

### Metrics Snapshot (exposed)
| Field | Type | Notes |
| activeSessions | int | Current active for instance. |
| queueDepth | int | Current queue size. |
| peakQueueDepth | int | Historical max since process start (resettable). |
| avgQueueWait | float | Derived from histogram (approx). |
| p95QueueWait | float | Derived; placeholder until SLA set. |

## Enumerations

### SessionState
- pending (admission logic executing)
- active (participant inside instance)
- grace (temporary disconnect; slot reserved)
- terminating (cleanup underway)

### AttemptOutcome
- success
- queued
- failed
- timeout

### FailureReason
- NOT_AUTHENTICATED
- NO_ACTIVE_CHARACTER
- ALREADY_IN_SESSION
- CAPACITY_FULL
- QUEUE_FULL
- VERSION_MISMATCH
- MAINTENANCE
- DRAIN_MODE
- INVALID_INSTANCE
- CHARACTER_SUSPENDED
- RATE_LIMITED
- TIMEOUT (system-assigned when 10s triggered)
- INTERNAL_ERROR (catch-all, should be rare)

### DisconnectReason
- user
- network
- replace
- grace_expired

## Invariants
- At most one active/grace session per characterId across cluster.  
- QueueEntry exists only if character has no active/grace session.  
- Reconnection token valid only while session in grace and not yet used.  
- Replacing a session moves old session to terminating → removed before new becomes active.  
- Drain mode: no new QueueEntry creation; promotions continue.  

## Derived Behaviors
- Queue Promotion: Pop lowest enqueuedAt where capacity allows → create CharacterSession (active) → emit connection.admitted.  
- Grace Transition: On unexpected disconnect → state=grace, set graceExpiresAt, add reconnectionToken, keep capacity slot counted.  
- Grace Expiry: Janitor sees now > graceExpiresAt → remove session, decrement active, emit disconnected(grace_expired).  
- Replacement: Prompt accepted → mark old terminating, create new active session; copy over characterId, userId; revoke old reconnection token.  

## Validation Rules
- Admission rejects if FailureReason preconditions encountered (order: auth → ownership → suspension → version → active session → drain/capacity/queue).  
- Rate-limit check occurs prior to costly operations allocating queue or session.  
- Input instanceId sanitized (allowed pattern e.g., `^[a-zA-Z0-9_-]+$`).  

## State Machine (Frontend Connection FSM - high level)
```
IDLE -> CONNECTING -> ( ADMITTED | QUEUED | FAILED | TIMEOUT )
QUEUED --(position poll / promotion)--> ADMITTED
ADMITTED --(disconnect)--> IDLE
ADMITTED --(network drop)--> RECONNECTING -> (ADMITTED | GRACE_FAILED)
RECONNECTING --(timer 60s)--> GRACE_FAILED
GRACE_FAILED -> IDLE
CONNECTING --(rate limit)--> FAILED
CONNECTING --(version mismatch)--> FAILED
CONNECTING --(already in session)--> FAILED
CONNECTING --(timeout 10s)--> TIMEOUT
```

## Security & Integrity Notes
- All mutating scripts assert expected prior state to avoid lost updates.  
- Recon token rotation ensures replay attempts fail after success.  
- Logging includes attemptId + sessionId facilitating forensic reconstruction.  

## Open (Accepted) Items
- Numeric SLA for queue p95 wait left TBD; instrumentation fields structured to add later without schema change.  

