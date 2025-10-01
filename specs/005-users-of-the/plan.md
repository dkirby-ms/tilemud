
# Implementation Plan: Web Client Login, Character Selection, Server Connection & In-Game Chat

**Branch**: `005-users-of-the` | **Date**: 2025-10-01 | **Spec**: `/specs/005-users-of-the/spec.md`
**Input**: Feature specification from `specs/005-users-of-the/spec.md`

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
Enable authenticated players (Entra ID) using the existing web client to (1) view and select a previously created character (reusing feature 001), (2) explicitly click Connect to join the single global Colyseus game room / server instance, and (3) exchange real‑time chat messages limited to messages occurring after their join (no backlog) with a 256 character maximum length. This plan integrates existing character roster & selection UI flows with the server’s Colyseus `BattleRoom` (or a lighter-weight chat/session room adapter if required) while preserving thin-client, server-authoritative principles. Future multi-instance routing is out-of-scope but design must not block scaling.

## Technical Context
**Language/Version**: TypeScript 5.x (frontend Vite + backend Node 20)  
**Primary Dependencies**: Frontend: React 19, Zustand, MSAL (`@azure/msal-browser`); Backend: Express 5, Colyseus 0.16, @colyseus/schema, zod, pg, redis, pino  
**Storage**: PostgreSQL (persistent characters & outcomes), Redis (rate limits / ephemeral), In-memory Colyseus room state  
**Testing**: Vitest (unit, integration, contract) on both server and web-client, MSW for frontend API mocking  
**Target Platform**: Browser (modern evergreen) + Node.js 20 LTS server  
**Project Type**: Web application (frontend + backend already separated as `web-client/` and `server/`)  
**Performance Goals**: Join & roster load < 2s (aligned with feature 001), chat send→display latency target < 300ms p95 (initial heuristic), reconnect grace period (existing server default 60s) leveraged  
**Constraints**: Thin client (no authoritative state), single global instance, message length ≤ 256 chars, no historical backlog, colyseus message ordering preserved  
**Scale/Scope**: Initial single-room concurrency matching `BattleRoom` maxPlayers (still TBD numeric capacity); future multi-instance scaling deferred

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution (Web Client) Principles Mapping:
- Thin Client / Server-Authoritative: Chat + join flows send intents; no local authoritative simulation added → PASS.
- Real-time First: Use existing Colyseus websocket channel; avoid polling for chat → PASS.
- Efficiency / Budgets: Adds minimal incremental bundle code (Colyseus client library already dependency via existing plan? If not, will add and monitor bundle size) → WATCH (track bundle delta in quickstart).
- Type-Safe & Testable: Plan introduces contract tests for join & chat message envelope; unit tests for message store & rate-limit UI feedback → PASS.
- Diagnostics: Reuse existing latency / reconnect indicators or add minimal extension (connection state label) → PASS.

Initial Constitution Check: PASS (No violations). No complexity deviations needed at this stage.

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
      api/              # Existing HTTP endpoints (health, outcomes, etc.)
      rooms/            # Colyseus rooms (BattleRoom etc.)
      services/         # Domain services (rateLimiter, messageService ...)
      state/            # Colyseus state schema definitions
      infra/            # Config, container, env bootstrap
      actions/          # Action parsing & validation
   tests/
      unit/
      integration/
      contract/

web-client/
   src/
      features/
         character/      # Existing character roster & creation
         session/        # (NEW) connection orchestration & state
         chat/           # (NEW) chat panel, message list, input box, validation
      providers/        # Auth / MSAL provider
      hooks/            # Shared hooks
      types/            # Domain & API typings
      utils/            # Helpers (e.g., formatting, error mapping)
   tests/
      unit/
      integration/
      contract/
```

**Structure Decision**: Web application dual-project; adding `session` and `chat` feature subdirectories under `web-client/src/features/`. No server structure changes required initially—chat piggybacks on existing room messaging or (if absent) will add minimal broadcast channel. Contracts added via server HTTP (join handshake) + Colyseus message schemas.

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

Planned Research Focus Areas:
1. Colyseus client best practice for lightweight chat-only messaging vs. action pipeline – confirm reuse or introduce dedicated channel.
2. Message ordering guarantees and tie-break (likely server acceptance tick or monotonic sequence).
3. Rate limiting interplay (UI feedback) using existing server rateLimiter service events (currently for actions)—extend or create chat-specific limiter.
4. Graceful handling of reconnect (reuse existing reconnectService grace period of 60s).
5. Bundle impact of adding Colyseus client to web-client (if not already present) and mitigation (code splitting?).
6. Security review: Ensure auth token is not directly trusted by the Colyseus handshake (server side validation path).

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

Design Elements to Produce:
- Data Model additions: Client-side ephemeral stores: SessionState { status: idle|connecting|connected|error, playerId, characterId, instanceId }, ChatMessage { id, fromCharacterId, content, receivedAt }. No persistence added.
- Contracts: (a) HTTP: none new (assuming existing roster + selection endpoints); (b) WebSocket: Colyseus room join message shape (options: { playerId, displayName }); broadcast message: `chat.message` { id, from, content, ts }. Rejection / validation error message.
- Validation: Enforce ≤256 chars client-side before send; block empty/whitespace-only; rate limit UI disabled state (server still authoritative).
- Quickstart: Steps: login, ensure character, open Connect pane, join, send message, observe echo + others.
- Tests: Contract tests generate failing expectations for message envelope, ordering (monotonic timestamp), rejection on >256 chars.
- Agent context update: record addition of Colyseus client usage in web-client for chat & session.

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
No deviations; complexity remains within existing dual-project structure. (Table intentionally omitted.)


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)  
- [x] Phase 1: Design complete (/plan command)  
- [x] Phase 2: Task planning approach documented (/plan command)  
- [ ] Phase 3: Tasks generated (/tasks command)  
- [ ] Phase 4: Implementation complete  
- [ ] Phase 5: Validation passed  

**Gate Status**:
- [x] Initial Constitution Check: PASS  
- [x] Post-Design Constitution Check: PASS  
- [ ] All NEEDS CLARIFICATION resolved (Remaining: rate limit thresholds, capacity numeric limit, moderation scope, echo behavior, tie-break rule, reconnection grace window specifics, visibility format, failure reason taxonomy, logging retention, sanitization specifics)  
- [x] Complexity deviations documented (none required)  

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
