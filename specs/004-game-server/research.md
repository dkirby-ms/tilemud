# Research: Large-Scale Multiplayer Tile Game Backend Service (Phase 0)

Date: 2025-09-29  
Related Spec: /home/saitcho/tilemud/specs/004-i-want-to/spec.md  
Plan: /home/saitcho/tilemud/specs/004-i-want-to/plan.md

## Overview
Objective: Identify and validate foundational technology choices and resolve open technical unknowns necessary to design Phase 1 artifacts (data model, contracts, quickstart) for the initial backend slice using Colyseus v0.16, PostgreSQL, and Redis.

## Key Decisions

### 1. Real-time Framework
- Decision: Colyseus v0.16
- Rationale: Provides authoritative room abstraction, state patching, schema encoding, presence hooks, and room lifecycle aligned with game instance semantics. Mature ecosystem, TypeScript-native.
- Alternatives Considered: Raw ws (higher boilerplate, lack of room abstractions), Socket.IO (less deterministic state sync semantics), custom UDP/WebRTC (premature complexity for latency target 150ms p95 over WebSockets).

### 2. State Synchronization Model
- Decision: Colyseus room state schema with granular mutations; out-of-band action commands processed server-side then applied to authoritative state; clients receive patches.
- Rationale: Minimizes trust in client; patch diff efficiency; leverages existing colyseus.js client already specified in constitution.
- Alternatives: Event-sourcing (adds persistence complexity), full snapshot broadcast (inefficient for high mutation frequency), CRDT (conflict ordering already deterministic server-side — CRDT unnecessary).

### 3. Deterministic Conflict Resolution
- Decision: Single-threaded (per-room) action queue processed each simulation tick with ordered phases: (1) prioritized scripted/NPC events (priority tier ascending), (2) player tile placement actions sorted by initiative descending, (3) residual events. Reject losing conflicts with precedence error.
- Rationale: Simplicity + reproducibility; avoids multi-thread race complexity; Colyseus room runs on event loop, so sequential order guaranteed.
- Alternatives: Distributed lock across multiple processes (unneeded for initial single-process room ownership), optimistic concurrency with rollback (overkill, adds latency risk).

### 4. Persistence Strategy
- Battle Runtime State: In-memory within room only; not persisted mid-battle.
- Durable Data: PostgreSQL tables for players, battle outcomes, rule set versions, private message audit log (metadata+content), error code catalog (future).  
- Ephemeral / Caching: Redis for rate limit counters (sliding windows), reconnect session tokens, presence markers, distributed locks (for multi-instance scaling later) and ephemeral private message delivery queue guarantees.
- Rationale: Postgres strong consistency, relational modeling for audit queries; Redis fast atomic increments for rate limits.

### 5. Reconnection Handling
- Decision: On disconnect, mark player 'disconnected_at'. Retain room membership until grace period elapsed (tracked via server clock; optionally schedule a timeout). If reconnected within 60s: rehydrate snapshot (serialize authoritative state portion relevant to player) + diff subscription continues.
- Alternatives: Persist incremental deltas for offline catch-up (unnecessary for 60s window), full replay logs (complex).

### 6. Rate Limiting Implementation
- Decision: Redis key pattern `rate:{playerId}:{channel}` with sliding window implemented using sorted set timestamps or token bucket with Lua script for atomic evaluation; start with fixed-window plus short buckets for simplicity (accuracy acceptable).
- Rationale: Predictable, quick to implement; supports multiple app server replicas later.
- Alternatives: In-memory per-process counters (not multi-instance safe), external SaaS (overkill).

### 7. Private Messaging Retention
- Decision: Store messages in Postgres table `private_messages` with `created_at` and scheduled daily purge job (SQL `DELETE` older than 30 days). Index on `(recipient_id, created_at)` for retrieval queries. Content immutable (no UPDATE allowed; enforce via application logic + possible DB trigger later if needed).
- Alternatives: Redis streams (retention risk & memory bloat), S3-like blob storage (premature).

### 8. Logging & Observability
- Decision: Pino logger -> stdout JSON. Critical events only. Metrics: Basic in-memory counters (exposed via minimal `/metrics` JSON or log lines) — Prometheus integration deferred. Log rotation handled by container runtime; retention policy enforced at aggregation (future infra feature). 7-day requirement satisfied operationally (docs note reliance on centralized log store).
- Alternatives: Winston (less performant), OpenTelemetry (deferred complexity).

### 9. API Layer Shape
- Decision: Minimal REST (Express 5) endpoints: health, outcomes retrieval (`GET /outcomes/:id` & `GET /players/:id/outcomes`), private message retrieval (in-scope for audit/view), error code catalog (`GET /errors/catalog` future). Real-time actions solely via Colyseus room messages.
- Alternatives: GraphQL (overhead not justified), gRPC (browser complexity, not needed early).

### 10. Schema Validation
- Decision: zod runtime validation for HTTP input + internal action payloads dispatched into rooms. Static typing enforced by TypeScript. Server rejects invalid early before queue.
- Alternatives: class-validator (decorator overhead), AJV JSON Schema (zod developer ergonomics preferred now).

### 11. Testing Strategy
- Contract Tests: OpenAPI schema tests (supertest) failing until implementation.
- Integration Tests: Room lifecycle (create/join, tile placement broadcast, conflict resolution, reconnection, chat, private message delivery, rate limiting).
- Unit Tests: Ordering comparator, rate limiter algorithm, rejection reasons mapping, snapshot generator.
- Load Smoke: Minimal script (later feature) simulating 50 rooms * 10 players.

### 12. Deployment & Scaling (Initial)
- Decision: Single server process (Node) behind existing Docker Compose infra for local dev; horizontal scaling & room distribution (presence & matchmaking) deferred. Code structured to allow future multi-process by isolating state to rooms and using Redis for shared ephemeral needs.
- Alternatives: Microservices split (premature), clustering (added complexity before proven need).

### 13. Unresolved / Deferred Clarifications
- Extended rejection code catalog (seed sufficient for initial slice) — future feature.
- Cross-shard ordering semantics not needed until multi-shard present (deferred).

## Data Implications
See `data-model.md` for entities derived from spec + persistence decisions. No multi-tenancy constraints identified for slice. Soft deletion not required for any table (hard retention policies suffice).

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Underestimated latency due to Node event loop contention | Breach of 150ms p95 target | Keep per-tick work minimal; consider worker thread for heavy AI later |
| Rate limiter precision with fixed window | Bursty edge acceptance | Accept for slice; upgrade to sliding-window ZSET if abuse observed |
| Single process failure loses active instances | Expected per spec (ephemeral) | Document clearly; future feature for resilience |
| Schema drift between client & server | Runtime errors | Shared types folder (future) + contract tests now |

## Summary Conclusion
No blocking unknowns remain. Architecture decisions balance simplicity with future scalability path. Proceed to Phase 1 design.
