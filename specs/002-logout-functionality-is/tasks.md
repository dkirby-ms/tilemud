# Task Plan: User Logout Capability

Feature Directory: `/home/saitcho/tilemud/specs/002-logout-functionality-is`
Branch: `002-logout-functionality-is`
Date: 2025-09-26

This file enumerates dependency-ordered implementation tasks for the Logout feature. Follow TDD: create/adjust tests before implementing production code. `[P]` denotes tasks that may be executed in parallel (different files / no shared mutable design surface). Sequential tasks touching same file or depending on artifacts from a prior task are unmarked.

## Legend
- T###: Task identifier (stable)
- [P]: Can be run in parallel with other [P] tasks at same grouping level
- Dependency: Explicit prerequisite task IDs (must be complete first)

## High-Level Phases Mapping
1. Setup & Scaffolding (T001–T005)
2. Test Definitions (Contract / Unit / Integration) (T006–T015)
3. Core Implementation (Hooks, Components, Provider integration) (T016–T024)
4. Cross-Tab & Guards (T025–T028)
5. Polish, Accessibility, Docs & Cleanup (T029–T034)
6. Final Validation & Context Update (T035–T038)

---

## Task List

### 1. Setup & Scaffolding
| ID | Task | Details / File Targets | Dependency | Parallel |
|----|------|------------------------|------------|----------|
| ✅ T001 | Create feature folders | `web-client/src/features/auth/`, `web-client/src/hooks/` (if not exist) | - | [P] |
| ✅ T002 | Add placeholder `LogoutButton.tsx` | Minimal button exporting React component (no logic) in `features/auth/LogoutButton.tsx` | T001 |  |
| ✅ T003 | Add placeholder `useLogout.ts` hook | Skeleton returning no-op handler in `features/auth/useLogout.ts` | T001 | [P] |
| ✅ T004 | Add placeholder `useFocusedDirtyGuard.ts` | Returns stub checking always false in `src/hooks/useFocusedDirtyGuard.ts` | T001 | [P] |
| ✅ T005 | Ensure test setup util for storage events | If needed extend `tests/setup.ts` with helper to dispatch storage events | - | [P] |

### 2. Test Definitions (Write failing tests first)
| ID | Task | Details / File Targets | Dependency | Parallel |
|----|------|------------------------|------------|----------|
| ✅ T006 | Unit test: logout event emission shape | `tests/unit/logoutEvent.spec.ts` (assert structured event fields) | T002,T003 | [P] |
| ✅ T007 | Unit test: character store purge on logout | Extend `tests/unit/characterStore.spec.ts` OR new `logoutPurge.spec.ts` (choose new file) | T003 | [P] |
| ✅ T008 | Unit test: idempotent double invoke | `tests/unit/logoutIdempotent.spec.ts` | T003 | [P] |
| ✅ T009 | Unit test: unsaved changes guard prompt logic | `tests/unit/focusedDirtyGuard.spec.ts` | T004 | [P] |
| ✅ T010 | Unit test: localStorage broadcast write | `tests/unit/logoutBroadcast.spec.ts` (spy on setItem) | T003 | [P] |
| ✅ T011 | Unit test: cross-tab listener purge | `tests/unit/logoutListener.spec.ts` simulate storage event | T010 | [P] |
| ✅ T012 | Integration test: standard logout flow | `tests/integration/logout.standard.spec.ts` per quickstart smoke | T002,T003 | [P] |
| ✅ T013 | Integration test: unsaved changes guard scenario | `tests/integration/logout.unsaved.spec.ts` | T004 | [P] |
| ✅ T014 | Integration test: back navigation protection | `tests/integration/logout.backnav.spec.ts` | T012 | [P] |
| ✅ T015 | Integration test: offline logout scenario | `tests/integration/logout.offline.spec.ts` (simulate offline) | T012 | [P] |

### 3. Core Implementation
| ID | Task | Details / File Targets | Dependency | Parallel |
|----|------|------------------------|------------|----------|
| T016 | Implement focused dirty guard hook | Actual heuristic (focused element dirty & non-empty) in `useFocusedDirtyGuard.ts` | T009 |  |
| T017 | Implement `useLogout` basic purge logic | Add: start timer, purge character store, emit dev event skeleton (no MSAL call yet) in `useLogout.ts` | T006,T007,T008 |  |
| T018 | Wire MSAL logoutRedirect into hook | Integrate with `@azure/msal-browser`, support latency measurement | T017 |  |
| T019 | Add delayed spinner logic | 400ms threshold inside hook or component state | T018 | [P] |
| T020 | Implement `LogoutButton` UI states | Loading, confirmation trigger (delegates to guard) | T016,T019 |  |
| T021 | Integrate button into App layout | Insert into `AppRouter.tsx` (header/navigation) | T020 |  |
| T022 | Purge & guard integration in AuthProvider | Modify `AuthProvider.tsx` to expose logout context & ensure post-auth-loss purge | T017 |  |
| T023 | Add dev-only structured console event | Gate with `import.meta.env.DEV` in hook | T017 | [P] |
| T024 | Add analytics ID retention test stub | Ensure analytics identifiers unaffected (extend or create test) | T007 | [P] |

