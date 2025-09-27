# Tasks: Scalable Game Service Backend (003-server)

Conventions:
- [P] = Can be executed in parallel with other [P] tasks (independent files / concerns).
- Sequence enforced where tasks touch the same file or depend on prior artifacts.
- TDD: Contract & unit tests precede implementation.

## Legend
- FR-x reference functional requirement IDs
- ENT-x reference entities from data-model.md
- CONN indicates integration tasks

---

## Task List

### Setup & Scaffolding
T001: Create backend project scaffold in `server/` (package.json, tsconfig, src/, tests/) with TypeScript strict, eslint config aligned to repo standards. (Prereq for all server code.)
T002: Add base dependency set: colyseus, uuid, zod (for validation), pg, pg-pool, redis, prom-client, pino (logging), dotenv. Dev deps: vitest, ts-node, @types/*, supertest. (Depends: T001)
T003: Add npm scripts: `dev:server` (ts-node src/bootstrap/dev.ts), `test`, `lint`, `build` (tsc). (Depends: T002)
T004: Implement shared config loader (env parsing with zod) in `server/src/config/env.ts` including DB/Redis settings. (Depends: T002)

### Data Layer (Models / Repositories)
T005 [P]: Define TypeScript domain interfaces for Player, Guild, GuildMembership, BlockListEntry in `server/src/domain/entities/players.ts` & `guilds.ts`. (FR-006, FR-014)
T006 [P]: Define Instance & Arena entities + enums & state machine constants in `domain/entities/sessions.ts`. (FR-001, FR-002, FR-011, FR-018)
T007 [P]: Define AIEntity and RuleConfigVersion entities in `domain/entities/gameContent.ts`. (FR-004, FR-016)
T008 [P]: Define ChatChannel & ChatMessage entities + retention metadata in `domain/entities/chat.ts`. (FR-007, FR-017)
T009 [P]: Define ReplayMetadata + helper types in `domain/entities/replay.ts`. (FR-017)
T010: Implement Postgres schema migration files (SQL or migration tool placeholder) in `server/migrations/` covering core tables (players, guilds, memberships, instances, arenas, chat_messages, replay_metadata, rule_config_versions). (Depends: T005-T009)
T011: Create repository interfaces + stub implementations `server/src/infra/persistence/*.ts` (PlayersRepo, GuildsRepo, SessionsRepo, ChatRepo, ReplayRepo, RuleConfigRepo). (Depends: T010)

### Redis / Caching / Rate Limiting
T012: Implement Redis client factory `infra/cache/redisClient.ts` with health check. (Depends: T002)
T013: Implement rate limiter service `application/services/rateLimitService.ts` with sliding window logic for chat/actions (FR-012). (Depends: T012)

### Metrics & Logging
✅ T014 [P]: Add metrics registry `infra/monitoring/metrics.ts` (counters: actions_total, chat_messages_total; histograms: tile_tick_duration_ms, ws_latency_ms). (FR-013)
✅ T015 [P]: Add pino logger wrapper `infra/monitoring/logger.ts` with child logger creation. (Cross-cutting)

### Core Application Services
✅ T016: Implement auth ticket issuance service `application/services/authService.ts` validating input token (mock) and producing session ticket (FR-009 handshake). (Depends: T011)
✅ T017: Implement arena catalog service `application/services/arenaCatalogService.ts` computing utilization & capacity tiers (FR-002, FR-011). (Depends: T011)
✅ T018: Implement guild creation service `application/services/guildService.ts` enforcing uniqueness & reservation (FR-006). (Depends: T011)
✅ T019: Implement replay metadata retrieval service `application/services/replayService.ts`. (FR-017) (Depends: T011)
T020: Implement soft-fail detection monitor `application/services/softFailMonitor.ts` for quorum tracking (FR-018). (Depends: T011)
T021: Implement AI elasticity monitor `application/services/aiElasticityMonitor.ts` applying rules from FR-004. (Depends: T011)
T022: Implement chat delivery dispatcher `application/services/chatDispatcher.ts` distinguishing tiered guarantees (FR-007). (Depends: T011, T013)

### WebSocket / Real-time (Colyseus)
T023: Bootstrap Colyseus server in `src/bootstrap/server.ts` binding HTTP + WS, exposing /metrics. (Depends: T003, T014, T015)
T024: Implement arena room handler `src/ws/rooms/ArenaRoom.ts` handling join, heartbeat, place_tile queue, tile_update broadcasting (FR-002, FR-005, FR-011). (Depends: T023, T016, T022, T021)
T025: Implement battle room handler `src/ws/rooms/BattleRoom.ts` with conflict batching logic (FR-001, FR-005, FR-004). (Depends: T024)
T026: Implement guild chat room (optional) or integrate guild chat into dispatcher if not separate—`src/ws/rooms/GuildChatRoom.ts`. (Depends: T022)
T027: Implement presence & heartbeat processing shared module `src/ws/presence/heartbeat.ts` (FR-009). (Depends: T023)

### HTTP Endpoints (REST)
T028: Implement POST /auth/session route `src/api/routes/auth.ts` issuing ticket (FR-009). (Depends: T016, T003)
T029: Implement GET /arenas route `src/api/routes/arenas.ts` (FR-002, FR-011). (Depends: T017, T003)
T030: Implement POST /guilds route `src/api/routes/guilds.ts` (FR-006). (Depends: T018, T003)
T031: Implement GET /replays/:id route `src/api/routes/replays.ts` (FR-017). (Depends: T019, T003)

### Replay & Persistence Jobs
T032: Implement replay writer hook (append events + finalize metadata) `application/services/replayWriter.ts`. (Depends: T024, T025)
T033: Implement replay purge job (cron / interval) `application/jobs/replayPurgeJob.ts`. (Depends: T019)
T034: Implement chat retention purge job `application/jobs/chatRetentionJob.ts`. (Depends: T022)

### Moderation & Social
T035: Implement block list enforcement middleware for incoming chat / direct messages `application/middleware/blockList.ts` (FR-014). (Depends: T011)
T036: Implement administrative moderation commands service `application/services/moderationService.ts` (mute, kick, guild dissolution) (FR-015). (Depends: T011)

### Rule Config & Audit
T037: Implement rule config version loader & audit logger `application/services/ruleConfigService.ts` (FR-016). (Depends: T011)
T038: Integrate rule version stamping into room resolution flows (modify ArenaRoom & BattleRoom). (Depends: T037, T024, T025)

### Tests (Contract / Unit / Integration) – Written Before Implementations Where Possible
T039 [P]: Contract test for POST /auth/session (happy + invalid token) `tests/contract/auth.session.spec.ts`. (FR-009)
T040 [P]: Contract test for GET /arenas `tests/contract/arenas.get.spec.ts`. (FR-002, FR-011)
T041 [P]: Contract test for POST /guilds `tests/contract/guilds.post.spec.ts`. (FR-006)
T042 [P]: Contract test for GET /replays/:id `tests/contract/replays.get.spec.ts`. (FR-017)
T043 [P]: WS integration test for arena join & tile placement batch resolution `tests/integration/arena.tilePlacement.spec.ts`. (FR-002, FR-005)
T044 [P]: WS integration test for reconnect within grace period `tests/integration/reconnect.grace.spec.ts`. (FR-009)
T045 [P]: WS integration test for AI elasticity reduction trigger `tests/integration/ai.elasticity.spec.ts`. (FR-004)
T046 [P]: WS integration test for soft-fail abort path `tests/integration/softfail.abort.spec.ts`. (FR-018)
T047 [P]: Integration test for guild creation + uniqueness reservation `tests/integration/guild.creation.spec.ts`. (FR-006)
T048 [P]: Integration test for chat tiered delivery semantics `tests/integration/chat.delivery.spec.ts`. (FR-007)
T049 [P]: Integration test for replay availability & purge after expire `tests/integration/replay.retention.spec.ts`. (FR-017)
T050 [P]: Unit tests for rate limiter logic `tests/unit/rateLimit.spec.ts`. (FR-012)
T051 [P]: Unit tests for quorum logic (soft-fail monitor) `tests/unit/softFailMonitor.spec.ts`. (FR-018)
T052 [P]: Unit tests for rule config service & stamping `tests/unit/ruleConfigService.spec.ts`. (FR-016)
T053 [P]: Unit tests for chat dispatcher de-dup/idempotency `tests/unit/chatDispatcher.spec.ts`. (FR-007)
T054 [P]: Unit tests for AI elasticity monitor thresholds `tests/unit/aiElasticityMonitor.spec.ts`. (FR-004)
T055 [P]: Unit tests for replay writer sequence integrity `tests/unit/replayWriter.spec.ts`. (FR-017)

### Integration & Wiring
T056: Wire HTTP routes into main express/fastify server (choose framework) `src/api/server.ts`. (Depends: T028-T031)
T057: Implement bootstrap script `src/bootstrap/dev.ts` starting DB/Redis connections, HTTP, Colyseus. (Depends: T023, T028)
T058: Integrate metrics endpoint `/metrics` & health checks `src/api/routes/health.ts`. (Depends: T014, T056)
T059: Add block list middleware integration at chat dispatcher & room joins. (Depends: T035, T024, T025)
T060: Integrate moderation commands (mute/kick) into ArenaRoom & BattleRoom handlers. (Depends: T036, T024, T025)
T061: Integrate replay writer & rule stamping into resolution flows. (Depends: T032, T038)

### Performance & Observability
T062: Add latency histograms wrapping tile resolution & broadcast paths. (Depends: T024, T025, T014)
T063: Add load test scripts placeholder `server/tools/load/` simulating 200 concurrent arena users. (Depends: T023)

### Docs & Quickstart Updates
T064: Update `quickstart.md` with real server run instructions & sample curl + ws client script. (Depends: T056, T057)
T065: Add README section for backend setup `server/README.md`. (Depends: T056)

### Polish & Hardening
T066 [P]: Add input validation (zod) enforcement in all HTTP routes. (Depends: T028-T031)
T067 [P]: Add schema version negotiation test `tests/integration/protocol.version.spec.ts`. (FR-005 evolution readiness)
T068 [P]: Security pass: ensure no secrets in logs & rate limit errors sanitized. (Depends: T015, T028)
T069 [P]: Purge job scheduling & test harness `tests/integration/purge.jobs.spec.ts`. (Depends: T033, T034)
T070: Final audit & cleanup - ensure all FRs map to code + tests matrix document `specs/003-server/traceability.md`.

## Parallelization Guidance
- After T010 completes, T011 + T012 + (T014,T015) can proceed in parallel.
- Contract tests (T039-T042) can run in parallel once basic server scaffold & repos mock layer exist (post T011, T016 minimal stub).
- Entity definition tasks (T005-T009) parallelizable.
- Core room implementations (T024,T025) wait on services (T016-T022).

## Task → Requirement Traceability (Abbrev)
- FR-001: T025, T061
- FR-002: T017, T024, T043
- FR-003: (Mode differentiation via structure) covered by T024/T025/T029
- FR-004: T021, T024, T025, T045, T054
- FR-005: T024, T025, T043
- FR-006: T005, T018, T030, T047
- FR-007: T008, T022, T048, T053
- FR-008: (Persistence outcomes) T032, T061
- FR-009: T016, T027, T044, T028
- FR-010: T017, T024, T025, T029
- FR-011: T017, T024, T029
- FR-012: T013, T050
- FR-013: T014, T062
- FR-014: T035, T059
- FR-015: T036, T060
- FR-016: T037, T038, T061, T052
- FR-017: T009, T019, T032, T049, T055
- FR-018: T020, T046, T051

## Completion Criteria
- All tasks T001–T070 executed or explicitly deferred.
- All contract & integration tests passing.
- Metrics endpoint exposes documented counters/histograms.
- Replay retrieval returns metadata within retention window; purge verified.
- Soft-fail + AI elasticity behaviors validated via tests.

