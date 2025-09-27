# Tasks: Connect Active Character From Web Client To Game Server Instance

**Input**: Design docs from `/specs/004-users-of-the/`  
**Prerequisites**: `plan.md`, `research.md`, `data-model.md`, `quickstart.md` (OpenAPI contracts to be created in early tasks)

## Execution Flow (reference)
Follows template: Setup → Tests (failing) → Core (models/services) → Endpoints & Protocol → Integration → Polish.

## Phase 3.1: Setup
- [x] T001 Ensure Redis available (or add docker-compose service) and add feature-specific Redis key prefix constant in `server/src/config/env.ts`.
- [x] T002 Add server directory scaffolding: `server/src/application/services/session/`, `queue/`, `rateLimit/` with index placeholder files.
- [x] T003 [P] Add web-client scaffolding: `web-client/src/features/connection/machine/`, `components/`, `hooks/`, `services/` with placeholder exports.
- [x] T004 Update `.github/copilot-instructions.md` active technologies: add Redis usage, WebSocket admission extensions, prom-client metrics (do not remove existing entries).
- [x] T005 Add shared type definitions file `server/src/domain/connection/types.ts` (FailureReason, AttemptOutcome, SessionState enums) exported for tests.

## Phase 3.2: Tests First (TDD) ⚠️ MUST FAIL INITIALLY
### Contract / Protocol Tests
- [x] T006 Create OpenAPI stub `specs/004-users-of-the/contracts/admission.yaml` with POST `/instances/{id}/connect` and response schema (admitted|queued|failed|timeout + reason, position, retryAfterSeconds).
- [x] T007 [P] Contract test admission POST success (capacity available) in `server/tests/contract/admission.success.spec.ts`.
- [x] T008 [P] Contract test admission queued (capacity full) in `server/tests/contract/admission.queued.spec.ts`.
- [x] T009 [P] Contract test queue full response in `server/tests/contract/admission.queueFull.spec.ts`.
- [x] T010 [P] Contract test version mismatch in `server/tests/contract/admission.versionMismatch.spec.ts`.
- [x] T011 [P] Contract test rate limited 429 in `server/tests/contract/admission.rateLimit.spec.ts`.
- [x] T012 [P] Contract test drain mode rejection in `server/tests/contract/admission.drainMode.spec.ts`.
- [x] T013 [P] Contract test replacement prompt flow (attempt indicates replacement needed) in `server/tests/contract/admission.replacementPrompt.spec.ts`.
- [x] T014 [P] Contract test reconnection attempt (token accepted) in `server/tests/contract/admission.reconnect.spec.ts`.

### Integration Tests (User Stories / Quickstart)
- [x] T015 Integration: basic connect → admitted <1s in `server/tests/integration/connect.admitted.spec.ts`.
- [x] T016 [P] Integration: second tab replacement cancel keeps original session in `server/tests/integration/connect.replaceCancel.spec.ts`.
- [x] T017 [P] Integration: replacement accept transfers session in `server/tests/integration/connect.replaceAccept.spec.ts`.
- [x] T018 [P] Integration: queued then promoted path (with synthetic capacity release) in `server/tests/integration/connect.queuedPromotion.spec.ts`.
- [x] T019 [P] Integration: reconnection within 60s grace in `server/tests/integration/connect.reconnectGrace.spec.ts`.
- [x] T020 [P] Integration: reconnection after grace expiry fails in `server/tests/integration/connect.reconnectExpired.spec.ts`.
- [x] T021 [P] Integration: version mismatch scenario in `server/tests/integration/connect.versionMismatch.spec.ts`.
- [x] T022 [P] Integration: rate limit lock after 5 failures in `server/tests/integration/connect.rateLimit.spec.ts`.
- [x] T023 [P] Integration: timeout path (forced delay >10s) in `server/tests/integration/connect.timeout.spec.ts`.
- [x] T024 [P] Integration: drain mode allows queued promotions but rejects new enqueues in `server/tests/integration/connect.drainMode.spec.ts`.
- [x] T025 [P] Integration: queue full immediate rejection in `server/tests/integration/connect.queueFull.spec.ts`.

### Frontend FSM & UI Tests
- [ ] T026 Frontend unit: FSM transitions basic success path in `web-client/tests/unit/connection.fsm.success.spec.ts`.
- [ ] T027 [P] Frontend unit: FSM queued → promotion path in `web-client/tests/unit/connection.fsm.queuePromotion.spec.ts`.
- [ ] T028 [P] Frontend unit: FSM reconnection within grace in `web-client/tests/unit/connection.fsm.reconnect.spec.ts`.
- [ ] T029 [P] Frontend unit: FSM rate limited + countdown in `web-client/tests/unit/connection.fsm.rateLimit.spec.ts`.
- [ ] T030 [P] Frontend unit: FSM timeout path in `web-client/tests/unit/connection.fsm.timeout.spec.ts`.
- [x] T031: Create integration test for frontend status mapping (connect.frontendStatusMapping.spec.ts) ✓

