# Tasks: Integrate Server, Web Client, and Backing Data Layers

**Feature Directory**: `/home/saitcho/tilemud/specs/005-integrate-the-server`
**Input Docs**: `plan.md` (required), `research.md`, `data-model.md`, `quickstart.md`, `contracts/README.md`
**Tech Stack**: TypeScript 5.x, Node.js 20 (Colyseus, Express, zod, pg, node-redis, pino), React 18 + Vite, Vitest, PostgreSQL, Redis

## Generation Basis
- Entities (data-model.md): PlayerSession, CharacterProfile, ActionEvent, ReconnectToken, MetricsSnapshot (conceptual)
- REST Endpoints (contracts): /api/session/bootstrap (POST), /api/health (GET), /api/version (GET)
- Real-time Message Intents: intent.move, intent.chat, intent.action
- Real-time Events: event.state_delta, event.ack, event.error, event.degraded, event.version_mismatch
- Quickstart Scenarios: connect, movement latency, reconnect, version mismatch, Redis degraded, DB unavailable, inactivity timeout

## Conventions
- Server code: `server/src/...`
- Server tests: `server/tests/...`
- Client code: `web-client/src/...`
- Client tests: `web-client/tests/...`
- Generated shared contracts (server authoritative source): `server/src/contracts/` (then consumed in client via build or script)
- [P] indicates task can be executed in parallel with other [P] tasks (distinct files & no unmet dependencies)

## Phase 3.1: Setup & Baseline Infrastructure
- [X] T001 Ensure infra scripts running: verify PostgreSQL + Redis availability (`./infrastructure/scripts/infra-verify.sh`) and create failing placeholder if not (no code change) (dependency: none)
- [X] T002 Add server contract generation directory scaffold `server/src/contracts/` (index.ts + README placeholder) (blocks contract type exports)
- [X] T003 Configure version lock constant & export in `server/src/infra/version.ts` and stub client consumption in `web-client/src/app/version.ts` (blocks version tests)
- [X] T004 [P] Add pino logger initialization file `server/src/logging/logger.ts` with structured base fields (blocks logging usage)
- [X] T005 [P] Add Redis client bootstrap `server/src/infra/redis.ts` (lazy connection + health check fn) (blocks degraded state tests)
- [X] T006 [P] Add PostgreSQL pool bootstrap `server/src/infra/db.ts` (pg.Pool + simple health query) (blocks durability tests)
- [X] T007 Add metrics instrumentation scaffold `server/src/infra/metrics.ts` exporting counters/histogram placeholders (blocks metrics tests)

## Phase 3.2: Tests First (TDD) – Contract & Integration Tests
(Write tests to fail initially.)
### REST Contract Tests
- [X] T008 [FR-001][FR-002][P] Contract test POST /api/session/bootstrap in `server/tests/contract/session/bootstrap.post.spec.ts` (valid token returns state+version)
- [X] T009 [FR-012][P] Contract test GET /api/health in `server/tests/contract/health/get.spec.ts` (reports db+redis+version fields)
- [X] T010 [FR-009][P] Contract test GET /api/version in `server/tests/contract/version/get.spec.ts` (returns semantic version string)
### Real-time Contract Tests
- [X] T011 [FR-002][FR-003][P] Contract test real-time handshake & join in `server/tests/contract/realtime/handshake.spec.ts` (ack & initial state delta)
- [X] T012 [FR-018][FR-010][P] Contract test intent.move validation & seq monotonic in `server/tests/contract/realtime/intent.move.spec.ts`
- [X] T013 [FR-015][FR-020][P] Contract test intent.chat rate limit rejection in `server/tests/contract/realtime/intent.chat.ratelimit.spec.ts`
- [X] T014 [FR-004][FR-010][P] Contract test intent.action generic dispatch & ack durability pre-ack in `server/tests/contract/realtime/intent.action.spec.ts`
- [X] T015 [FR-009][P] Contract test version mismatch disconnect in `server/tests/contract/realtime/version-mismatch.spec.ts`
	- [X] T084 [FR-007][P] Contract test idempotent duplicate action replay (same sequence) ignored / not duplicated in `server/tests/contract/realtime/idempotent-replay.spec.ts`
