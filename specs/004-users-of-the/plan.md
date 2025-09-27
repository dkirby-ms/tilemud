
# Implementation Plan: Connect Active Character From Web Client To Game Server Instance

**Branch**: `004-users-of-the` | **Date**: 2025-09-27 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification from `/specs/004-users-of-the/spec.md`

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
Enable authenticated web client users with a selected active character to establish, maintain, and (if interrupted) seamlessly reclaim a single authoritative session on a chosen game server instance. The plan introduces: a server-side admission & session registry (single active session per character), a capacity + FIFO queue (max 1000) with drain-mode semantics, reconnection grace handling (60s), a deterministic 10s connection attempt outcome rule, rate limiting (5 failed / 60s → 60s lock), version gating (latest production build), and observability (structured events + counters + queue depth + wait distribution). This implementation spans both `server/` (admission endpoints / WebSocket handshake augmentation, session + queue services, metrics instrumentation) and `web-client/` (connection state machine, UI status surfaces, reconnection logic, throttle & queue UX). Queue wait SLA for p95 is intentionally deferred to planning validation; instrumentation-first approach adopted this iteration.

## Technical Context
**Language/Version**: TypeScript 5.x (Node 18+ backend, ES2022; React/Vite frontend)  
**Primary Dependencies**: Backend: Fastify, Colyseus, Redis, PostgreSQL, prom-client, zod. Frontend: React 18/19, zustand, msal-browser, msw, react-router-dom.  
**Storage**: PostgreSQL (authoritative character + session persistence when needed), Redis (ephemeral session & queue state / rate limiting counters), in-memory fallback for dev.  
**Testing**: Vitest (unit, integration, contract), MSW (frontend network simulation), potential Supertest for admission HTTP route tests, WebSocket integration specs.  
**Target Platform**: Linux server runtime (Node), modern evergreen browsers (desktop/mobile).  
**Project Type**: Dual: server backend (`server/`) + web client (`web-client/`).  
**Performance Goals**: <1s p95 admission (non-queued), <2s p99; reconnection success ≥98% within 60s; instrumentation for queue wait (define p95 SLA later); WebSocket handshake overhead minimal (<50ms additional server processing).  
**Constraints**: Single active session per character enforced atomically; 10s deterministic outcome rule; max queue length 1000; drain mode variance must not break invariants; rate limiter accuracy ≥99%; avoid blocking I/O in admission path; maintain thin client principle & server authoritative model per constitution.  
**Scale/Scope**: Initial: hundreds of concurrent active sessions per instance; design for horizontal scaling (multiple instances each with own capacity & queue; potential global orchestration deferred).  

No outstanding NEEDS CLARIFICATION markers; only deferred SLA (queue wait p95) is an accepted placeholder.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Principle Alignment:
- Thin Client: All authoritative admission, queue, reconnection grace, and rate limiting logic reside on server. Client renders statuses & sends intents only.
- Real-time & Efficiency: WebSocket handshake extended minimally; queue status updates are event-driven (push) or periodic lightweight polls (<1 update / 5s when queued). Reconnection avoids full re-auth roundtrip when token valid.
- Type-Safe & Observable: Strong types for session and attempt states; exhaustive discriminated union for frontend connection FSM; structured events & prom-client counters/histograms.

Risks / Potential Violations: None requiring exception. No additional client-side game authority introduced. PASS.

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
      api/           # HTTP routes (add: admission route if needed)
      ws/            # WebSocket related (presence, rooms) – extend with connection admission module
      application/
         services/
            session/   # NEW: session & reconnection service
            queue/     # NEW: queue management service (capacity, FIFO, metrics)
            rateLimit/ # NEW: rate limiting helper (Redis token bucket / sliding window)
      infra/
         persistence/ # (Add session & attempt store integration if durable persistence required)
         monitoring/  # Metrics & logging extensions
   tests/
      integration/   # WebSocket admission & reconnection specs
      contract/      # Admission API / event protocol contract specs
      unit/          # Queue, rate limit, session state unit tests

