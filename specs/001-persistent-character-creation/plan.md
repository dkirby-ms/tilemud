
# Implementation Plan: Persistent Character Creation

**Branch**: `001-persistent-character-creation` | **Date**: 2025-09-25 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification from `/specs/001-persistent-character-creation/spec.md`

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
- Deliver a responsive TileMUD web client flow where authenticated players create and manage persistent characters and are reconnected with their roster on every visit.
- Initial iteration uses a React + Vite frontend with embedded mock data to simulate character persistence while wiring the UX, validation, and graceful degradation expectations from the spec.
- Establish the architecture, contracts, and test-first guidance so the static prototype can later swap to live game services without rewrites.

## Technical Context
**Language/Version**: TypeScript 5.x (ES2022 target)  
**Primary Dependencies**: React 18, Vite 5, `@azure/msal-browser` (Entra ID auth), `zustand` state store, `react-router-dom`, Testing Library  
**Storage**: In-memory mock data module (no persistent backing store this iteration)  
**Testing**: Vitest + React Testing Library + MSW for mocked network flows  
**Target Platform**: Modern evergreen browsers on desktop + mobile (responsive layout)  
**Project Type**: Web frontend (single project)  
**Performance Goals**: Render roster view within 2s of auth completion; sustain 60 FPS canvas interactions when added; bundle <200 KB gzip at bootstrap  
**Constraints**: Must degrade gracefully when character service down, enforce strict TypeScript, adhere to observability overlay and budgets from constitution  
**Scale/Scope**: MVP supporting single tenant, hundreds of concurrent users, multiple characters per user, archetype roster curated occasionally

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Thin Client: All authoritative data still resides server-side; mock layer will simulate intents while keeping domain validation on the server boundary for later integration.
- Real-time & Efficiency: Maintain WebSocket-ready abstraction even with static data; ensure rendering pipeline design targets canvas + diff culling once live data arrives.
- Type-Safe & Observable: Plan enforces strict TypeScript, unit tests for state/store helpers, and dev diagnostics (bandwidth/failure banner) per spec.
- Governance: No deviations proposed; any temporary mock implementations are explicitly scoped to MVP and documented for replacement.

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
web-client/
├── public/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/character/
│   ├── hooks/
│   ├── mocks/
│   ├── pages/
│   ├── providers/
│   └── styles/
└── tests/
   ├── contract/
   ├── integration/
   └── unit/
```

**Structure Decision**: Single Vite-powered web client in `web-client/`, organized by features with dedicated test suites (unit, contract, integration) to satisfy constitution-driven quality gates.

## Phase 0: Outline & Research
1. Validate Entra ID integration approach in a React SPA (redirect vs. popup) and document minimal configuration for external identities tenant.
2. Capture best practices for embedding mock data while preserving future API boundaries (e.g., MSW handlers mirroring OpenAPI contracts).
3. Review responsive layout patterns for roster/grid selection that meet accessibility guidance and mobile comfort targets.
4. Summarize performance guardrails (bundle budgets, 2s roster load) and monitoring hooks required by constitution.

**Output**: `research.md` describing auth approach, mock data strategy, responsive layout guidance, and performance guardrails with decisions, rationale, and alternatives.

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. Document `PlayerAccount`, `CharacterProfile`, and `Archetype` entities with validation and lifecycle notes in `data-model.md`.
2. Define OpenAPI contracts for roster retrieval, character creation, selection, and archetype catalog sync in `/contracts/character-service.yaml`, reflecting graceful degradation signals.
3. Outline contract test expectations (to be implemented under `web-client/tests/contract/`) ensuring every endpoint has a failing Vitest placeholder.
4. Translate user stories into integration test flows and capture manual smoke test steps in `quickstart.md` (auth, creation, multi-character switch, outage banner).
5. Run `.specify/scripts/bash/update-agent-context.sh copilot` to sync repository Agent context with new technologies and responsibilities.

**Output**: `data-model.md`, `/contracts/character-service.yaml`, `quickstart.md`, updated agent context, and design notes for upcoming contract tests.

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
No deviations from constitutional expectations identified.


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
- [x] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
