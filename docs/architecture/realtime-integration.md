# Realtime Integration Architecture

This document captures the end-to-end architecture for integrating the authoritative TileMUD server with the React web client.

## High-Level Topology

```
Browser (React + colyseus.js)
        │
        ▼
Colyseus Gateway (WebSocket transport, server/src/index.ts)
        │
        ├─► Express REST API (session bootstrap, health, version)
        │
        └─► GameRoom (authoritative pipeline)
                 │
                 ├─► ActionSequencer ➝ ActionDurabilityService ➝ PostgreSQL
                 ├─► PlayerSessionStore ➝ Redis (presence + reconnect tokens)
                 ├─► MetricsService ➝ In-memory registry (exportable)
                 └─► DegradedSignalService ➝ GameRoom clients (event.degraded)
```

## Session Lifecycle

1. **Bootstrap** – The client calls `POST /api/session/bootstrap` to validate the access token and fetch initial character state and the current protocol version.
2. **Handshake** – The client upgrades to WebSocket, joins the `GameRoom`, and receives:
   - `event.ack` (handshake acknowledgment with acknowledged intents).
   - `event.state_delta` (authoritative snapshot of the player + world state).
3. **Steady State** – The client sends intent messages (`intent.move`, `intent.chat`, `intent.action`). The room validates payloads with zod, sequences intents, persists to PostgreSQL via the durability service, and broadcasts state deltas.
4. **Reconnect** – Network failures trigger exponential backoff retries. On success the reconnect service rehydrates state from PostgreSQL + Redis, producing either a delta replay or a full snapshot.
5. **Termination** – Idle sessions (≥10 minutes) or explicit logout transitions the session to `terminating` and the room emits a final `event.state_delta` removal.

## Key Services

| Service | Responsibility | Backing Store |
| --- | --- | --- |
| `PlayerSessionStore` | Tracks session metadata, status, heartbeats | Redis |
| `CharacterProfileRepository` | Fetches & updates character state | PostgreSQL |
| `ActionSequenceService` | Guarantees monotonic sequence ordering + gap detection | Redis (counters) + PostgreSQL |
| `ActionDurabilityService` | Persists actions before ack, handles rollback on failure | PostgreSQL |
| `ReconnectService` | Computes deltas vs snapshots, generates reconnect tokens | Redis + PostgreSQL |
| `MetricsService` | Emits counters/gauges/histograms for SLOs | In-memory registry |
| `DegradedSignalService` | Monitors Redis/postgres health & emits `event.degraded` | Redis/PostgreSQL health checks |
| `InactivityTimeoutService` | Schedules idle timeouts and notifies rooms | Redis ttl or in-memory timer wheel |

## Client Integration

- `web-client/src/features/session/colyseusClient.ts` encapsulates the handshake, reconnection logic, and translates server envelopes into store updates.
- `web-client/src/features/session/sessionStore.ts` uses Zustand to coordinate session status state transitions.
- `web-client/src/features/state/stateReducer.ts` applies authoritative deltas using immutable clones while preserving historical effects.
- Diagnostics overlays surface latency, reconnect attempts, and dependency degradation states directly from realtime events.

## Observability

- Structured logging (`pino`) is initialised in `server/src/logging/logger.ts` with scoped child loggers per service.
- Metrics emit to the in-memory registry; the `docs/integration-metrics.md` guide details metric names and thresholds.
- Availability SLOs are computed from connect/reconnect counters and exercised in `server/tests/integration/availability-slo.spec.ts`.

## Extensibility

- Additional rooms (e.g., `BattleRoom`) are registered through `registerRooms.ts` and can share container services.
- Future role-based permissions can extend the session bootstrap response and the reconnect token payload without breaking compatibility, provided the version gate is updated.
- To add new realtime events, define zod schemas in `server/src/contracts/realtimeSchemas.ts`, export the types, and generate matching client-side TypeScript types via the existing contract generation script.

## Data Flow Guarantees

1. **Server Authoritative** – Clients submit intents only; authoritative state changes originate in the server.
2. **Durability Before Ack** – `ActionDurabilityService` persists the action to PostgreSQL before `event.ack` is sent back to the client.
3. **Idempotency** – Sequence numbers ensure duplicate intents are detected and suppressed.
4. **Freshness Window** – The room forces a state refresh when cached data exceeds the 100ms freshness budget.
5. **Version Lockstep** – `VersionMismatchGuard` terminates connections where client/server protocol versions diverge.

## Next Steps

- Wire metrics export to Prometheus or Azure Monitor, depending on deployment target.
- Extend the performance harness to drive real Colyseus clients once the realtime fixtures are available.
- Integrate the log redaction audit into CI so nightly builds surface any regressions automatically.
