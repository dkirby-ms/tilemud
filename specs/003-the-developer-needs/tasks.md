# Tasks: Local Developer Data Infrastructure (Redis & PostgreSQL Containers)
Feature Directory: `/home/saitcho/tilemud/specs/003-the-developer-needs`
Branch: `003-the-developer-needs`

Legend:
- [P] = Parallelizable with other [P] tasks (no shared files)
- Outputs must leave repository build & tests runnable after each sequential task
- Follow TDD: write/adjust failing tests before implementing behavior

## Overview
This task list implements Functional Requirements FR-001 – FR-023 using docker compose, bash scripts, and supporting documentation. It is derived from: `plan.md`, `research.md`, `data-model.md`, contracts in `contracts/`, and `quickstart.md`.

## Task Ordering Rationale
1. Repository prep & ignores before generating new artifacts.
2. Contract & integration test scaffolds first (some already created; we refine/expand them).
3. Core infrastructure compose + scripts.
4. Migrations + ledger + env file generation.
5. Verification & reset tooling.
6. Documentation alignment and agent context update.
7. Polish, robustness, and backlog placeholders.

---
## Task List

### Setup & Baseline
T001: Add infrastructure folder & .gitignore entries
- Files: `infrastructure/` root, ensure `.gitignore` has `.env.local.infra` and ledger path (`infrastructure/migrations/state/` if used)
- Actions: Create `infrastructure/` (if not already), add placeholder `README.md` header.
- Dependency: None

T002: Create initial docker-compose.dev.yml (skeleton) (fail tests until scripts use it)
- File: `infrastructure/docker-compose.dev.yml`
- Content: version, services stubs `postgres`, `redis` with image tags only; no volumes/health yet.
- Dependency: T001

T003: Expand integration test coverage for acceptance scenarios [P]
- File: `web-client/tests/integration/infra.baseline.spec.ts` (extend) or add additional `infra.acceptance.spec.ts`
- Add skipped (pending) tests for each Acceptance Scenario (1–8) referencing expected scripts & behaviors.
- Dependency: T001

T004: Add contract test for environment variables [P]
- New File: `web-client/tests/contract/infra.env.contract.spec.ts`
- Validate presence of documented env variable names & defaults once `.env.local.infra` exists (initially skipped).
- Dependency: T001

T005: Add contract test for infra-verify behavior (digest mismatch simulation) [P]
- New File: `web-client/tests/contract/infra.verify.contract.spec.ts`
- Outline test that manipulates a fake digest file to force mismatch (skipped initially).
- Dependency: T001

### Core Compose & Scripts
T006: Implement docker-compose.dev.yml full configuration
- Add network name prefix, container names, Postgres volume, environment vars, healthchecks (`pg_isready`, `redis-cli PING`).
- Dependency: T002

T007: Create `scripts/infra-common.sh` utility module [P]
- File: `infrastructure/scripts/infra-common.sh`
- Provides shared functions: log_info/log_error, check_docker, check_port_free, write_env_file_atomic, hash_file.
- Dependency: T006

T008: Implement `infra-up.sh`
- File: `infrastructure/scripts/infra-up.sh`
- Use functions from infra-common; steps per contract (pre-flight, compose up, wait health, run migrations, generate env file, summary).
- Dependency: T007

T009: Implement `infra-down.sh` [P]
- File: `infrastructure/scripts/infra-down.sh`
- Stop stack (compose down), non-destructive to volume.
- Dependency: T006

T010: Implement `infra-reset.sh`
- File: `infrastructure/scripts/infra-reset.sh`
- Calls down, removes Postgres volume & ledger file/directory.
- Dependency: T009

### Migrations & Ledger
T011: Create migrations directory & initial baseline migration
- Files: `infrastructure/migrations/001_init.sql`
- Simple placeholder (e.g., create extension comment or minimal table if needed) consistent with MigrationLedger.
- Dependency: T008

T012: Implement migration wrapper script
- File: `infrastructure/scripts/migrate.sh`
- Logic: iterate *.sql ascending, compute checksum, maintain `infrastructure/migrations/ledger.json` (or path), apply with `docker compose exec` psql; create readiness marker.
- Dependency: T011

T013: Integrate migration wrapper into infra-up
- Modify `infra-up.sh` to call `migrate.sh` after health but before env file generation.
- Dependency: T012

### Verification & Digest Policy
T014: Add `IMAGE_DIGESTS` file with placeholder digests
- File: `infrastructure/IMAGE_DIGESTS`
- Contains comment with instructions + placeholder lines to be updated by implementer pulling images locally.
- Dependency: T008

