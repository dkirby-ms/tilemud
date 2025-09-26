
# Implementation Plan: User Logout Capability

**Branch**: `002-logout-functionality-is` | **Date**: 2025-09-26 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification from `/specs/002-logout-functionality-is/spec.md`

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
Implement a secure, idempotent user logout capability for the TileMUD web client that: (a) terminates the current authenticated session, (b) lazily invalidates other device sessions (via server-side token rejection on next use), (c) purges all user‑scoped client state (Zustand character store, cached roster/catalog/profile data), (d) prevents stale protected content via navigation history, (e) is resilient offline, and (f) provides accessibility‑compliant logout control without superfluous UI messaging. A lightweight cross‑tab propagation mechanism (localStorage broadcast) ensures other tabs transition to logged‑out state on next interaction. Unsaved change guarding uses a focused-field dirty heuristic; progress feedback appears only if the operation exceeds 400ms.

## Technical Context
**Language/Version**: TypeScript 5.x (ES2022 target)  
**Primary Dependencies**: React 18, Vite 5, `@azure/msal-browser` (Entra ID auth), `zustand`, `react-router-dom`, MSW (tests), Vitest + React Testing Library  
**Storage**: Client-side only (MSAL token cache in localStorage; feature purges user-scoped app state)  
**Testing**: Vitest (unit, integration, contract) with MSW to simulate character API + auth edge cases  
**Target Platform**: Modern evergreen desktop & mobile browsers  
**Project Type**: Single web client (`web-client/`)  
**Performance Goals**: Logout UI completion perceived <400ms (no spinner); spinner only after 400ms threshold; no additional network beyond required IdP call  
**Constraints**: Must not introduce server-authoritative violations; must clear sensitive state before navigation; avoid bundle bloat (< +2 KB gzip)  
**Scale/Scope**: Hundreds of concurrent users; multiple tabs; multi-device sessions; future real-time layer unaffected

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Thin Client: Logout strictly manages client session artifacts; no domain authority added client-side.
- Real-time & Efficiency: Adds only a small localStorage broadcast; no polling or heavy listeners; no bundle inflation beyond a tiny component + hook.
- Type-Safe & Observable: Strong typing for logout events; optional structured logout event emission (console/dev tooling) without leaking PII.
- Governance: No deviations; no new subsystems. Temporary localStorage broadcast is minimal and reversible.

Initial evaluation: PASS (no violations). Post-design evaluation: PASS (no new complexity introduced).

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
├── src/
│   ├── app/                 # Routing & layout
│   ├── components/          # Shared presentational components
│   ├── features/
│   │   ├── auth/            # NEW: logout UI (LogoutButton), hooks
│   │   └── character/       # Existing character feature
│   ├── hooks/               # NEW: unsaved changes detection hook
│   ├── providers/           # AuthProvider (extended with cross-tab handling)
│   ├── mocks/               # MSW handlers
│   └── types/               # Domain & API types
├── tests/
│   ├── unit/                # Add logout + store reset tests
│   ├── integration/         # (Optional) scenario tests
│   └── contract/            # Service contract tests (unchanged)
```

**Structure Decision**: Extend existing single web client. Add minimal `features/auth` and `hooks` folders—keeping logout logic modular and testable without polluting character feature. No backend additions.

## Phase 0: Outline & Research
Key research dimensions & decisions (full detail in `research.md`):
1. Cross-tab logout propagation: Chosen localStorage timestamp broadcast (O(1) code, no libs). Alternatives: BroadcastChannel API (broader support tradeoff), service worker message bus (overkill), no propagation (would delay perceived security). 
2. Unsaved changes heuristic: Focused-field dirty vs full-form diff—chosen for simplicity and minimal false positives given current limited forms.
3. Progress indicator threshold: 400ms (from spec) implemented via delayed spinner to avoid UI flicker.
4. State purge ordering: Purge character store prior to initiating redirect, and again upon auth loss (idempotent) to satisfy FR-05/09.
5. Lazy global invalidation assumption: Document reliance on server token rejection; client enforces defensive stance by clearing state regardless of server response.

**Output**: `research.md` capturing decisions, rationale, alternatives.

## Phase 1: Design & Contracts
1. Entities extracted (Session, LogoutEvent (conceptual), UserCachedData) with fields and lifecycle documented in `data-model.md`.
2. Contracts: No direct REST logout endpoint (IdP redirect flow). Provide `contracts/logout.md` describing interaction contract, localStorage broadcast schema, and structured logout event fields (FR-16).
3. Contract tests: (Deferred until /tasks) create a placeholder unit test ensuring structured logout event shape & store reset behavior—captured in quickstart instructions.
4. Integration scenarios mapped to quickstart: multi-tab logout, offline logout, unsaved field confirmation path, back navigation check, idempotent double-click, progress indicator threshold.
5. Agent context update to include new folders (`features/auth`, `hooks`).

**Output**: `data-model.md`, `contracts/logout.md`, `quickstart.md`, updated agent context (script run in later automation), design notes for tests.

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
No constitutional violations introduced; no entries required.


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