### Phase 3.2a: Additional Coverage Tests (Added Post Analysis)
"These address uncovered FRs (authentication, ownership, maintenance, suspension, atomicity, sanitization, logging, metrics, status UI). All MUST initially fail."
#### Additional Contract Tests
- [x] T071 [P] Contract test unauthenticated rejection (FR-001) in `server/tests/contract/admission.unauthenticated.spec.ts`.
- [x] T072 [P] Contract test no active character selected (FR-002) in `server/tests/contract/admission.noActiveCharacter.spec.ts`.
- [x] T073 [P] Contract test character ownership mismatch (FR-003) in `server/tests/contract/admission.ownership.spec.ts`.
- [x] T074 [P] Contract test maintenance mode rejection (FR-005) in `server/tests/contract/admission.maintenance.spec.ts`.
- [x] T075 [P] Contract test invalid instance id rejection (FR-018) in `server/tests/contract/admission.invalidInstance.spec.ts`.
- [x] T076 [P] Contract test suspended character rejection (FR-014) in `server/tests/contract/admission.suspended.spec.ts`.
- [x] T077 [P] Contract test already-in-session (no replacement path) (FR-004) in `server/tests/contract/admission.alreadyInSession.spec.ts`.

#### Additional Integration Tests
- [ ] T078 Integration graceful disconnect frees slot (FR-009) in `server/tests/integration/connect.gracefulDisconnect.spec.ts`.
- [ ] T079 [P] Integration already-in-session rejection (second connect without replacement) (FR-004) in `server/tests/integration/connect.alreadyInSession.spec.ts`.
- [x] T080: Create integration test for atomic capacity race handling (connect.atomicCapacityRace.spec.ts) ✓
- [x] T081: Create integration test for mid-connection character change (connect.midConnectionCharacterChange.spec.ts) ✓
- [x] T082: Create integration test for drain mode reconnection handling (connect.drainModeReconnection.spec.ts) ✓
- [x] T083: Create integration test for structured logging events (connect.structuredLoggingEvents.spec.ts) ✓
- [x] T084: Create integration test for metrics histogram validation (connect.metricsHistogramValidation.spec.ts) ✓
- [x] T085: Create integration test for performance SLO validation (connect.performanceSLOValidation.spec.ts) ✓
- [x] T086: Create integration test for frontend status mapping (connect.frontendStatusMapping.spec.ts) ✓

## Phase 3.3: Core Implementation (Backend Models/Services)
- [ ] T032 Implement enums & shared types in `server/src/domain/connection/types.ts` (if not done fully in T005) + export.
- [ ] T033 [P] Implement Redis key builder + prefixes in `server/src/infra/persistence/redisKeys.ts`.
- [ ] T034 [P] Implement rate limit repository (sliding window) `server/src/application/services/rateLimit/rateLimitService.ts`.
- [ ] T035 [P] Implement queue repository (sorted set) `server/src/application/services/queue/queueService.ts` with enqueue, position, promote.
- [ ] T036 [P] Implement session service `server/src/application/services/session/sessionService.ts` (admit, replace, enterGrace, finalize, reconnect).
- [ ] T037 Admission atomic Lua script in `server/src/application/services/session/admission.lua` (capacity, active check, enqueue decision) + loader.
- [ ] T038 Implement janitor job (cleanup grace expiry, stale sessions) `server/src/application/jobs/sessionJanitor.ts`.

## Phase 3.4: Backend Endpoints & WebSocket Integration
- [ ] T039 POST /instances/:id/connect route `server/src/api/routes/admission.ts` (handles: version check, rate limit, active session, drain/queue logic, 10s outcome timer, returns structured response).
- [ ] T040 [P] GET /instances/:id/queue/status route `server/src/api/routes/queueStatus.ts`.
- [ ] T041 [P] Integrate reconnection token handling into WebSocket handshake `server/src/ws/presence/reconnectHandler.ts`.
- [ ] T042 [P] Implement replacement confirmation param handling in admission route (replaceToken semantics).
- [ ] T043 [P] Metrics instrumentation (prom-client counters, histograms) `server/src/infra/monitoring/metricsConnection.ts`.
- [ ] T044 [P] Structured event logging integration `server/src/infra/monitoring/connectionEvents.ts`.
- [ ] T045 Rate limit failure path returns 429 with retryAfterSeconds header.
- [ ] T046 Drain mode flag integration (config/env + route behavior) `server/src/config/env.ts` & admission logic.

