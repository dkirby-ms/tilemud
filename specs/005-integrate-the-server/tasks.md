# Task List: Integrate Server, Web Client, and Backing Data Layers

Legend: [P] = Parallelizable (no shared file contention); Dependencies listed by T###.

## TDD & Dependency Philosophy
- Tests precede implementation for contracts, sequencing, and resilience.
- Persistence primitives precede real-time handlers.
- Real-time handlers precede client UX wiring.
- Observability wired early to surface performance regressions.

## Setup & Governance
T001 Confirm spec/research frozen; document deferred availability SLO & threat model in research.md (no code).  
T002 Sync branch `005-integrate-the-server` with latest `main` (fast-forward or merge) [P].  

## Contracts & Validation (Server)
T003 Create REST contract schemas (bootstrap, health, version) in `specs/005-integrate-the-server/contracts/rest.ts` + mirror zod types in `server/src/contracts/rest.ts` [P].  
T004 Create real-time message schemas (intent.move/chat/action; event.state_delta/ack/error/degraded/version_mismatch) in `specs/.../contracts/realtime.ts` + `server/src/contracts/realtime.ts` (REUSE existing `actionRequestSchema` from `server/src/actions/actionRequest.ts` – do not redefine action variants) [P].  
T004A Consolidate rate limiting: adopt `RateLimiterService` as canonical, add channel mapping + adapter `server/src/services/rateLimitsAdapter.ts`, deprecate `GameRateLimits` usage (leave shim if still referenced) [P].  
T005 Add shared validation utilities (sequence guard, size limits) `server/src/contracts/validation.ts` [P].  
T006 Implement type generation script (e.g. `server/scripts/generate-shared-types.ts`) exporting to `web-client/src/types/generated/` [P].  
T007 Negative schema test vectors (invalid enums, oversize payload) in `server/tests/contract/invalidSchemas.test.ts` [P].  

## Persistence & Data Model
T008 Implement ActionEvent model + repository `server/src/models/actionEvent.ts` (insert, fetchBySequenceRange).  
T009 Implement per-action durability wrapper `server/src/services/durability.ts` (transaction + ack gating).  
T010 Implement sequence allocator & idempotency guard `server/src/services/sequencer.ts` (reject duplicates/gaps).  
T011 Implement CharacterProfile accessors `server/src/models/characterProfile.ts` (get/update position/inventory/stats) [P].  
T012 Add migration for ActionEvent + indices `infrastructure/migrations/003_action_event.sql`.  
T013 Implement inactivity timeout scheduler `server/src/services/sessionTimeout.ts` (10m idle) [P].  

## Session & Version Management
T014 Implement external token validation adapter `server/src/services/auth/tokenValidator.ts` (stub verifying signature / claims).  
T015 Implement `/api/session/bootstrap` handler `server/src/api/sessionBootstrap.ts` (validate token, version, return state).  
T016 Implement `/api/version` handler `server/src/api/version.ts` [P].  
T017 Enforce version lockstep inside handshake + REST (shared util) `server/src/services/versionCheck.ts`.  
T018 Implement `/api/health` reporting readiness + degraded flags `server/src/api/health.ts`.  
T019 Reconnect token issuance & validation `server/src/services/reconnect.ts`.  
T020 Reconnect delta vs snapshot logic `server/src/services/reconnectSync.ts`.  

## Real-time Room Logic
T021 Extend room join handshake `server/src/rooms/gameRoom.ts` (include version, token, initial sequence).  
T022 Implement intent handlers (move/chat/action) `server/src/rooms/intentHandlers.ts`.  
T023 Implement state delta broadcaster (100ms coalescing) `server/src/rooms/stateBroadcaster.ts`.  
T024 Implement degraded mode trigger from Redis outage `server/src/services/cacheStatus.ts`.  
T025 Enforce rate limits movement≤20/s, chat≤5/s using consolidated adapter (post T004A) `server/src/services/rateLimitsAdapter.ts`.  
T026 Emit ack only after durability success (integrate durability wrapper) modify `server/src/rooms/intentHandlers.ts`.  
T027 Server restart recovery test hook `server/scripts/testRestartRecovery.ts`.  

## Cache & Freshness
T028 Redis cache/presence wrapper `server/src/infra/cache.ts` (namespacing, TTL) [P].  
T029 Freshness checker `server/src/services/freshness.ts` (invalidate >100ms) [P].  
T030 Fallback path when cache down (flag + direct DB fetch) modify `server/src/services/cacheFallback.ts`.  

## Observability & Logging
T031 Metrics instrumentation `server/src/infra/metrics.ts` (counters, histogram, gauges).  
T032 Structured logging integration `server/src/infra/logging/sessionLifecycle.ts`.  
T033 Privacy filter (redact tokens, hash user IDs) `server/src/infra/logging/redaction.ts`.  
T034 Latency p95 aggregator `server/src/infra/metricsLatency.ts` [P].  
T035 Forced refresh counter instrumentation integrate in `freshness.ts` [P].  

