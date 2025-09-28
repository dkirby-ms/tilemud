# Task Plan: Developer Infrastructure: Local Docker Compose for Redis & PostgreSQL

Feature Directory: `/home/saitcho/tilemud/specs/004-developers-require-a`
Related Spec: `spec.md`
Related Plan: `plan.md`
Generated: 2025-09-28

## Execution & Ordering Principles
- TDD first: create failing tests for contracts & readiness before implementation.
- Parallel `[P]` where tasks touch distinct files/areas.
- Deterministic infra readiness (<60s) enforced via helper & healthchecks.
- No scope creep: only Postgres + Redis infra, no CI coupling.

## Legend
- `[P]` → Can be executed in parallel with other `[P]` tasks (no shared file edits)
- `Depends:` → Must follow listed tasks

---
## Tasks

### Foundation & Environment
T001. Create `infra/` directory structure.
- Files: `infra/` (dir)
- Output: empty directory scaffold
- Rationale: Needed for compose + env assets

T002. Create `.env.example` at repo root with documented variables.
- File: `.env.example`
- Contents: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT=5432, REDIS_PORT=6379, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, REDIS_HOST, REDIS_URL
- Add comment disclaimers: dev-only, not for production.
- Depends: T001

T003. Add `infra/docker-compose.yml` defining services `postgres` (image `postgres:18-alpine`) and `redis` (`redis:8.2-alpine`).
- Healthchecks: postgres (`pg_isready -U $POSTGRES_USER`), redis (`redis-cli ping | grep PONG`)
- Ports: `${POSTGRES_PORT:-5432}:5432`, `${REDIS_PORT:-6379}:6379`
- Volume: `postgres_data:/var/lib/postgresql/data`
- Compose version: "3.9"
- Depends: T001, T002

T004. Add `.dockerignore` (optional improvement) with node_modules, dist, coverage, logs.
- File: `.dockerignore`
- Depends: T001
- [P]

### Test-First Contracts & Readiness
T005. Create contract test `server/tests/contract/infra.compose.health.spec.ts`.
- Behavior: fails initially by attempting to assert both services healthy within 60s using shell spawn of `docker compose -f infra/docker-compose.yml ps` + polling.
- Depends: T003

T006. Create integration test `server/tests/integration/infra.migration.spec.ts`.
- Behavior: waits for healthy services then runs placeholder migration command (will fail until script added) expecting exit code 0.
- Depends: T005

T007. Create integration test `server/tests/integration/infra.envOverrides.spec.ts`.
- Scenario: set alternate POSTGRES_PORT/REDIS_PORT (e.g., 55432/56379) via temp `.env` copy; expect compose respects overrides; both services healthy.
- Depends: T005
- [P]

T008. Create integration test `server/tests/integration/infra.persistence.spec.ts`.
- Scenario: start stack, create a test table & insert row, restart Postgres container (`docker compose restart postgres`), verify row persists.
- Depends: T005
- [P]

### Implementation: Infra Orchestration
T009. Implement migration npm script in `server/package.json` (`db:migrate`).
- Command: `node scripts/run-migration.js` (to be created) OR direct `psql` invocation via ts-node script.
- Depends: T006

T010. Add script `server/scripts/run-migration.ts`.
- Loads `.env`, builds psql connection string, executes first migration file `server/migrations/001_initial_schema.sql` (stream to child_process `psql`), exits 0 on success.
- Depends: T009

T011. Add auto-start helper `server/scripts/ensureInfra.ts`.
- Logic:
  1. Check if compose file exists; if not, error with guidance.
  2. Run `docker compose -f infra/docker-compose.yml ps --format json` (if unsupported, parse table output) to detect containers.
  3. If missing/unhealthy: `docker compose -f infra/docker-compose.yml up -d`.
  4. Poll every 2s (max 60s) using health status; on success print summary; on timeout exit non-zero with guidance.
- Depends: T003

T012. Wire helper into test flow by creating `server/tests/setup/infra.ts` that imports & awaits ensureInfra before tests.
- Update vitest config or add per-test import comment to include setup.
- Depends: T011

T013. Update `server/package.json` scripts:
- Add: `infra:up`, `infra:down`, `infra:reset`, `db:migrate` (if not already), `test:all` that runs ensure before vitest.
- Depends: T011, T009

### Test Refinement & Passing State
T014. Update earlier tests (T005-T008) to use helper instead of manual polling if they currently duplicate logic.
- Depends: T012

T015. Implement env override resolution in compose documentation & confirm tests pass; adjust tests if needed for reliability (e.g., increased wait for first startup on slower machines by allowing configurable timeout via env `INFRA_HEALTH_TIMEOUT_MS`).
- Depends: T014
-
T016. Add additional unit test `server/tests/unit/ensureInfra.timeout.spec.ts` simulating failure path (mock child_process) to assert error messaging clarity.
- Depends: T011
- [P]

T017. Add README/Quickstart sync validation script `tools/validate-docs.js` that checks quickstart commands exist in compose & package scripts.
- Depends: T013
- [P]

T018. Update documentation artifacts (`quickstart.md`, `infrastructure.contract.md`) with actual file paths and confirmed migration command syntax; remove any remaining placeholders.
- Depends: T010, T013

T019. Polish: Add troubleshooting section entry about upgrading Postgres/Redis version tags & pinning patch versions if instability arises.
- Depends: T018
- [P]

T020. Cleanup & Lint: run eslint fixes across new files; ensure no TypeScript errors; adjust tsconfig includes for new `server/scripts` if needed.
- Depends: T010, T011

T021. Final verification task: Execute end-to-end sequence (infra up, migration, server start, tests) and record summary in `T070-COMPLETION-SUMMARY.md` appended section referencing each FR mapping.
- Depends: T020, T015, T018

### Parallel Execution Guidance
- Initial parallel window: T004 alongside (after) T002 while T003 is being written.
- After infra tests created (T005), T007 & T008 can run in parallel.
- Post-helper: T016 & T017 & T019 can run in parallel after their dependencies.

### Deferred / Explicitly Out of Scope
- CI pipeline integration
- Production-grade security (password rotation, TLS)
- Automatic schema migration on container start

## Acceptance Checklist Mapping
| FR | Tasks Covering |
|----|----------------|
| FR-001, FR-010 | T003 |
| FR-002, FR-011 | T002, T007, T015 |
| FR-003 | T003 (Redis config) |
| FR-004 | T003 (volume), T008 persistence verification |
| FR-005 | T003 (reset command via docs), T013 (infra:reset script) |
| FR-006 | T018, T019, T017 (validation) |
| FR-007 | T002, T010 migration uses vars |
| FR-008, FR-016 | T003 healthchecks, T005 polling tests, T011 helper, T016 timeout test |
| FR-009 | T002 `.env.example` non-sensitive |
| FR-012 | T009, T010 |
| FR-013 | T003 minimal compose |
| FR-014 | T011, T012, T014 |
| FR-015 | Docs note already (no task needed), reaffirmed in T018 |

## Completion Criteria
- All tasks T001-T021 complete & tests green.
- Contract & quickstart fully aligned with implementation.
- `tasks.md` closed via completion summary referencing FR coverage.