## Phase 3.5: Frontend Implementation
- [ ] T047 Implement connection state enums & types `web-client/src/features/connection/machine/types.ts`.
- [ ] T048 [P] Implement pure reducer / FSM logic `web-client/src/features/connection/machine/reducer.ts`.
- [ ] T049 [P] Implement hook `useConnection` orchestrating timers, queue polling, reconnection token usage.
- [ ] T050 [P] Implement replacement prompt component `web-client/src/features/connection/components/ReplacementPrompt.tsx`.
- [ ] T051 [P] Implement status indicator component `web-client/src/features/connection/components/ConnectionStatus.tsx`.
- [ ] T052 [P] Implement connection service adapter (HTTP + WebSocket) `web-client/src/features/connection/services/connectionAdapter.ts`.
- [ ] T053 UI integration wiring (add provider / root integration) `web-client/src/app/ConnectionProvider.tsx` & update `App.tsx`.
- [ ] T054 Queue position polling logic (every 5s) integrated into hook.
- [ ] T055 Reconnection token persistence (in-memory + optional sessionStorage fallback) in adapter.

## Phase 3.6: Cross-Cutting & Integration Polish
- [ ] T056 Implement admission timeout guard (10s) server-side + ensure cancellation on completion.
- [ ] T057 [P] Add unit tests for queue service `server/tests/unit/queueService.spec.ts`.
- [ ] T058 [P] Add unit tests for rate limit service `server/tests/unit/rateLimitService.spec.ts`.
- [ ] T059 [P] Add unit tests for session service `server/tests/unit/sessionService.spec.ts`.
- [ ] T060 [P] Add unit tests for frontend reducer `web-client/tests/unit/connection.reducer.spec.ts`.
- [ ] T061 Add integration test for metrics exposure `server/tests/integration/metrics.connection.spec.ts`.
- [ ] T062 Add integration test for drain mode promotions `server/tests/integration/drainMode.promotions.spec.ts`.
- [ ] T063 Add performance smoke (admit 100 sequential attempts) `server/tests/integration/perf.admission.spec.ts`.

## Phase 3.7: Documentation & Finalization
- [ ] T064 Update Quickstart with any endpoint path adjustments `specs/004-users-of-the/quickstart.md`.
- [ ] T065 Add OpenAPI refinement (detailed schemas, FailureReason enum) `specs/004-users-of-the/contracts/admission.yaml`.
- [ ] T066 [P] Add README section in root or feature folder summarizing session & queue architecture `specs/004-users-of-the/architecture-notes.md`.
- [ ] T067 [P] Update `.github/copilot-instructions.md` recent changes list for this feature.
- [ ] T068 Add CHANGELOG entry (if project uses one) else skip with note.
- [ ] T069 Final verification script: run all tests + lint (add helper script) `scripts/verify-004-users-of-the.sh`.
- [ ] T070 Prepare PR checklist mapping FR-001..FR-022 to implementation & tests `specs/004-users-of-the/traceability.md`.

## Dependencies Summary
- T001–T005 before any tests referencing types.
- Contract tests (T006–T014) precede admission & queue implementation (T032+).
- Integration tests (T015–T025) rely on scaffolding but should fail until core services implemented (T032–T038, T039+).
- Frontend FSM tests (T026–T031) precede frontend implementation (T047+).
- Redis key builder (T033) and services (T034–T036) required before endpoints (T039+).
- Lua script (T037) required by admission route (T039) & queue promotions.
- Metrics/events (T043–T044) after basic admission route exists or concurrently if stubbed.
- Polish unit tests (T057–T060) after respective implementations.
 - Additional contract tests (T071–T077) follow same ordering rules as T006–T014 (must fail pre-implementation).
 - Additional integration tests (T078–T086) must fail until corresponding features implemented; some depend on janitor job (T038) and metrics (T043–T044).

## Parallel Execution Guidance
Example batch parallellizable early (after T001–T006):
```
T007 T008 T009 T010 T011 T012 T013 T014
```
Backend service core parallel set (after types in place):
```
T033 T034 T035 T036
```
Frontend FSM implementation parallel set (after types):
```
T048 T049 T050 T051 T052
```

## Validation Checklist
- [ ] All FailureReason codes represented in tests.
- [ ] 10s timeout path covered (T023, T056).
- [ ] Reconnection grace success & expiry covered (T019, T020).
- [ ] Queue full, drain mode, replacement flows covered (T009, T012, T017, T016).
- [ ] Metrics & logging instrumentation tested (T061).
- [ ] Traceability file created (T070) mapping FRs.
 - [ ] Added coverage: auth, no-active-character, ownership, suspended, maintenance, invalid instance, already-in-session rejection (T071–T077).
 - [ ] Added coverage: graceful disconnect, atomic race, mid-character change, drain reconnection, logging events, metrics histogram, latency SLO, status UI mapping (T078–T086).

## Notes
- Marked [P] tasks are independent by file path; avoid editing same file concurrently.
- Ensure all tests initially fail (commit) before implementing services/endpoints.
- Decide numeric queue wait p95 SLA after gathering baseline metrics (could be follow-up task outside this scope).
