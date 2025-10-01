# Research: Integrate Server, Web Client, and Backing Data Layers

## Decisions

### Reconnect Retry Policy
- **Decision**: Exponential backoff with full jitter; attempts at ~1s, 2s, 4s, 8s, 16s (cap 5 attempts ~31s total) then surface failure UI, manual retry enabled.
- **Rationale**: Balances fast recovery for transient blips with protection against thundering herd.
- **Alternatives**: Linear retry (too slow under transient congestion); fixed intervals (risk synchronized retries); infinite retries (poor UX & resource waste).

### Rollback Semantics (Multi-step Actions)
- **Decision**: Reject-on-failure atomic boundary. No compensating events emitted to client; if partial internal failure occurs, server aborts and returns structured error. Client resubmits if still relevant. Idempotent action sequence numbers prevent duplication.
- **Rationale**: Simplicity, determinism, minimal state divergence risk.
- **Alternatives**: Saga-style compensation (overhead + added complexity not justified); partial success (breaks user consistency expectation).

### Outage Messaging Taxonomy
- **Decision**: Distinct user-facing states: CONNECTING, RECONNECTING (countdown), DEGRADED (cache offline), UPDATE_REQUIRED (version lockstep fail), READ_ONLY (future optional), UNAVAILABLE (persistent store outage), RETRY_LIMIT_REACHED.
- **Rationale**: Improves observability and actionable feedback; aligns with testable UI states.
- **Alternatives**: Generic error banner (opaque; harder to debug/test); silent retry loops (unclear UX).

### Authorization Roles
- **Decision**: Single role: PLAYER for this feature scope. Moderator / admin deferred.
- **Rationale**: No current requirements referencing elevated capabilities.
- **Alternatives**: Premature role scaffolding increases complexity without immediate value.

### Metrics & Observability
- **Decision**: Mandatory metrics: connect_attempts_total, connect_success_total, reconnect_attempts_total, reconnect_success_total, version_reject_total, action_latency_ms histogram, state_refresh_forced_total, cache_hit_ratio (gauge), latency_p95 (derived), active_sessions_gauge.
- **Rationale**: Enables SLO tracking for latency, reliability, version hygiene, cache efficacy.
- **Alternatives**: Fewer metrics (reduced diagnostic power); overly granular per-action-type histograms (premature cardinatlity growth risk).

### Scalability Baseline
- **Decision**: Target 500 concurrent active player sessions per server node (initial baseline). Stretch goal: 1500 with horizontal scaling via room partitioning.
- **Rationale**: Provides measurable threshold for load tests and capacity alerts.
- **Alternatives**: Undefined scale (no capacity planning); immediate high stretch (risk premature optimization).

### Inactivity Timeout
- **Decision**: 10 minutes (600s) of no validated player action or heartbeat → session termination.
- **Rationale**: Frees server resources while tolerating normal pauses.
- **Alternatives**: Shorter (premature kicks); longer (resource retention risk).

### Privacy & PII Boundaries
- **Decision**: Store only opaque user_id and session_id hash; exclude IP, raw tokens, personal names from durable logs. Truncate token to hash for correlation. Redact payloads in error logs.
- **Rationale**: Minimizes exposure, simplifies compliance posture.
- **Alternatives**: Full token or PII logging (higher breach risk; compliance overhead).

### Reconnect Consistency Model
- **Decision**: Last-write-wins combined with authoritative server sequence ordering; client resync provides delta since last acknowledged sequence. Missed sequence triggers server to send full differential snapshot.
- **Rationale**: Predictable; avoids vector clock overhead.
- **Alternatives**: CRDT or vector clocks (overkill for linear action stream), full snapshot always (inefficient).

## Open Items (Deferred)
- Availability % target (to be aligned with broader platform SLO) — placeholder remains in NFR-003.
- Threat model elaboration (attack surfaces inventory) — will be part of separate security review doc.
- Detailed cache eviction tuning — postponed until profiling.

## Risks
- Per-action durability may amplify write load → mitigation: batch internal DB transaction commits where safe while still guaranteeing pre-ack persistence.
- Strict lockstep versioning increases update friction → mitigation: low-latency build deploy pipeline & version banner.
- 100ms freshness requirement may pressure server broadcast rate → mitigation: diff-based updates + adaptive coalescing.

## Validation Plan Hooks
- Load test scenarios: 500 concurrent sessions, sustained action rate → measure latency histograms.
- Chaos tests: simulated Redis outage (expect DEGRADED state, continued correctness); simulated DB outage (UNAVAILABLE + paused acknowledgments).
- Reconnect tests: forced network drop at random action intervals (validate idempotent sequence, no duplicate effects).

## Alternatives Summary Table
| Decision Area | Chosen | Primary Alternative | Reason Rejected |
|---------------|--------|---------------------|-----------------|
| Retry Policy | Exponential jitter | Linear retry | Slower recovery, synchronized bursts |
| Rollback | Reject atomic | Saga compensation | Complexity > benefit |
| Freshness | 100ms window | 250–500ms window | Higher staleness risk |
| Versioning | Strict lockstep | Dual minor support | Protocol drift risk |
| Persistence | Per-action | Interval checkpoint | Potential progress loss |
| Consistency | LWW + seq | CRDT clocks | Complexity overhead |

## Completion
All previously marked NEEDS CLARIFICATION items (except availability %, threat model depth) resolved.
