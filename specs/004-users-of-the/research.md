# Research: Connect Active Character Session Admission

**Feature**: 004-users-of-the  
**Date**: 2025-09-27  
**Status**: Complete (all targeted unknowns resolved; one intentional deferment: queue wait p95 SLA)

## Research Goals
1. Determine authoritative session + queue data placement (in-memory vs Redis + DB reconciliation).  
2. Define reconnection mechanism (grace token vs character identity only).  
3. Select rate limiting algorithm (sliding window vs fixed window) with Redis integration.  
4. Identify event & counter taxonomy for observability.  
5. Decide approach for queue status dissemination (push vs poll).  
6. Clarify version gating lookup mechanism.  
7. Capture security considerations for session replacement & reconnection abuse.  
8. Assess failure mode handling for stale sessions (crash / lost disconnect).  

## Findings & Decisions

### 1. Session & Queue Data Placement
- **Decision**: Redis primary for ephemeral session entries + queue list + attempt counters; PostgreSQL not used for live queue writes (avoids high churn) but may persist audit events asynchronously if required later.  
- **Rationale**: O(1) operations for push/pop, atomic scripts (EVAL) to enforce single-session invariant, fast TTL-based grace expiration.  
- **Alternatives**: Pure in-process (fails under multi-instance scale); direct Postgres (adds latency, locking complexity).  

### 2. Reconnection Mechanism
- **Decision**: Short-lived reconnection token (random UUID) bound to (characterId, instanceId, expiryTimestamp) stored in Redis; client presents token on reconnect within 60s.  
- **Rationale**: Reduces race risk vs relying only on character id (prevents malicious attempt with stolen auth still active).  
- **Alternatives**: Plain character ID (insufficient spoof protection); WebSocket session id reuse (tightly couples protocol).  

### 3. Rate Limiting
- **Decision**: Sliding window counter using Redis INCR with timestamps (Lua script or simple bucket key per 60s) returning remaining attempts & lock TTL.  
- **Rationale**: Rolling accuracy better matches spec wording “any rolling 60 second window.”  
- **Alternatives**: Token bucket (more flexible bursts; unnecessary); fixed window (edge boundary exploits).  

### 4. Observability Taxonomy
- **Event Names** (structured log):  
  - connection.attempt  
  - connection.queued  
  - connection.admitted  
  - connection.reconnect_attempt  
  - connection.reconnected  
  - connection.failed (reason=<code>)  
  - connection.timeout  
  - connection.throttled  
  - connection.disconnected (reason=user|network|replace|grace_expired)  
- **Counters / Gauges / Histograms**:  
  - counter: connection_attempt_total{reason="success|failed|queued|timeout|throttled"}  
  - gauge: session_active_current  
  - gauge: queue_depth_current, gauge: queue_depth_peak  
  - histogram: queue_wait_seconds (observe on admission)  
  - histogram: admission_latency_seconds (non-queued)  
  - counter: reconnection_success_total / reconnection_attempt_total  
  - counter: rate_limit_block_total  
  - counter: version_mismatch_total  

### 5. Queue Status Dissemination
- **Decision**: Client receives initial queued position via admission response; subsequent positions polled every 5s via lightweight HTTP or WebSocket-side periodic server push (choose HTTP poll initial; upgrade to push later).  
- **Rationale**: Simpler; avoids maintaining per-queue subscriber list early.  
- **Alternatives**: WebSocket broadcast; SSE channel (overhead & complexity not yet justified).  

### 6. Version Gating Lookup
- **Decision**: Server environment exposes CURRENT_CLIENT_BUILD (semantic or hash). Admission checks client-provided build header / param.  
- **Rationale**: Minimal; environment variable or config service; can evolve to compatibility matrix.  
- **Alternatives**: Database table; remote config service (overkill initially).  

### 7. Security Considerations
- Enforce ownership check before any session mutation.  
- Reconnection token single-use; rotate on successful reconnect; TTL 60s.  
- Replacement confirm flow: new attempt obtains transient replacement token; if user cancels, discard.  
- Log suspicious patterns (rapid token failures, multiple mismatched reconnect attempts).  

### 8. Stale Session Cleanup
- **Decision**: Grace entries with TTL 60s auto-clear; periodic (e.g., 30s) janitor job reconciles any in-session records whose WebSocket no longer active (if heartbeat missing > 2 intervals).  
- **Rationale**: Self-healing without manual intervention; supports crash recovery.  
- **Alternatives**: Pure heartbeat w/out TTL (risk of missed cleanup); DB cron (heavier).  

### 9. Deterministic Outcome (10s Rule)
- Use Promise.race over: admission attempt, queue placement, explicit failure, timer (10s). Timer cancellation on outcome.  
- Observability: increment timeout counter & event with elapsed time recorded.  

### 10. Queue Implementation Details
- Redis List (LPUSH/BRPOP) alone insufficient for position queries; choose Sorted Set (ZADD score=enqueueTimestamp). Pop earliest via ZRANGE+ZREM atomic script. Position via ZRANK.  
- Peak depth tracked by comparing queue size after each enqueue.  

### 11. Atomic Admission
- Lua script: Validate (capacity > activeSessions), character not active, not suspended, version ok, rate limit pass → add session, increment active counter, return success; else produce reason code.  

## Deferred / Open (Accepted)
- Queue wait p95 SLA numeric target: will decide after initial instrumentation (collect baseline under synthetic load).  
- Push-based dynamic queue updates: future improvement.  

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Redis outage | Admission & queue fail | Fallback: reject with retry-after, protect session integrity |
| Clock skew across nodes | Wait time estimation inaccurate | Use enqueue timestamp from single source (Redis server time) |
| Large queue churn | CPU on rank queries | Cap length=1000, O(log n) acceptable |
| Token theft (MITM) | Unauthorized reconnect | TLS + short TTL + token bound to character+instance |
| Misconfigured CURRENT_CLIENT_BUILD | Mass version mismatch | Alert on mismatch spike via metric |

## Glossary Additions
- **Reconnection Token**: Ephemeral credential enabling session reclaim within grace window.  
- **Drain Mode**: Instance state allowing only queued promotions + reconnections; denies new enqueue attempts.  

## Summary
All architectural and behavioral unknowns addressed; design is constitution-compliant; safe to proceed to Phase 1 design & contract elaboration.
