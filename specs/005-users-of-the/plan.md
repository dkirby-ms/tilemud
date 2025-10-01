
# Implementation Plan: Web Client Login, Character Selection, Server Connection & In-Game Chat Integration

**Branch**: `005-users-of-the` | **Date**: 2025-10-01 | **Spec**: `/home/saitcho/tilemud/specs/005-users-of-the/spec.md`
**Input**: Feature specification from `/specs/005-users-of-the/spec.md`

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
Enable authenticated web client users (Entra ID) to: (1) view & select an existing character, (2) connect to the single global Colyseus server instance using that character, and (3) participate in real-time chat with other connected players under clarified constraints (256 char max, 5 msgs / 5s rate limit, ordered by timestamp + receive order tie-break, sender echo after server acceptance, 15s reconnection grace). Moderation beyond baseline sanitization and explicit capacity limits are out of scope for this feature, but design must not preclude future multi-instance / moderation extensions.

## Technical Context
**Language/Version**: TypeScript 5.x (Node 20 backend, React/Vite frontend)  
**Primary Dependencies**: Backend: Colyseus 0.16, Express 5, zod, pg, redis, pino. Frontend: React 19, Vite 7, Zustand, MSAL Browser, react-router-dom.  
**Storage**: PostgreSQL (characters, sessions/audit), Redis (rate limiting / reconnect sessions), in-memory Colyseus room state.  
**Testing**: Vitest (unit/contract/integration) both server and web-client; MSW for client-side contract tests; supertest for API endpoints (existing).  
**Target Platform**: Browser (desktop-first, future mobile), server on Linux container (Docker).  
**Project Type**: Web (frontend + backend monorepo style: `web-client/` + `server/`).  
**Performance Goals**: Tentative (to refine later): Chat end-to-end latency < 300ms p95 under nominal load (<100 concurrent).  
**Constraints**: Single global instance; no message backlog; deterministic ordering; 15s reconnect grace; rate limit enforcement strict (reject).  
**Scale/Scope**: Initial cohort (<100 concurrent). No horizontal scaling in this feature; design shall not block sharding later.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution (web client) principles vs plan:
- Thin client / server authoritative: ✔ Chat send = intent; server acceptance determines echo. No local optimistic echo beyond loading state.
- Real-time efficient: ✔ Will use existing Colyseus connection (add chat channel/messages). Will avoid redundant polling; reuse WebSocket.
- Type-safe & testable: ✔ Will define shared message types (zod schemas or Colyseus schema extension) and contract tests.
- Diagnostics: Will add minimal connection state indicator + rate limit error surface; full FPS/network overlay not expanded in this feature (already partially present via diagnostics overlay capability). No violation.
No violations detected requiring complexity justification at this stage.

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
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->
```
server/
   src/
      api/               # Existing REST endpoints (extend if needed for roster)
      rooms/             # Colyseus BattleRoom (add chat handling integration)
      services/          # Add ChatMessageService extension if needed
      models/            # (ReconnectSession, add ChatMessage model if persisted ephemeral log?)
      actions/           # Player action handling (may integrate chat action)
   tests/
      contract/
      integration/
      unit/

web-client/
   src/
      features/
         character/       # Existing character selection
         chat/            # NEW: chat UI (message list, input, rate limit feedback)
         session/         # NEW: connection state hook & Colyseus client wrapper
      providers/
      app/
   tests/
      contract/          # Add chat contract tests (API message shape / WebSocket)
      integration/       # End-to-end simulated user flows
      unit/
```

**Structure Decision**: Extend existing dual project layout; introduce `chat/` and `session/` feature modules on the client; augment server room + possible dedicated service for chat validation & rate limiting.

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

**Initial Research Focus Areas**:
- Multi-tab/concurrent session policy patterns (decide if restricted to 1 active connection per user per character – likely reject secondary joins with explanatory error).
- Visibility indicator: count vs names (choose minimal viable: count + optional expansion, TBD in tasks phase if not clarified beforehand).
- Logging retention baseline (session start/end events already required; decide retention strategy: rely on pino + central log ingestion—document).
- Sanitization scope (baseline: strip control chars, enforce Unicode normalization NFC, reject >256).
- Join failure taxonomy draft (auth expired, server unavailable, rate limited, invalid character selection, duplicate session) pending full enumeration.

**Output**: research.md with rationale & decisions; if unresolved items remain but non-blocking, mark Deferred.

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API & Realtime Contracts**:
   - REST (if needed): Character roster already exists; add /chat/health (optional) only if necessary (likely skip).
   - WebSocket (Colyseus room messages): Define message schemas:
     * client→server: `chat.send { message: string, clientNonce: string }`
     * server→clients: `chat.message { id, characterId, content, acceptedTs, order }`
     * server→client (errors): `chat.reject { clientNonce, reason, code }`
     * presence update: `presence.snapshot { count, players? }` if names chosen later.
   - Rate limit error mapping (code: `RATE_LIMIT_EXCEEDED`).

3. **Generate contract tests**:
   - Web-client: MSW or mocked Colyseus client tests validating message handling & ordering.
   - Server: Unit tests for rate limiting (5/5s), ordering tie-break, reconnection within 15s vs after.
   - Error scenarios: oversize message, pre-session send attempt, duplicate session join.

4. **Extract test scenarios**:
   - Story 1: Auth → Select → Connect → Send message visible to others (assert echo timing after acceptance)
   - Story 2: Multiple characters selection isolation
   - Story 3: Rate limit rejection path
   - Story 4: Late join message visibility (no history)
   - Story 5: Disconnect + reconnect within 15s (presence retained vs after 15s removal)

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

**Estimated Output**: ~30 tasks (models, services, client state, UI, tests, logging, docs)

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
No constitutional violations identified. No additional complexity justifications required.


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [ ] Phase 0: Research complete (/plan command)
- [ ] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [ ] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