T015: Implement `infra-verify.sh`
- File: `infrastructure/scripts/infra-verify.sh`
- Parse IMAGE_DIGESTS, inspect images, compare RepoDigests, exit code spec.
- Dependency: T014

T016: Add optional digest check warning to `infra-up.sh`
- Non-blocking: log if digest mismatch but continue; instruct to run verify script.
- Dependency: T015

### Environment & Transactions Placeholder
T017: Implement `.env.local.infra` generation logic (if not fully covered in T008)
- Ensure atomic write & includes all documented keys.
- Dependency: T013

T018: Add placeholder transactional helper
- File: `infrastructure/scripts/with-tx-placeholder.md` or inside `README.md` section; (since no backend code yet) implement Node stub optional? For now doc only.
- Dependency: T017

### Test Enablement & Refinement
T019: Unskip/enable contract env test once env file logic stable
- Update `infra.env.contract.spec.ts` to run assertions.
- Dependency: T017

T020: Unskip acceptance tests for startup & env generation (Scenarios 1,2,7)
- Ensure tests call scripts and assert exit codes.
- Dependency: T017

T021: Implement acceptance test for reset scenario (Scenario 5)
- Add logic: create dummy table row -> reset -> confirm row gone after re-up.
- Dependency: T017

T022: Implement acceptance test for verify drift (Scenario 8)
- Manipulate IMAGE_DIGESTS to mismatch & expect failure.
- Dependency: T015

T023: Implement acceptance test for port collision (Scenario edge case)
- Bind a dummy server on 5438 before running infra-up expect fail-fast.
- Dependency: T008

T024: Implement acceptance test for migration failure handling
- Introduce a temporary invalid migration file in test, expect non-zero exit with error referencing file.
- Dependency: T012

### Documentation & Agent Context
T025: Update infrastructure README with full usage & link to quickstart
- File: `infrastructure/README.md`
- Summarize scripts, env vars, update workflow.
- Dependency: T015

T026: Sync Quickstart cross-links + add verification and reset examples update
- File: `specs/003-the-developer-needs/quickstart.md`
- Ensure alignment with final script names/flags.
- Dependency: T025

T027: Update `.github/copilot-instructions.md` with new technologies & recent changes entry
- Run update script, then manually insert infra summary between markers.
- Dependency: T026

### Polish & Hardening
T028: Add shellcheck lint task (optional) [P]
- Add `scripts/lint-shell.sh` and CI note (CI adoption deferred but documented).
- Dependency: T027

T029: Add resource baseline check implementation
- File: integrate into `infra-up.sh` using `grep /proc/meminfo`, `df` for disk; produce warnings only (FR-020).
- Dependency: T008

T030: Add log summary formatting improvements (color codes, section headers) [P]
- Non-functional usability, ensure no interactive prompts.
- Dependency: T008

T031: Add update-digests helper script (deferred improvement)
- File: `infrastructure/scripts/update-digests.sh` to pull & rewrite digest file.
- Dependency: T015

T032: Add README section for future transactional layer (FR-017 forward path)
- File: `infrastructure/README.md` append section.
- Dependency: T018

### Final Validation
T033: Run full test suite post-implementation & adjust flakiness
- Ensure all infra tests pass deterministically; tune healthcheck timeouts.
- Dependency: All prior tasks

T034: Final documentation audit & traceability table update
- Validate FR mapping across docs; update `data-model.md` if needed.
- Dependency: T033

T035: Prepare merge artifacts (squash commit message draft)
- Summarize changes, reference spec, highlight scripts and reproducibility features.
- Dependency: T034

---
## Parallelization Guidance
Example initial parallel batch after T006: (T007 [P], T009 [P])
Subsequent parallel opportunities:
- After T008: T014 [P], T018 (doc) can proceed
- Polish tasks T028 [P], T030 [P], T031 (sequential after verify) groupable late

Avoid running tasks that modify the same script simultaneously.

## Task Agent Invocation Examples
```
# Example: Implement infra-up
/spec-task run T008

# Example: Parallel digest + reset script after compose & up
/spec-task run T014 T018
```

## Completion Criteria
- All acceptance scenario tests implemented & passing (except intentionally deferred transactional isolation backend work)
- Verification script enforces digest integrity
- Compose & scripts idempotent across repeated runs
- Documentation aligned (quickstart + infra README + environment variables contract)
- No unresolved FRs or orphaned placeholders (besides documented future enhancements)

---
End of tasks.