### Data Model / Persistence Contract Tests
- [X] T016 [FR-004][P] Model test CharacterProfile persistence + updated_at concurrency in `server/tests/contract/models/character-profile.spec.ts`
- [X] T017 [FR-004][FR-011][P] Model test ActionEvent write-before-ack guarantee in `server/tests/contract/models/action-event-durability.spec.ts`
### Integration (User Story) Tests (Quickstart Derived)
- [X] T018 [FR-001][FR-002][FR-003][P] Integration test full connect flow in `server/tests/integration/connect-flow.spec.ts` (CONNECTING→ACTIVE)
- [X] T019 [FR-003][NFR-001][P] Integration test movement latency instrumentation in `server/tests/integration/movement-latency.spec.ts`
- [X] T020 [FR-008][FR-007][NFR-004][P] Integration test reconnect sequence recovery in `server/tests/integration/reconnect-sequence.spec.ts`
- [X] T021 [FR-006][FR-015][P] Integration test Redis degraded state surface in `server/tests/integration/redis-degraded.spec.ts`
- [X] T022 [FR-015][FR-012][P] Integration test DB outage UNAVAILABLE handling in `server/tests/integration/db-unavailable.spec.ts`
- [X] T023 [FR-017][P] Integration test inactivity timeout termination in `server/tests/integration/inactivity-timeout.spec.ts`
- [X] T024 [FR-009][FR-015][P] Integration test version mismatch UPDATE_REQUIRED UX in `web-client/tests/integration/version-mismatch.spec.ts`
- [X] T025 [FR-008][FR-007][P] Integration test client reconnect UI state transitions in `web-client/tests/integration/reconnect-ui.spec.ts`
### Frontend Contract/UI State Tests
- [X] T026 [FR-008][FR-015][P] Client state store test for session status transitions in `web-client/tests/contract/session-store.spec.ts`
- [X] T027 [FR-003][FR-005][P] Client reducer test for applying event.state_delta in `web-client/tests/contract/state-delta.reducer.spec.ts`

### Performance & Freshness Tests (Added for Critical Coverage Gaps)
- [X] T074 [FR-002][NFR-002][P] Initial load performance test measuring cold start client load p95 ≤3s in `web-client/tests/integration/initial-load-performance.spec.ts`
- [X] T075 [FR-005][NFR-001][P] Freshness window enforcement test simulating stale cache (>100ms) triggering forced refresh in `server/tests/integration/freshness-window.spec.ts`
	- [X] T085 [NFR-003][FR-019][P] Synthetic availability SLO test simulating mixed success/failure action stream to assert computed availability ≥99.5% and alert trigger on breach in `server/tests/integration/availability-slo.spec.ts`

### Additional Coverage Tests (High Severity Gaps)
- [X] T076 [FR-011][P] Atomic multi-step rollback test inducing partial failure and asserting ACTION_ATOMIC_ROLLBACK in `server/tests/contract/atomic-action-rollback.spec.ts`
- [X] T077 [FR-013][NFR-006][P] Authorization isolation test ensuring cross-user access denied with FORBIDDEN in `server/tests/contract/authorization-isolation.spec.ts`
- [X] T078 [FR-016][NFR-004][P] Restart recovery persistence test simulating server restart + reconnect without acknowledged action loss in `server/tests/integration/restart-recovery.spec.ts`
- [X] T079 [FR-020][P] Error contract schema test validating canonical error shape & categories in `server/tests/contract/error-contract.spec.ts`
- [X] T080 [FR-001][FR-015][P] Capacity + invalid token UX test covering capacity denial & token rejection messaging in `server/tests/integration/capacity-auth-failures.spec.ts`
- [X] T081 [FR-019][NFR-008][P] Metrics threshold detection test asserting alert conditions are triggered under simulated failure ratios in `server/tests/integration/metrics-threshold.spec.ts`
- [X] T082 [FR-014][NFR-007][P] Log redaction verification test scanning emitted logs for prohibited fields in `server/tests/integration/log-redaction.spec.ts`
- [X] T083 [NFR-008][NFR-001][P] Client diagnostics overlay test verifying latency + reconnect indicators visible in dev build `web-client/tests/contract/client-diagnostics.spec.ts`
- [X] T086 [FR-005][FR-006][P] Cache warm-up race consistency test ensuring no mixed-era state exposure under concurrent cold reads in `server/tests/integration/cache-warmup-race.spec.ts`
- [X] T087 [FR-009][FR-015][P] Mid-session version deprecation test forcing version bump → client disconnect & update-required messaging in `server/tests/integration/mid-session-version-deprecation.spec.ts`
- [X] T088 [FR-014][NFR-007][P] Log retention configuration test verifying 30-day retention / rotation policy (simulated config inspection) in `server/tests/integration/log-retention.spec.ts`