## Client Integration (Web Client)
T036 Build/version constant injection `web-client/src/providers/version.ts` + overlay component.  
T037 Token acquisition/injection service `web-client/src/services/authToken.ts`.  
T038 Connection state machine `web-client/src/features/session/stateMachine.ts`.  
T039 Reconnection logic with exponential backoff `web-client/src/features/session/reconnect.ts`.  
T040 Action dispatch layer `web-client/src/features/actions/dispatcher.ts`.  
T041 Latency overlay component `web-client/src/components/dev/LatencyOverlay.tsx`.  
T042 Degraded/update-required messaging components `web-client/src/components/status/ConnectionStatus.tsx`.  
T043 Inactivity timeout UX notice component `web-client/src/components/status/InactivityNotice.tsx` [P].  
T044 Integrate generated types into reducers `web-client/src/state/contractsIntegration.ts` [P].  

## Contract & Unit Tests (Write First)
T045 REST contract tests `server/tests/contract/restContracts.test.ts` (bootstrap/version/health).  
T046 Real-time protocol tests `server/tests/contract/realtimeProtocol.test.ts`.  
T047 Sequencing/idempotency tests `server/tests/unit/sequencer.test.ts`.  
T048 Rate limit tests `server/tests/unit/rateLimiter.test.ts`.  
T049 Per-action durability test `server/tests/integration/durability.test.ts`.  
T050 Degraded mode test (Redis outage) `server/tests/integration/degraded.test.ts`.  
T051 Restart recovery test `server/tests/integration/restartRecovery.test.ts`.  

## Integration & E2E Tests
T052 Reconnect resilience test `server/tests/integration/reconnectResilience.test.ts`.  
T053 Freshness enforcement test `server/tests/integration/freshness.test.ts`.  
T054 Inactivity timeout test `server/tests/integration/inactivityTimeout.test.ts`.  
T055 Latency performance test harness `server/tests/perf/latencyHarness.test.ts`.  
T056 Load test scaffolding script `server/scripts/loadTest.ts`.  

## Documentation & DX
T057 Contract schema docs expansion `specs/005-integrate-the-server/contracts/README.md` (fill field-level details).  
T058 Update quickstart with final endpoints & metrics section.  
T059 Operational runbook `specs/005-integrate-the-server/runbook.md` (degraded, restart, latency debugging).  
T060 Update agent context `.specify/scripts/bash/update-agent-context.sh copilot`.  

## Quality Gates & Finalization
T061 Metrics presence & naming validation script `server/scripts/validateMetrics.ts`.  
T062 Lint + typecheck all packages (ensure CI config updated if needed).  
T063 All contract + integration tests green (tracking meta-task).  
T064 Performance acceptance capture (record p95 load + action latency) `specs/005-integrate-the-server/perf-results.md`.  
T065 Security/privacy log scan script `server/scripts/logPrivacyScan.ts`.  
T066 Remove temporary debug instrumentation (strip dev-only overlays if flagged).  

## Stretch / Deferred
T067 Availability SLO instrumentation & alerting once SLO chosen.  
T068 Threat model document `specs/005-integrate-the-server/threat-model.md`.  
T069 Advanced cache eviction tuning experiment doc.  
T070 Optional: Web Worker latency calc offload `web-client/src/workers/latencyWorker.ts`.  

## Parallel Execution Guidance
- Early Parallel Batch: T002 T003 T004 T004A T005 T006 T007
- Persistence + Metrics Batch: T008 T011 T013 T028 T029 T034 T035
- Client UI Batch (post type generation T006): T036 T037 T041 T042 T043 T044
- Tests always precede dependent impl: e.g., run T045–T051 before marking related implementation done.

## Dependency Highlights
- T015 depends on T014, T003, T017
- T021 depends on T014, T017, T019
- T022 depends on T010, T011, T021
- T026 depends on T009 + T022
- T023 depends on T022 + T029
- T024 depends on T028
- T052 depends on T019–T023
- T025 depends on T004A

## Acceptance Mapping
| Scenario | Tasks |
|----------|-------|
| Initial load ≤3s p95 | T015 T022 T023 T036 T041 T055 |
| Action latency ≤200ms p95 | T022 T023 T026 T031 T041 T055 |
| Reconnect w/o loss | T019 T020 T022 T026 T039 T047 T052 |
| Degraded w/ cache down | T024 T028 T030 T050 |
| Version mismatch block | T016 T017 T036 T046 |
| Per-action durability | T008 T009 T026 T049 |
| Freshness ≤100ms | T023 T029 T053 |
| No loss after restart | T009 T020 T027 T051 |
| Inactivity timeout | T013 T043 T054 |

## Risk Mitigation Mapping
- Write amplification: T009 batching, review after perf harness T055
- Latency spikes: early metrics T031 + overlay T041
- Retry storm: T052 validates backoff behavior

## Definition of Done
All acceptance scenarios pass; performance targets captured in `perf-results.md`; metrics validated (T061); privacy scan passes (T065); no unresolved critical TODOs in codebase.

