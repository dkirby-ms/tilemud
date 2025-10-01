
# Implementation Plan: 005-integrate-the-server

**Branch**: `005-integrate-the-server` | **Date**: 2025-10-01 | **Spec**: `./spec.md`
**Input**: Feature specification from `/specs/005-integrate-the-server/spec.md`

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
Integrate the authoritative multiplayer game server into the existing repository and connect the React web client to it with end‑to‑end, test‑driven implementation. Core goals:
1. Establish server authoritative real‑time session (Colyseus) with strict version lockstep (FR-001/FR-002) and freshness window (FR-005; ≤100ms p95).
2. Provide durable per‑action persistence (FR-006) with atomic rollback on partial failure (FR-011) and restart recovery reconstruction from durable logs (FR-012).
3. Implement reconnect flow with exponential full‑jitter backoff and token validation (FR-008/FR-009) while preserving session continuity metrics.
4. Expose consistent typed contracts (messages + REST where needed) validated via zod and contract tests (FR-003/FR-004).
5. Deliver observability: structured redacted logging, metrics enumeration (FR-019 / NFR-008), client diagnostics overlay (FR-018) and performance conformance to NFR-001 (action latency ≤200ms p95) and NFR-002 (initial load ≤3s p95, stretch 2s).
6. Enforce security/privacy constraints (single PLAYER role, no raw credentials in logs, hashed session identifiers) and prepare extension surface for future roles without over‑design.

All NEEDS CLARIFICATION markers in the original spec have been resolved; remaining open items are strategic follow‑ups (not blockers) documented below.

## Technical Context
**Language/Version**: TypeScript 5.x (Node.js 20 LTS backend, React 18 frontend)  
**Primary Dependencies**: Colyseus, Express 5, zod, pg, node-redis, pino, Vite 5, Testing Library  
**Storage**: PostgreSQL (durable state), Redis (ephemeral cache/presence)  
**Testing**: Vitest (unit/contract/integration), Testing Library (web client)  
**Target Platform**: Linux dev/runtime, modern evergreen browsers  
**Project Type**: Web (frontend + backend + shared contracts)  
**Performance Goals**: ≤3s p95 initial load (NFR-002), ≤200ms p95 action latency (NFR-001), freshness ≤100ms p95 (FR-005)  
**Constraints**: Server authoritative, per-action durability pre-ack, strict version lockstep, cache not source of truth  
**Scale/Scope**: Baseline 500 concurrent active sessions / node; stretch 1500 via horizontal room sharding (NFR-005)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.0.0 principles mapping:
- Thin Client / Server Authoritative: Colyseus authoritative room logic; clients send intents only.
- Real-time First & Efficiency: WebSocket diff strategy; latency budgets codified (NFR-001, NFR-002).
- Type-Safe & Testable & Observable: Strict TS, contract tests (T008–T020), diagnostics overlay (T083), metrics (FR-019/NFR-008).

Status: PASS (no deviations). Diagnostics overlay explicitly planned (T083). Any budget regressions will require justification.

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
infrastructure/        # Local dev infra: postgres, redis, scripts, migrations
server/                # Authoritative game + API (Node.js 20 / TypeScript)
   src/
      actions/
      api/
      models/
      rooms/
      services/
      state/
      logging/
   tests/
      unit/
      contract/
      integration/
web-client/            # React 18 client consuming server contracts
   src/
      app/
      features/
      components/
      providers/
      hooks/
      types/
specs/                 # Feature specs, plans, tasks (this feature = 005)
```

**Structure Decision**: Multi-project monorepo (backend `server`, frontend `web-client`, shared contracts via generation script) chosen to enable type-safe cross-layer evolution without premature package splitting. Additional package extraction deferred until measurable duplication or unstable dependency graph emerges.

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

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

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

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Open Questions (Strategic, Non-Blocking)
1. Threat model expansion depth & schedule (baseline privacy/security controls implemented; formal STRIDE review deferred).
2. Availability escalation policy definition (current NFR baseline 99.5% w/ stretch 99.9%; on-call + SLO error budget process to be codified later).
3. Cache eviction tuning (initial Redis TTL heuristics; collect production metrics before adaptive policy change).
4. Localization / i18n strategy (current scope English-only; instrument UI copy enumeration for future extraction pipeline).

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
No deviations from constitution principles at this stage (table intentionally omitted).


## Progress Tracking
**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning approach documented (/plan output)
- [x] Phase 3: Tasks generated (`tasks.md` T001–T083)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved (all removed from spec)
- [x] Complexity deviations documented (none required)

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