### 4. Cross-Tab & Guards
| ID | Task | Details / File Targets | Dependency | Parallel |
|----|------|------------------------|------------|----------|
| T025 | Implement localStorage broadcast write | Write `{ ts }` in hook during logout | T017,T010 |  |
| T026 | Implement storage event listener | In `AuthProvider` or separate `useLogoutListener` hook | T011,T025 |  |
| T027 | Implement focus-based lazy check | On window focus, re-check broadcast timestamp to purge if needed | T026 | [P] |
| T028 | Ensure idempotent purge path | Refactor purge to shared util if needed | T017,T026 | [P] |

### 5. Polish, Accessibility, Docs & Cleanup
| ID | Task | Details / File Targets | Dependency | Parallel |
|----|------|------------------------|------------|----------|
| T029 | Accessibility review | Ensure `LogoutButton` accessible name, focus ring, dialog a11y | T020 |  |
| T030 | Add confirmation dialog component | Minimal inline or extracted; aria attributes | T016,T020 |  |
| T031 | Update quickstart with file references | Modify `quickstart.md` to reflect actual test filenames | T020,T012-T015 | [P] |
| T032 | Add inline JSDoc / types | Add entity types for `LogoutEvent` and purge util | T017-T028 | [P] |
| T033 | Bundle size check script run | Use existing `scripts/bundle-report.js` ensure < +2KB | T021,T025 | [P] |
| T034 | Refactor for simplicity pass | Remove any dead code / TODOs | T033 |  |

### 6. Final Validation & Context Update
| ID | Task | Details / File Targets | Dependency | Parallel |
|----|------|------------------------|------------|----------|
| T035 | Run full test suite | `npm test` all unit & integration | T034 |  |
| T036 | Manual quickstart walkthrough | Follow steps in `quickstart.md` | T035 |  |
| T037 | Update feature progress in `plan.md` | Mark Phase 3 (tasks) & Phase 4 once done | T035 | [P] |
| T038 | Prepare PR description & summary | Reference spec requirements coverage | T036 |  |

---

## Parallel Execution Guidance
Example batch 1 (after T001): Run T002, T003, T004, T005 concurrently.
Example batch 2 (tests): T006–T015 are largely parallel; prioritize T006–T010 first to drive core hook implementation.
Implementation sequencing critical path: T016 → T017 → T018 → (T019,T023,T025) → T020 → T021 → T026 → T027.

## Requirements Mapping
- FR-01 Basic logout trigger: T020,T021
- FR-02 Lazy global invalidation: T026,T027
- FR-03 Redirect to public landing: T018,T021,T012
- FR-04 Prevent stale content: T017,T022,T026
- FR-05 Protected route guard post-logout: T022,T026,T014
- FR-06 Idempotency: T008,T028
- FR-07 Progress indicator threshold: T019,T012
- FR-08 Unsaved changes confirmation: T016,T020,T013
- FR-09 Purge user-scoped state except analytics: T017,T024
- FR-10 Fail-secure (purge even on error): T017 (try/finally), tests in T012/T015
- FR-11 Cross-tab propagation: T025,T026,T027,T011
- FR-12 Back navigation protection: T014,T022
- FR-13 Offline resilience: T015,T017
- FR-14 Minimal bundle impact: T033
- FR-15 Accessibility baseline: T029,T030
- FR-16 Structured dev event: T006,T017,T023
- FR-17 Analytics identifier retention: T024

## Acceptance Scenario Mapping (Quickstart)
- Standard logout: T012
- Unsaved changes guard: T013
- Multi-tab: T011 (unit) + T026/T027 (impl) (optional integration later)
- Offline logout: T015
- Back navigation: T014
- Double click idempotent: T008
- Progress threshold: T019 (+ assertion in T012 optionally)
- Structured event: T006

## Post-Completion Checklist
- [ ] All tasks T001–T038 complete
- [ ] Tests green (T035)
- [ ] Manual quickstart verified (T036)
- [ ] Plan progress updated (T037)
- [ ] PR ready with coverage summary (T038)

---
*Auto-generated via /tasks command logic interpretation of design artifacts.*
