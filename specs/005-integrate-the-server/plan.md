
# Implementation Plan: Integrate Server, Web Client, and Backing Data Layers

**Branch**: `005-integrate-the-server` | **Date**: 2025-10-01 | **Spec**: /specs/005-integrate-the-server/spec.md
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
Integrate the authoritative game server with the existing React/Vite web client to enable real-time authenticated sessions, per-action durability to PostgreSQL, transient performance optimization via Redis, strict client/server version lockstep, sub-200ms p95 action latency, ≤3s p95 initial load, and ≤100ms freshness window for critical state. The integration ensures every acknowledged state-mutating action is durably persisted before confirmation while supporting graceful reconnect, strict token-based session establishment via external IdP (OAuth2/SSO), and prevention of stale state exposure. Technical approach centers on server-authoritative messaging (Colyseus-based), session + action lifecycle instrumentation, cache-as-accelerator (never source of truth), and well-defined contracts for client intents and server outcomes.

## Technical Context
**Language/Version**: TypeScript 5.x (Node.js 20 LTS backend + React 18 frontend)  
**Primary Dependencies**: Colyseus (real-time sessions), Express (HTTP API), Vite/React (client), zod (validation), pg (PostgreSQL driver), node-redis, pino (logging)  
**Storage**: PostgreSQL (durable player + world state), Redis (ephemeral cache, transient acceleration, presence)  
**Testing**: Vitest + Testing Library (frontend), Vitest (backend unit/integration), contract/integration test suites under `server/tests` and `web-client/tests`  
**Target Platform**: Linux (dev + containerized local infra) / browser clients (desktop modern evergreen)  
**Project Type**: Web (frontend + backend + shared contracts)  
**Performance Goals**: ≤3s p95 initial load; ≤200ms p95 action round-trip; 0 acknowledged action loss; 100ms freshness window p95  
**Constraints**: Server authoritative; strict version lockstep; per-action durability pre-ack; cache never sole source of truth; external IdP token validation  
**Scale/Scope**: Initial target concurrency (NEEDS CLARIFICATION: baseline & stretch) left open; design to allow horizontal room sharding.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution (v1.0.0) Key Principles Mapping:
- Thin Client / Server-Authoritative: Plan enforces server validation, client intent messages only (compliant).
- Real-time First: Uses existing WebSocket (Colyseus) diff/state events; latency budgets captured (compliant).
- Efficiency: Will add contract-driven minimal payloads + avoid redundant full state pushes (design commitment). Bundle size not directly altered; monitor during implementation.
- Type-Safety: Shared TypeScript types and generated API/room schema definitions (plan to generate under `server/src/contracts` + client-mapped types) (compliant).
- Testing: Contract tests (server), integration connect/reconnect flows, client state reducer tests (planned) (compliant).
- Observability: Metrics & structured logging enumerated (FR-019 placeholder to refine). Need to finalize required metrics list (open question).

Pre-Phase 0 Gate Result: PASS (Remaining open questions: reconnect retry policy, rollback semantics, outage messaging, roles, metrics list, scale numbers, inactivity timeout, privacy boundaries, consistency ordering model. These do not block baseline design artifacts; they will be annotated as TBD.)

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

ios/ or android/
### Source Code (repository root)
```
server/
   src/
      actions/
      api/
      infra/
      logging/
      models/
      rooms/
      services/
      state/
      types/
   tests/
      contract/
      integration/
      unit/

web-client/
   src/
      app/
      components/
      features/
      hooks/
      providers/
      styles/
      utils/
   tests/
      contract/
      integration/
      unit/

infrastructure/
   docker-compose.dev.yml
   scripts/
   migrations/
```

**Structure Decision**: Web application (frontend + backend). Enhance with shared contract generation step (server emits types consumed by client). Add new folder `server/src/contracts` for generated stable API + messaging schemas if not already fully present.

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

**Phase 0 Deliverables / Focus Areas**:
- Reconnect retry policy (propose exponential backoff with jitter, 5 attempts over ~32s cap)
- Rollback semantics (define atomic action boundaries + compensation strategy: reject vs. compensating inverse event)
- Outage messaging taxonomy (version mismatch, dependency degraded, reconnecting, read-only mode if needed)
- Authorization roles (confirm only “player” + potential future “moderator”; current scope: player only)
- Metrics list (connect_success, reconnect_success_rate, action_latency_p95, stale_refresh_trigger_count, cache_hit_ratio, version_rejects)
- Scalability baseline (document target concurrency placeholder; propose initial 500 concurrent sessions per node with room partitioning)
- Inactivity timeout (propose 10 minutes of no action events)
- Privacy boundaries (no storage of raw personally identifiable info beyond opaque user ID & session token hash)
- Consistency model on reconnect (last-write-wins with server authoritative sequence ordering; vector clocks out of scope)

research.md will record Decision / Rationale / Alternatives for each above. Any unresolved items after research become explicit blockers before Phase 1 completion.

**Output**: research.md with all currently open NEEDS CLARIFICATION items addressed or explicitly deferred with justification.

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API + Real-time Contracts**:
   - REST endpoints (session bootstrap, health, version check)
   - Real-time message schemas (intent: move, chat, action; event: state delta, error, ack)
   - Validation via zod → generate TypeScript types / JSON schema
   - Output to `/specs/005-integrate-the-server/contracts/` and generated server runtime types to `server/src/contracts`

3. **Generate contract tests**:
   - REST: one test per endpoint (session, health, version)
   - Real-time: handshake, join room, action dispatch sequencing, invalid token rejection
   - Assert schema round-trip (encode/decode) + negative cases

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

**Output**: data-model.md, /contracts/* (REST + real-time), failing contract + integration tests, quickstart.md, updated `.github/copilot-instructions.md` (recent changes block)

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

**Estimated Output**: 30-38 numbered tasks (extra real-time schema + durability verification tasks)

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
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS (no new violations introduced)
- [ ] All NEEDS CLARIFICATION resolved (availability %, threat model depth remain)
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