## Phase 3.3: Core Models & Schemas (Implement after corresponding tests failing)
+ [X] T028 [P] Implement CharacterProfile model + repository in `server/src/models/characterProfile.ts`
+ [X] T029 [P] Implement ActionEvent model + append function in `server/src/models/actionEvent.ts`
+ [X] T030 [P] Implement PlayerSession runtime tracker in `server/src/models/playerSession.ts`
+ [X] T031 [P] Implement ReconnectToken ephemeral structure in `server/src/models/reconnectToken.ts`
+ [X] T032 Define zod schemas for real-time intents/events in `server/src/contracts/realtimeSchemas.ts` (exports types to client build)
+ [X] T033 Define REST contract zod schemas in `server/src/contracts/restSchemas.ts` (session bootstrap, health, version)

## Phase 3.4: Services & Infrastructure Logic
- [X] T034 Implement session bootstrap service `server/src/services/sessionBootstrapService.ts` (token validate stub + initial snapshot)
- [X] T035 Implement version service `server/src/services/versionService.ts` (reads constant, provides comparison helpers)
- [X] T036 Implement movement/action sequencing service `server/src/services/actionSequenceService.ts`
- [X] T037 Implement action durability pipeline `server/src/services/actionDurabilityService.ts` (persist-before-ack logic)
- [X] T038 Implement reconnect flow service `server/src/services/reconnectService.ts` (delta vs snapshot selection)
- [X] T039 Implement metrics emission wrappers in `server/src/services/metricsService.ts`
- [X] T040 Implement degraded state detection (Redis health to broadcast) in `server/src/services/degradedSignalService.ts`

## Phase 3.5: Endpoints & Real-time Room Implementation
- [X] T041 Implement POST /api/session/bootstrap Express handler `server/src/api/sessionBootstrap.ts`
- [X] T042 Implement GET /api/health Express handler `server/src/api/health.ts`
- [X] T043 Implement GET /api/version Express handler `server/src/api/version.ts`
- [X] T044 Implement Colyseus room for player sessions `server/src/rooms/GameRoom.ts` (handshake, join, broadcast deltas)
- [X] T045 Implement real-time intent handlers (move/chat/action) in `server/src/actions/intentHandlers.ts`
- [ ] T046 Integrate durability + sequencing in room pipeline `server/src/rooms/GameRoom.ts` (persist before ack)
- [ ] T047 Implement version mismatch disconnect logic `server/src/rooms/versionMismatchGuard.ts`
- [ ] T048 Implement inactivity timeout watchdog `server/src/services/inactivityTimeoutService.ts`
- [ ] T049 Implement Redis degraded event broadcast hook in `server/src/rooms/degradedEmitter.ts`

## Phase 3.6: Frontend Integration
- [ ] T050 Implement session store (status, sequence) in `web-client/src/features/session/sessionStore.ts`
- [ ] T051 Implement WebSocket/Colyseus client connector in `web-client/src/features/session/colyseusClient.ts`
- [ ] T052 Implement version mismatch UI handling component in `web-client/src/components/VersionMismatchBanner.tsx`
- [ ] T053 Implement reconnect / degraded state overlays in `web-client/src/components/ConnectionStatusOverlay.tsx`
- [ ] T054 Implement state delta reducer & application logic in `web-client/src/features/state/stateReducer.ts`
- [ ] T055 Wire movement input dispatch (intent.move) in `web-client/src/features/movement/movementController.ts`
- [ ] T056 Wire chat input dispatch (intent.chat) in `web-client/src/features/chat/chatController.ts`

