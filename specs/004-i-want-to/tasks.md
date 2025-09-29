# Tasks: Large-Scale Multiplayer Tile Game Backend Service

**Feature Directory**: `/home/saitcho/tilemud/specs/004-i-want-to`  
**Input Docs**: plan.md, research.md, data-model.md, contracts/game-service.yaml, quickstart.md

## Scope & Strategy
TDD-first delivery of a new `server/` backend (Colyseus + Express + PostgreSQL + Redis) providing: battle instance real-time rooms, action ordering, rate limiting, private messaging retention, battle outcome persistence, and minimal REST endpoints (health, outcome retrieval, message retrieval, error catalog) per design artifacts. Real-time gameplay actions occur via Colyseus messages (rooms) and are validated server-side.

## Conventions
Format: `[ID] [P?] Description`  
`[P]` denotes safe parallel execution (different files, no dependency ordering).  
All tests must be written and failing before implementing corresponding functionality.

---
## Phase 3.1: Setup & Project Scaffolding
- [ ] T001 Initialize `server/` package: `server/package.json` (TypeScript, module type=ESM), scripts (`dev`, `build`, `test`), tsconfig, basic folder scaffold (`src/{index.ts,infra/,api/,rooms/,state/,services/,models/,actions/,logging/}`); add `.env.example` with DATABASE_URL, REDIS_URL, PORT, LOG_LEVEL.
- [ ] T002 Add dependencies in `server/package.json`: runtime (colyseus@0.16.x, express@5, zod, pg, redis, pino, uuid), dev (typescript, ts-node-dev, vitest, @types/node, @types/express, supertest, openapi-typescript, eslint, @typescript-eslint/*, tsx). Lock versions.
- [ ] T003 Configure linting & formatting: `server/.eslintrc.cjs`, `server/.eslintignore`, Prettier config (if used) aligning with repo style. Add npm `lint` script.
- [ ] T004 Create initial `server/src/index.ts` bootstrap placeholder (no real logic) exporting async start() (unused yet) + placeholder main auto-start guard.
- [ ] T005 Create `server/src/infra/config.ts` to load env (using simple process.env parsing + zod schema) and export typed config.
- [ ] T006 Setup testing harness: `server/vitest.config.ts`, `server/tests/setup.ts` (global test hooks, test env vars), add npm test script; ensure running `vitest` discovers tests.
- [ ] T007 Create OpenAPI contract build helper: script `server/scripts/generate-openapi-types.sh` using openapi-typescript to emit `server/src/contracts/api-types.d.ts` from feature `contracts/game-service.yaml`.

## Phase 3.2: Tests First (TDD) – Contract & Integration & Core Unit Seeds
### Contract Tests (from OpenAPI endpoints)
- [ ] T008 [P] Contract test Health endpoint: `server/tests/contract/health.get.spec.ts` validates 200 + shape `{status:"ok"}`.
- [ ] T009 [P] Contract test Get Battle Outcome by id: `server/tests/contract/outcomes.id.get.spec.ts` validates 200 schema & 404 case.
- [ ] T010 [P] Contract test List Player Outcomes: `server/tests/contract/players.outcomes.get.spec.ts` validates list shape & limit param.
- [ ] T011 [P] Contract test List Player Messages: `server/tests/contract/players.messages.get.spec.ts` checks filtering (direction, limit) & schema.
- [ ] T012 [P] Contract test Error Catalog: `server/tests/contract/errors.catalog.get.spec.ts` ensures seed codes returned match spec list.

### Integration Tests (from user stories & quickstart flows)
- [ ] T013 [P] Integration test: Create solo instance flow (player creates & joins, receives initial board state) `server/tests/integration/instance.create.solo.spec.ts`.
- [ ] T014 [P] Integration test: Multi-player join & synchronized initial state `server/tests/integration/instance.join.multi.spec.ts`.
- [ ] T015 [P] Integration test: Tile placement broadcast & latency assertion (mock monotonic timestamps) `server/tests/integration/instance.tile.broadcast.spec.ts`.
- [ ] T016 [P] Integration test: Conflict resolution simultaneous placements precedence (initiative ordering) `server/tests/integration/instance.tile.conflict.spec.ts`.
- [ ] T017 [P] Integration test: NPC / scripted event broadcast & ordering with player action `server/tests/integration/instance.npc.ordering.spec.ts`.
- [ ] T018 [P] Integration test: In-battle chat broadcast ordering & rate limiting `server/tests/integration/chat.instance.rate.spec.ts`.
- [ ] T019 [P] Integration test: Private direct message delivery & privacy `server/tests/integration/chat.private.delivery.spec.ts`.
- [ ] T020 [P] Integration test: Reconnect within grace period restores snapshot `server/tests/integration/reconnect.grace.success.spec.ts`.
- [ ] T021 [P] Integration test: Reconnect after grace rejected `server/tests/integration/reconnect.grace.expired.spec.ts`.
- [ ] T022 [P] Integration test: Instance end condition persists outcome `server/tests/integration/instance.end.persistence.spec.ts`.
- [ ] T023 [P] Integration test: Rate limits enforce rejections for chat/private/tile actions `server/tests/integration/rate.limit.enforcement.spec.ts`.
- [ ] T024 [P] Integration test: Unrecoverable instance termination returns correct error `server/tests/integration/instance.termination.error.spec.ts`.

### Core Unit Tests (algorithms & utilities first)
- [ ] T025 [P] Unit test: Ordering comparator (priority tier, type precedence, initiative, timestamp, id) `server/tests/unit/ordering.comparator.spec.ts`.
- [ ] T026 [P] Unit test: Rate limiter logic (chat, private, tile) with Redis mock `server/tests/unit/rate.limiter.spec.ts`.
- [ ] T027 [P] Unit test: Snapshot serializer for reconnect `server/tests/unit/snapshot.serializer.spec.ts`.
- [ ] T028 [P] Unit test: Error code registry shape & immutability `server/tests/unit/error.codes.spec.ts`.
- [ ] T029 [P] Unit test: Action validation (tile bounds, membership, grace expiry) `server/tests/unit/action.validation.spec.ts`.

## Phase 3.3: Core Implementation (after above tests exist & fail)
### Models & Persistence
- [ ] T030 [P] Implement `server/src/models/player.repo.ts` (CRUD minimal: getById, create, listForTest) using pg.
- [ ] T031 [P] Implement `server/src/models/ruleset.repo.ts` (getByVersion, seed bootstrap function).
- [ ] T032 [P] Implement `server/src/models/battleOutcome.repo.ts` (insertOutcome, getById, listByPlayer).
- [ ] T033 [P] Implement `server/src/models/privateMessage.repo.ts` (insertMessage, listByPlayer with direction & since, purgeExpired).
- [ ] T034 [P] Implement static `server/src/models/errorCodes.ts` exporting seed list aligning with spec.

### Services / Infrastructure
- [ ] T035 Implement `server/src/infra/db.ts` Postgres pool wrapper + migrations loader (placeholder migrate function).
- [ ] T036 Implement `server/src/infra/redis.ts` Redis client factory with graceful shutdown.
- [ ] T037 [P] Implement `server/src/services/rateLimiter.ts` (interface evaluate(channel, playerId) returning allow|reject + retryAfter?).
- [ ] T038 [P] Implement `server/src/services/snapshot.ts` snapshot & restore utilities.
- [ ] T039 [P] Implement `server/src/services/errorCatalog.ts` adapter exposing codes as lookup & list.
- [ ] T040 [P] Implement `server/src/services/messageService.ts` (persist + dispatch private messages + permission stub).
- [ ] T041 Implement `server/src/services/outcomeService.ts` (persist outcome from room summary, retrieval helpers).
- [ ] T042 Implement `server/src/services/reconnectService.ts` (track disconnect timestamp in Redis, validate grace, cleanup).

### Real-time Rooms & Actions
- [ ] T043 Create `server/src/state/schema.ts` Colyseus state classes (BattleRoomState, BoardState, PlayerSessionState, NPCState minimal).
- [ ] T044 Implement `server/src/actions/types.ts` action payload type definitions & discriminated unions.
- [ ] T045 Implement `server/src/actions/validation.ts` zod validators for actions referencing state.
- [ ] T046 Implement `server/src/actions/ordering.ts` comparator & per-tick batch sorter (used by room loop).
- [ ] T047 Implement `server/src/rooms/BattleRoom.ts` (onCreate: init state, onJoin, onLeave, onMessage handlers for tile placement, chat message, private message dispatch (calls service), tick loop processing queue & broadcasting updates, end condition detection, outcome persistence, termination handling).
- [ ] T048 Implement `server/src/rooms/LobbyRoom.ts` (optional minimal) to create/join battle instance; or implement direct REST/room creation hybrid if simpler.
- [ ] T049 Implement `server/src/rooms/factories.ts` room registration & bootstrap integration with Colyseus listen.

### HTTP API Endpoints
- [ ] T050 Implement `server/src/api/health.ts` Express router (GET /health).
- [ ] T051 Implement `server/src/api/outcomes.ts` routers (GET /outcomes/:id, GET /players/:playerId/outcomes).
- [ ] T052 Implement `server/src/api/messages.ts` router (GET /players/:playerId/messages).
- [ ] T053 Implement `server/src/api/errors.ts` router (GET /errors/catalog).
- [ ] T054 Wire routers into `server/src/index.ts` (Express app + Colyseus server) with startup & graceful shutdown.

### Logging & Error Handling
- [ ] T055 Implement `server/src/logging/logger.ts` pino factory with level from config.
- [ ] T056 Integrate structured logging into critical events (instance create, end, rate limit reject, conflict reject, termination) inside rooms & services.
- [ ] T057 Implement standardized error response builder mapping internal reasons to JSON schema (E#### fields) + middleware `server/src/api/errorMiddleware.ts`.

## Phase 3.4: Integration & Wiring
- [ ] T058 Connect rate limiter service to Redis keys (production logic) & ensure unit tests updated from mocks.
- [ ] T059 Data seeding script `server/scripts/seed-ruleset.ts` to insert baseline ruleset version if absent.
- [ ] T060 Implement private message purge job script `server/scripts/purge-messages.ts` (delete >30 days) + document cron usage.
- [ ] T061 Add graceful shutdown handling (SIGINT/SIGTERM) closing Redis, PG, Colyseus gracefully in `index.ts`.
- [ ] T062 Add environment validation test `server/tests/contract/env.validation.spec.ts` ensuring required vars present.
- [ ] T063 Add OpenAPI synchronization check test `server/tests/contract/openapi.sync.spec.ts` to ensure runtime schemas align (basic shape checks / error codes count).

## Phase 3.5: Polish & Hardening
- [ ] T064 [P] Add unit tests for `reconnectService` edge timing (boundary at 60s) `server/tests/unit/reconnect.service.spec.ts`.
- [ ] T065 [P] Add unit tests for `messageService` privacy (no leakage) `server/tests/unit/message.service.spec.ts`.
- [ ] T066 [P] Add performance micro-benchmark test for ordering comparator under batch (≥100 actions) `server/tests/unit/ordering.perf.spec.ts`.
- [ ] T067 [P] Add documentation: `server/README.md` with architecture overview & quickstart alignment.
- [ ] T068 Security review pass: ensure no user-controlled data logged (scan logging calls) `server/docs/security-review.md`.
- [ ] T069 Latency measurement harness script `server/scripts/latency-harness.ts` (spawns N virtual clients to measure p95 locally) – optional but targeted.
- [ ] T070 Final quickstart validation checklist automation script `server/scripts/validate-quickstart.ts` to run core flows.
- [ ] T071 Update root feature `quickstart.md` if divergence found during implementation.
- [ ] T072 Final pruning / dead code removal & lint fix (`npm run lint -- --fix`).

## Phase 3.6: Verification & Sign-off
- [ ] T073 Aggregate coverage & ensure critical paths (ordering, rate limiting, reconnect, persistence) covered ≥80% lines in `server/`.
- [ ] T074 Manual exploratory test notes `server/docs/exploratory-notes.md` (edge cases: simultaneous join, disconnect spam, rapid tile spam).
- [ ] T075 Tag release candidate commit & produce change summary appended to `.github/copilot-instructions.md` recent changes.

---
## Dependencies & Ordering Notes
- Setup (T001–T007) precedes all tests.
- All test tasks (T008–T029) must exist and fail before starting implementation tasks T030+.
- Model tasks (T030–T034) unblock services (T035–T042).
- Services + infra (T035–T042) unblock rooms (T043–T049) and API endpoints (T050–T054).
- Logging/error handling (T055–T057) can start after minimal services & rooms exist.
- Integration wiring (T058–T063) requires earlier core pieces.
- Polish (T064–T072) depends on core & integration completion.
- Verification (T073–T075) is final.

## Parallel Execution Guidance Examples
```
# Example 1: After setup complete, run all contract tests scaffolds in parallel
T008 T009 T010 T011 T012

# Example 2: After contract + integration test scaffolds, parallelize unit test scaffolds
T025 T026 T027 T028 T029

# Example 3: Model layer parallelization
T030 T031 T032 T033 T034

# Example 4: Service layer parallelization (post models & infra files)
T037 T038 T039 T040 (while T035, T036, T041, T042 proceed sequentially)
```

## Validation Checklist (Internal)
- All endpoints in `game-service.yaml` have contract tests (T008–T012) ✔
- All persistent entities have model tasks (Player, RuleSetVersion, BattleOutcome, PrivateMessage, ErrorCode stub) ✔ (T030–T034)
- Redis ephemeral entities (RateLimitCounter, ReconnectSession) covered by services & tests (T037, T042, T026, T064) ✔
- Action ordering & validation tests precede implementation (T025, T029) ✔
- Integration tests map to user stories: create, join, broadcast, conflict, NPC, chat, private messaging, reconnect (success/fail), end persistence, rate limits, termination ✔
- Performance & docs tasks included (T066, T067, T069, T070) ✔

## Notes
- Do NOT implement real-time logic before all room & action tests are in place.
- Keep error code list immutable – tests should assert no mutation at runtime.
- Latency harness is advisory; may be adjusted if environment variability too high.

---
**Ready for Phase 3 task execution.**
