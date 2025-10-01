
# Implementation Plan: Large-Scale Multiplayer Tile Game Backend Service

**Branch**: `004-i-want-to` | **Date**: 2025-09-29 | **Spec**: `/home/saitcho/tilemud/specs/004-i-want-to/spec.md`
**Input**: Feature specification from `/specs/004-i-want-to/spec.md`

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
Provide a server-authoritative real-time backend that hosts isolated battle instances (≤32 players each) for a tile placement game, delivering deterministic state mutation ordering, low-latency propagation (≤150ms p95) of tile placements and chat, private direct messaging (30‑day retention), reconnection grace (60s), and basic persistence of battle outcomes and audit logs. Technical approach: Node.js (TypeScript) Colyseus v0.16 rooms for real-time state sync; PostgreSQL for durable entities (players, battle outcomes, rule set versions, private message audit log metadata), Redis for ephemeral coordination (rate limiting, presence, transient message queues) and distributed locks. Deterministic action resolution pipeline executed server-side each tick enforcing initiative & priority ordering. Minimal HTTP/REST surface for metadata & retrieval; WebSocket (Colyseus) for real-time interaction.

## Technical Context
**Language/Version**: TypeScript (Node.js 20 LTS)  
**Primary Dependencies**: Colyseus v0.16 (server), colyseus.js (client dependency already noted in constitution), Express 5 (HTTP API), zod (validation), pg (PostgreSQL driver), node-redis v5, pino (structured logging)  
**Storage**: PostgreSQL (durable domain data + audit log metadata), Redis (ephemeral: rate limits, presence, transient locks), In-memory per-room state (authoritative runtime)  
**Testing**: Vitest (align with existing web-client), Supertest (HTTP), Colyseus test harness (room lifecycle), contract tests (OpenAPI schema validation)  
**Target Platform**: Linux container (Docker) alongside existing Postgres + Redis services  
**Project Type**: Web (frontend + backend) — adds new backend service alongside existing `web-client`  
**Performance Goals**: Tile placement & chat propagation ≤150ms p95 end-to-end; deterministic conflict resolution; support ~1,000 concurrent connected players across rooms with <=5% CPU headroom per node at target scale (baseline estimate; refine later)  
**Constraints**: Max 32 players per instance; 60s reconnect grace; rate limits (chat 20/10s, private 10/10s, tile 5/sec burst 10/2s); ephemeral instance loss on host failure; minimal logging (7-day retention)  
**Scale/Scope**: Initial slice: ~1,000 concurrent players, tens to low hundreds of simultaneous rooms; expansion & sharding strategy deferred to later feature.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The current constitution (web client focused) emphasizes: server authoritative model, thin client, TypeScript strictness, real-time efficiency, observability via basic counters & logs.

Assessment (Backend Extension):
- Server Authoritative: Plan maintains authoritative state exclusively server-side (PASS)
- Thin Client: No new client obligations beyond existing colyseus.js usage (PASS)
- Real-time Efficiency: WebSocket (Colyseus) diff/state patching, deterministic ordering (PASS)
- Type Safety: TypeScript for backend + shared types package proposed (PASS)
- Observability: Structured JSON logs (pino) limited to critical events, counters; aligns with minimal requirement (PASS)
- Bundle / Client budgets unaffected (PASS)

Initial Constitution Check Result: PASS (no violations). No complexity deviations requiring justification at this stage.

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
web-client/                     # existing frontend (unchanged this feature)
server/                         # new backend service (to be created in impl feature)
   src/
      rooms/                      # Colyseus room handlers (BattleRoom)
      state/                      # Room state schema & serialization helpers
      actions/                    # Action validation & resolution pipeline
      services/                   # Domain services (rate limiting, messaging, NPC scheduler)
      models/                     # Persistence models / repositories (PlayerRepo, OutcomeRepo)
      api/                        # Express routers (health, outcomes, messages)
      infra/                      # DB/Redis clients, configuration
      logging/                    # Logger setup
      index.ts                    # Server bootstrap (Express + Colyseus)
   tests/
      contract/                   # OpenAPI contract tests
      integration/                # Multi-room interaction tests
      unit/                       # Pure logic (ordering, rate limit calc, validation)
shared/                         # (Future) shared types between client/server (deferred)
infrastructure/                 # existing docker-compose for Postgres & Redis
```

**Structure Decision**: Adopt Web application structure (frontend + backend). Add `server/` directory with layered folders reflecting real-time room logic separated from persistence & API. Shared types may be introduced in a later feature after initial backend scaffolding (kept minimal now to reduce complexity risk).

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

**Output**: `research.md` with all NEEDS CLARIFICATION resolved (remaining clarifications in spec are catalog placeholders to be addressed in subsequent feature focused on error code expansion / ordering semantics if needed — they do not block initial implementation because minimal seed catalog defined.)

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

**Output**: `data-model.md`, `/contracts/game-service.yaml`, initial (failing) contract tests (to be added during implementation phase), `quickstart.md`, updated `.github/copilot-instructions.md` (agent context)

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

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
No current deviations; table omitted.


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All BLOCKING NEEDS CLARIFICATION resolved (deferred, non-blocking markers remain in feature spec: extended rejection code catalog, cross-shard ordering model — explicitly out of initial slice scope)
- [x] Complexity deviations documented (none)

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