## Phase 3.7: Integration Wiring & Cross-Cutting Concerns
- [ ] T057 Wire metrics emission where instrumentation points exist (connect, action ack) in existing service & room files
- [ ] T058 Add structured logging (pino) to session bootstrap, reconnect, action durability flows
- [ ] T059 Add rate limiting enforcement for chat/movement in `server/src/actions/intentHandlers.ts`
- [ ] T060 Add Redis health polling + degraded state broadcast scheduler `server/src/infra/redisHealthPoller.ts`
- [ ] T061 Add DB outage detection pause acknowledgments logic `server/src/services/dbOutageGuard.ts`
- [ ] T062 Implement sequence gap detection → full snapshot path in `server/src/services/actionSequenceService.ts`

## Phase 3.8: Polish & Hardening
- [ ] T063 [P] Add unit tests for metrics service in `server/tests/unit/metricsService.spec.ts`
- [ ] T064 [P] Add unit tests for action sequencing edge cases in `server/tests/unit/actionSequenceService.spec.ts`
- [ ] T065 [P] Add unit tests for reconnect service in `server/tests/unit/reconnectService.spec.ts`
- [ ] T066 [P] Add unit tests for state delta reducer in `web-client/tests/unit/stateReducer.spec.ts`
- [ ] T067 Performance test harness for 500 concurrent simulated sessions in `server/tests/integration/load/500-concurrency.spec.ts`
- [ ] T068 Latency budget verification test (≤200ms p95) instrumentation check in `server/tests/integration/perf/latency-budget.spec.ts`
- [ ] T069 [P] Documentation: update `specs/005-integrate-the-server/quickstart.md` with any new commands & add `docs/integration-metrics.md`
- [ ] T070 [P] Documentation: add architectural overview `docs/architecture/realtime-integration.md`
- [ ] T071 [P] Clean up TODO/FIXME markers and ensure strict TS config passes
- [ ] T072 Security/PII audit check script in `server/scripts/audit-logging-redaction.ts`
- [ ] T073 Final pass: remove unused experimental code & ensure bundle size unchanged beyond acceptable delta

## Dependencies Summary
- Setup (T001–T007) precedes all tests.
- Contract & integration tests (T008–T027, T084, T085, T086, T087, T088) must exist & fail before implementing related models/services/endpoints.
- Models (T028–T033) required before services using them (T034–T040).
- Services before endpoints/room logic (T041–T049) except where explicitly same file (room file sequential tasks: T044 then T046).
- Frontend integration (T050–T056) depends on contract schemas & version constant.
- Wiring tasks (T057–T062) depend on core implementations present.
- Polish (T063–T073) after all prior phases green.

## Parallel Execution Guidance
Example batch 1 (after setup done):
```
T008 T009 T010 T011 T012 T013 T014 T015 T084 (independent contract tests)
```
Example batch 2:
```
T016 T017 T018 T019 T020 T021 T022 T023 T024 T025 T026 T027 T074 T075 T076 T077 T078 T079 T080 T081 T082 T083 T085 T086 T087 T088
```
Example batch 3 (core models parallel):
```
T028 T029 T030 T031 T032 T033
```
Example batch 4 (services parallel where independent I/O logic):
```
T034 T035 T036 T037 T038 T039 T040
```
Example batch 5 (frontend parallel):
```
T050 T051 T052 T053 T054 T055 T056
```
Example batch 6 (polish unit tests & docs):
```
T063 T064 T065 T066 T069 T070 T071
```

## Validation Checklist (Must hold true before execution continues)
- [ ] Every listed REST/real-time contract has a failing test before implementation
- [ ] Each entity has a model task
- [ ] Tests precede implementation for all features
- [ ] [P] tasks never share the same target file
- [ ] All critical NFRs (latency, durability, freshness, availability, security, observability) have explicit test tasks (T019, T017, T068, T074, T075, T085, T078, T077, T081)
- [ ] Observability tasks present (T057–T060, T063)
- [ ] Security/PII audit task present (T072)

## Notes
- Keep commits atomic: one task per commit.
- If a task spawns new files not anticipated, append follow-up tasks before proceeding.
- Performance tests (T067, T068) may initially be skipped in CI if runtime heavy—mark TODO but keep code present.
- Action durability is critical path; do not reorder T037 before T029.