web-client/
   src/
      features/
         connection/
            machine/     # Finite state machine for connection lifecycle
            hooks/
            components/  # Status indicator, queue position, replacement prompt
            services/    # Client adapter: websocket connect, reconnection token mgmt
      providers/
      utils/
   tests/
      unit/            # FSM transitions, reducer tests
      integration/     # End-to-end connect → queued → admitted → disconnect, reconnection
      contract/        # Protocol message schema expectations
```

**Structure Decision**: Augment existing `server/` and `web-client/` projects—adding focused subdirectories for session, queue, and connection state machine. No new top-level project required.

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

Research Tasks Executed:
1. Session & queue data placement (Redis vs in-memory vs Postgres)
2. Reconnection mechanism security
3. Rate limiting algorithm choice
4. Event & metric taxonomy definition
5. Queue status dissemination strategy
6. Version gating approach
7. Security review (replacement & reconnect)
8. Stale session cleanup strategy
9. Deterministic 10s outcome mechanism
10. Queue data structure selection (position queries + promotion)
11. Atomic admission transaction design

Key Decisions Summary (see `research.md` for detail):
- Redis + Lua scripts for atomic admission & queue operations.
- Reconnection token (single-use UUID) bound to character+instance with TTL.
- Sliding window rate limiter (Redis) enforcing 5 failures / 60s → 60s lock.
- Sorted Set for queue with enqueue timestamp scores (position via ZRANK).
- Poll every 5s for queue position initial iteration (push deferred).
- Structured event taxonomy & prom-client counters/histograms enumerated.
- 10s attempt timeout via Promise.race with cancellation guard.
- Drain mode forbids new enqueues, allows promotions & reconnections.

All unknowns resolved except intentionally deferred numeric queue wait p95 SLA.

**Output**: `research.md` (generated).

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

Design Artifacts Produced:
1. Data Model (`data-model.md`): Enumerations (SessionState, AttemptOutcome, FailureReason); invariants; frontend FSM; reconnection token semantics.
2. Contract Surfaces (initial description; placeholder for formal files to be added in implementation tasks):
   - Admission endpoint (HTTP POST /instances/:id/connect) returns { outcome: admitted|queued|failed|timeout, ... }.
   - Queue status endpoint (GET /instances/:id/queue/status?characterId=...) returns { position, depth }.
   - Replacement confirm endpoint (POST /instances/:id/connect/replace) or integrated confirm param (design decision: integrate via query param `?replaceToken=` to reduce extra RTT).
   - Reconnection handshake (WebSocket connect parameter reconnectionToken=...).
   - Metrics exposure (existing /metrics endpoint extended with new counters & histograms).
3. Quickstart (`quickstart.md`): End-to-end smoke & failure injection flows.
4. Agent Context: Will be updated after tasks generation to add technologies (Redis, prom-client usage already partly present in server but new usage patterns documented).

Contract Message / Response Codes (proposed):
```
FailureReason codes (string identifiers) mirrored in UI mapping.
HTTP 200 with structured outcome object for deterministic semantics (avoid client retry storms from 429 except rate-limit path which may use 429).
Rate limited path: HTTP 429 { reason: RATE_LIMITED, retryAfterSeconds }
```

Frontend State Machine Implementation Notes:
- Discriminated union `ConnectionState = { kind: 'idle' | 'connecting' | 'queued' | 'admitted' | 'reconnecting' | 'failed' | 'timeout'; ... }`.
- Side-effects (timers, polling) isolated inside hooks to allow deterministic unit tests of pure reducer transitions.

**Output**: `data-model.md`, `quickstart.md` (contracts skeleton described; full OpenAPI to be produced during /tasks execution), plan updated.

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
No constitutional violations; table omitted.


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
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none)

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
