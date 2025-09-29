
# Implementation Plan: Local Developer Data Infrastructure (Redis & PostgreSQL Containers)

**Branch**: `003-the-developer-needs` | **Date**: 2025-09-28 | **Spec**: `/specs/003-the-developer-needs/spec.md`
**Input**: Feature specification from `/specs/003-the-developer-needs/spec.md`

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
Provide a reproducible, single-step local developer data infrastructure consisting of pinned PostgreSQL (`postgres:18.0-alpine`) with a persistent named volume and ephemeral Redis (`redis:8.2-alpine`) containers. Startup auto-applies idempotent migrations, exposes clearly documented connection details, enforces naming/port collision handling, and supplies verification/reset tooling. No seed data; CI adoption deferred. Redis is intentionally unauthenticated and isolated to a project network. Verification script ensures image drift is detected. Baseline resource checks warn (not fail) if below thresholds.

## Technical Context
**Language/Version**: TypeScript 5.x (tooling/scripts), shell (bash) for infra scripts  
**Primary Dependencies**: Docker Engine / Docker Desktop, docker compose (v2 syntax), (future) migration tool TBD (placeholder: simple SQL bootstrap or lightweight migration runner)  
**Storage**: PostgreSQL 18 (persistent named volume), Redis 8 (ephemeral in-memory)  
**Testing**: Vitest + Testing Library (existing), contract/integration/unit suites depend on infra availability  
**Target Platform**: Developer machines: Linux (native), macOS (Docker Desktop), Windows via WSL2 (best-effort)  
**Project Type**: Single web client repository adding local infra support (no backend code present yet)  
**Constraints**: Min resources: ≥1 CPU free, ≥512MB RAM free, ≥500MB disk for Postgres volume; ports configurable; no interactive prompts  
**Scale/Scope**: Local single-developer instances; no multi-tenant scaling required; supports concurrent dev server + test runner usage

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution principles (summarized from project agent context / guidelines):
- Simplicity first: avoid premature abstraction
- Reproducibility & determinism: pin versions, idempotent operations
- Clear separation of spec vs implementation
- Fast feedback: fail-fast on misconfiguration
- Minimal surface: only implement scope required by FRs

Assessment (Initial):
- Version pinning: Compliant (explicit tag use)  
- Avoiding over-engineering: Using plain docker compose + small helper scripts (no orchestration framework) → OK  
- Deterministic startup: Idempotent migration + verification script → OK  
- Scope restraint: CI integration & seed data deferred → OK  
- Security proportionality: Redis unauth local-only documented → OK  

No constitutional violations requiring Complexity Tracking at this stage.

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
web-client/
   src/
      features/
      tests/ (contract, integration, unit)
infrastructure/ (NEW)
   docker-compose.dev.yml
   scripts/
      infra-up.sh
      infra-down.sh
      infra-reset.sh
      infra-verify.sh
   migrations/ (placeholder or future addition)
   README.md (quickstart excerpt / deep dive)
```

Supporting docs remain under `specs/003-the-developer-needs/`.

**Structure Decision**: Single-project repository (front-end + local infra tooling). Introduce `infrastructure/` folder for isolation of compose file(s), scripts, and (future) migration assets. No backend service subtree yet—plan keeps migration logic minimal (shell invoking psql with SQL files or future tool) to avoid premature backend scaffolding.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

Target Unknowns / Research Items:
1. Migration approach minimal viable choice (pure SQL vs lightweight migration tool) consistent with front-end-only repo.
2. Best pattern to expose connection details (dotenv file generation vs README only) while avoiding secret sprawl.
3. Reliable readiness check strategy (pg_isready vs health query; Redis PING) within compose healthcheck vs external script.
4. Port collision detection & messaging best practices for DX.
5. Image digest pinning workflow (when & how to update, tooling for verifying digest drift).
6. Transactional test isolation pattern in absence of backend code (document future integration vs immediate no-op placeholder).

Research Method:
- Survey official Postgres & Redis image documentation (healthchecks, environment vars)
- Evaluate minimal migration strategies: Option A (psql apply *.sql in order), Option B (node-based migration lib added devDependency), Option C (defer migrations until a backend emerges). Favor Option A for simplicity.
- Draft verification script steps and confirm digest retrieval pattern (`docker image inspect`).

Acceptance for Phase 0 completion: Each item above documented with Decision, Rationale, Alternatives in `research.md` and no remaining NEEDS CLARIFICATION markers in spec (already satisfied except platform support now resolved by FR-021 in spec—document that).

**Output**: research.md with all listed unknowns resolved (decisions recorded).

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

Adaptation: This feature does not expose runtime API endpoints—“contracts” here reinterpret as operational interface (commands & scripts) and environment variables.

1. Data Model (`data-model.md`): Define conceptual entities:
   - Infrastructure Environment (fields: networkName, pgContainerName, redisContainerName, pgVolumeName, imageTags, digestPins?)
   - Connection Descriptor (dbHost, dbPort, dbName, dbUser, dbPassword, redisHost, redisPort)
   - Migration Record (appliedVersions list; placeholder since no backend tracking table yet)
   - Resource Baseline Check (cpu, ramMB, diskMB, pass/warn)

2. Operational Contracts (`/contracts/`):
   - Command spec markdown files (e.g., `infra-up.md`, `infra-down.md`, `infra-reset.md`, `infra-verify.md`): inputs (env vars), expected behavior, exit codes.
   - Environment variable contract file enumerating: TILEMUD_PG_PORT (default 5438?), TILEMUD_REDIS_PORT (default 6380?), TILEMUD_PG_USER, TILEMUD_PG_PASSWORD, TILEMUD_PG_DB, TILEMUD_INFRA_NETWORK, TILEMUD_PG_VOLUME, TILEMUD_PG_IMAGE, TILEMUD_REDIS_IMAGE.

3. Contract Tests: Translate Acceptance Scenarios 1–8 into (initially failing) integration tests under `web-client/tests/integration/infra.*.spec.ts` (or grouped single file) that assume scripts/compose exist. These will fail until implementation delivered.

4. Quickstart: Provide step-by-step usage in `quickstart.md` (prereqs, one-liner startup, verify, run tests, reset, update images workflow).

5. Agent Context Update: Run update script after Phase 1 to include new infrastructure folder & commands.

**Output**: data-model.md, contracts/*.md operational specs, new failing integration tests referencing scripts, quickstart.md, updated `.github/copilot-instructions.md` (agent context).

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P] 
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation 
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 20-28 numbered tasks (slightly fewer due to absence of backend API endpoints).

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
