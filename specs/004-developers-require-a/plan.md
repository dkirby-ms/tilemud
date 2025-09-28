
# Implementation Plan: Developer Infrastructure: Local Docker Compose for Redis & PostgreSQL

**Branch**: `004-developers-require-a` | **Date**: 2025-09-28 | **Spec**: `/home/saitcho/tilemud/specs/004-developers-require-a/spec.md`
**Input**: Feature specification from `/specs/004-developers-require-a/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Provide a single, documented, low-friction way for TileMUD developers to spin up backing services (PostgreSQL + Redis) locally via Docker Compose while running the Node.js game server (`server/`) and React web client (`web-client/`) directly on the host. Compose will define only infrastructure services, persist Postgres data via a named volume, expose configurable host ports (defaults 5432/6379), include healthchecks (interval 5s, timeout 2s, retries 12), and rely on a manual migration step after health becomes healthy. No CI coupling; local test scripts will auto-start infra if absent.

High-level technical approach (from Phase 0 research):
- Use a dedicated compose file (planned path: `infra/docker-compose.yml`) with schema version "3.9".
- Service names: `postgres` (image: `postgres:18-alpine`), `redis` (image: `redis:8.2-alpine`). (Updated to latest production releases: PostgreSQL 18.0 released 2025-09-25; Redis 8.2 current stable.)
- Postgres readiness via `pg_isready -U $POSTGRES_USER`; Redis readiness via `redis-cli ping` returning `PONG`.
- Environment variable substitution from root `.env` (example committed as `.env.example`).
- Named volume: `postgres_data` for persistent storage.
- Manual migration command documented (psql executing SQL in `server/migrations/001_initial_schema.sql`).
- Test auto-start helper (future implementation) will: detect running containers, run `docker compose up -d` if missing, poll health statuses until healthy or timeout.

All clarifications resolved; no remaining blockers for task generation.

## Technical Context
**Language/Version**: TypeScript 5.x (Node 18+), React 18 (web client)  
**Primary Dependencies (feature-relevant)**: Docker & Docker Compose v2, PostgreSQL 15 (alpine), Redis 7 (alpine), Node packages: `pg`, `redis` (already present)  
**Storage**: PostgreSQL (persistent named volume), Redis (ephemeral in-memory)  
**Testing**: Vitest (unit, integration, contract) with future infra auto-start utility  
**Target Platform**: Developer machines (Linux/macOS/WSL2) with Docker Engine; runtime server on host, infra in containers  
**Project Type**: web (backend + frontend)  
**Performance Goals**: Infra startup deterministic < 60s (healthcheck window); minimal developer wait; idempotent restarts  
**Constraints**: No CI dependency; compose file must not auto-run migrations; zero secret leakage; minimal moving parts (no extra orchestration tools)  
**Scale/Scope**: Team-scale local dev (single-user per stack); not production-grade hardening in this feature  

Unknowns/Clarifications: All addressed in spec -> Section "Clarifications" (migration flow, healthcheck policy, port overrides, CI exclusion, auto-start behavior). No remaining NEEDS CLARIFICATION markers.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-checked after Phase 1.*

Constitution (Web Client) Principles Impact:
1. Thin Client, Server-Authoritative → Unaffected (infrastructure only; no client logic added). PASS
2. Real-time First / Efficiency → Indirectly supported (stable local infra reduces flakiness in latency tests). No added payload overhead. PASS
3. Type-Safe, Testable, Observable → Supports test reliability (deterministic readiness). No schema or type regressions. PASS

No violations or complexity deviations introduced. Compose file is additive infrastructure documentation. Proceed.

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
server/
   src/
      bootstrap/
      api/
      application/
      domain/
      infra/
      ws/
   migrations/
   tests/

web-client/
   src/
   tests/

infra/ (planned new directory for compose + env artifacts)
specs/004-developers-require-a/
```

**Structure Decision**: Existing monorepo-style root with discrete `server/` (backend) and `web-client/` (frontend). Feature introduces `infra/` for infrastructure orchestration assets (compose file, environment examples, helper scripts) without changing existing code layout.

## Phase 0: Outline & Research
Completed. See `research.md` for detailed decisions covering:
- Container images & versions (postgres:18-alpine, redis:8.2-alpine)
- Healthcheck commands & timing policy (balanced 5s/2s/12)
- Environment variable strategy & example `.env.example`
- Migration execution command (manual psql invocation)
- Directory & file placement rationale (`infra/docker-compose.yml`)
- Security & credential handling (no real secrets; local-only placeholders)

All clarifications resolved pre-design; no unresolved risks gating Phase 1.

## Phase 1: Design & Contracts
Completed. Artifacts generated:
- `data-model.md`: Defines InfraService (PostgreSQL, Redis) and EnvironmentVariableSet entities + state lifecycle (stopped → starting → healthy → degraded/failure).
- `contracts/infrastructure.contract.md`: Documents developer-facing contract (commands, env vars, health readiness expectations, reset semantics) instead of API endpoints (none added by this feature).
- `quickstart.md`: Step-by-step onboarding (copy env, start infra, verify health, run migrations, run server, run tests, reset).

No API surface added; thus no OpenAPI schema. Contract focuses on operational interface (CLI + environment variables) fulfilling FR-001..FR-016.

Agent context updated via provided script (after initial placeholder; will re-run post-plan if needed once tasks are generated in later phase).

## Phase 2: Task Planning Approach
Will be executed by /tasks command (not performed now).

Task Generation Strategy (preview):
- Create infrastructure directory & files: `infra/docker-compose.yml`, `.env.example` [foundation tasks]
- Add auto-start helper script (e.g., `server/scripts/ensure-infra.ts`) with health polling logic.
- Add npm scripts to `server/package.json`: `infra:up`, `infra:down`, `infra:reset`, `db:migrate`.
- Write contract tests (shell or TS integration) verifying:
   - Healthchecks pass within window
   - Environment variables load correctly
   - Migration command exits 0 after infra healthy
- Integration test updates to auto-start infra if absent.
- Documentation verification task (quickstart steps executed).

Ordering Strategy:
1. Docs & env example
2. Compose file
3. Auto-start helper
4. NPM scripts wiring
5. Contract/integration tests (failing first)
6. Implementation to satisfy tests
7. Reset & resilience tests (port override, restart persistence)

Parallelizable ([P]): compose file + env example; helper script after compose; test authoring after helper stub; docs validation last.

Estimated Output: 15-20 tasks (narrow scope vs generic default count) focusing on infra and developer workflow.

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
No deviations or constitutional violations; table not required.


## Progress Tracking
**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (approach described; tasks not generated)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none)

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
