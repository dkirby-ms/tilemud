# Phase 0 Research: Scalable Game Service Backend (003-server)

## Decisions & Rationale

### D1: Persistence Layer (Relational Core + Cache)
- Decision: Use PostgreSQL for durable data (players, guilds, instances metadata, rule configs, replay metadata) and Redis for ephemeral state (presence, rate limit buckets, matchmaking queues) and short-lived locks.
- Rationale: Strong consistency & relational modeling for social + audit; Redis provides low-latency atomic ops for counters & pub/sub patterns (if needed for event fan-out augmentation to Colyseus rooms).
- Alternatives: (a) Single DB (Postgres only) → higher latency for counters & potential contention; (b) NoSQL document store → weaker relational guarantees for guild + social graph.

### D2: Replay Format
- Decision: JSON Lines event stream (one canonical event per line, monotonic server timestamp + sequence ID) gzipped at rest.
- Rationale: Human-inspectable, easy incremental write, streaming-friendly; compression mitigates size; deterministic rebuild via ordered events.
- Alternatives: (a) Binary protobuf pack → smaller but less inspectable early; (b) Full snapshot + deltas → more complexity for 7-day retention horizon.

### D3: Message Schema Versioning
- Decision: Semantic version per message family (e.g., tile.v1, tile.v2) with server broadcasting supported versions during handshake; clients ignore unknown types.
- Rationale: Enables additive evolution, client forward-compat checks.
- Alternatives: Global protocol version (forces synchronized upgrades); tag-less evolution (risk of silent breakage).

### D4: Observability Stack
- Decision: Minimal initial: structured JSON logs + latency histograms + counters (actions/sec, AI load, p95 latency) using a metrics facade (e.g., prom-client) emitting /metrics; optional OpenTelemetry instrumentation later.
- Rationale: Fast to implement; Prometheus compatibility; defers OTEL overhead until scale justifies.
- Alternatives: Full OTEL now (added complexity/time); ad-hoc logging only (insufficient visibility).

### D5: Security / Auth Handshake
- Decision: Client supplies existing web-client auth token (format TBD by auth provider) to an HTTP endpoint exchanging for a short-lived session ticket bound to player ID; Colyseus room join requires ticket; replay endpoints require server validation of ownership / rights.
- Rationale: Isolates WebSocket join from raw bearer reuse; supports revocation window.
- Alternatives: Direct bearer on WS (higher replay risk); custom mutual key exchange (overkill now).

### D6: Rate Limiting Mechanism
- Decision: Sliding window counters in Redis (hash or Lua script) keyed by (playerId:actionType) with TTL, returning remaining quota; denial returns standardized throttle code.
- Rationale: Horizontal scalability, atomic evaluation; reuses existing infra choice.
- Alternatives: In-memory per-node (not safe under multi-node scale); token bucket library only (less precise fairness for bursts).

### D7: AI Elastic Monitoring
- Decision: 10s polling sampler centralized per shard using aggregated process/system metrics; steps applied atomically across rooms.
- Rationale: Consistency; avoids per-room jitter; matches FR-004 intervals.
- Alternatives: Per-room adaptive logic (inconsistent user experience).

### D8: Replay Storage Location
- Decision: Postgres large object or dedicated object storage (S3-compatible) abstracted behind repository; initial: table with gzip bytea for simplicity; revisit when size > threshold.
- Rationale: Faster iteration; single backup domain early.
- Alternatives: Immediate object store (more setup overhead now).

### D9: Conflict Resolution Tick Interval
- Decision: 100ms scheduling window aligning with latency budget (≤200ms p95) leaving margin for processing + network.
- Rationale: Balances responsiveness vs CPU overhead; deterministic collection window.
- Alternatives: 50ms (more overhead); 250ms (sluggish feel).

## Open Follow-ups (non-blocking for Plan)
- Evaluate need for dedicated message broker for cross-shard events (e.g., NATS / Kafka) once multi-shard scaling occurs.
- Add OpenTelemetry once baseline KPIs stable.
- Assess binary replay format if average replay > 5MB compressed.

## Derived Constraints
- Max conflict resolution latency (client perception) ~ tick interval + network roundtrip.
- Write amplification: AI events + tile placements drive replay log growth → monitor average events per second.

## Research Completed Gate
All critical unknowns for Phase 1 are addressed with explicit decisions or documented follow-ups.
