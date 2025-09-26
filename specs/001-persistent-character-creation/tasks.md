# Tasks: Persistent Character Creation

**Input**: Design documents from `/specs/001-persistent-character-creation/`
**Prerequisites**: `plan.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Phase 3.1: Setup
- [x] **T001** Scaffold Vite React TypeScript workspace in `web-client/` with ES2022 target and tailor `package.json` metadata for TileMUD.
- [x] **T002** Install project dependencies (`react-router-dom`, `@azure/msal-browser`, `zustand`, `msw`, `vitest`, Testing Library, eslint/prettier plugins) and add `dev`, `build`, `preview`, `typecheck`, `test:unit`, `test:contract`, `test:integration` scripts in `web-client/package.json`.
- [x] **T003** Configure strict TypeScript (`tsconfig.json`), ESLint + Prettier configs, and wire lint/typecheck/test commands into CI-ready `pnpm` scripts under `web-client/`.
- [x] **T004** Create `web-client/.env.example` documenting required `VITE_` variables and update `README.md` quickstart section with local setup notes.

## Phase 3.2: Tests First (TDD)
- [x] **T005 [P]** Author failing contract test for **GET** `/api/catalog/archetypes` in `web-client/tests/contract/catalog.get.spec.ts` validating schema from `ArchetypeCatalogResponse`.
- [x] **T006 [P]** Author failing contract test for **GET** `/api/players/me/characters` in `web-client/tests/contract/characters.get.spec.ts` covering roster payload and outage notice handling.
- [x] **T007 [P]** Author failing contract test for **POST** `/api/players/me/characters` in `web-client/tests/contract/characters.post.spec.ts` covering validation, collision, and limit responses.
- [x] **T008 [P]** Author failing contract test for **POST** `/api/players/me/characters/{characterId}/select` in `web-client/tests/contract/characters.select.post.spec.ts` verifying 204/400/404/503 cases.
- [x] **T009 [P]** Author failing contract test for **GET** `/api/service-health/character` in `web-client/tests/contract/service-health.get.spec.ts` validating health status schema.
- [x] **T010 [P]** Author failing integration test for first-time player creation flow (auth → create → roster confirmation) in `web-client/tests/integration/create-character.spec.ts` using Testing Library + MSW.
- [x] **T011 [P]** Author failing integration test for returning player roster auto-load, multi-character selection, and 2s render requirement in `web-client/tests/integration/returning-player.spec.ts`.
- [x] **T012 [P]** Author failing integration test for outage-banner behavior and disabled character actions in `web-client/tests/integration/outage-handling.spec.ts`.

## Phase 3.3: Core Implementation
- [x] **T013 [P]** Implement comprehensive domain types including `PlayerAccount`, `CharacterProfile`, `Archetype`, `OutageNotice` interfaces, and type guards in `web-client/src/types/domain.ts`.
- [x] **T014 [P]** Implement error handling types and classes with `AppError`, `NetworkError`, severity classification, and user-friendly messaging in `web-client/src/types/errors.ts`.
- [x] **T015 [P]** Implement API response types with `ApiResponse<T>`, `SuccessResponse`, `ErrorResponse`, client interfaces, and retry configuration in `web-client/src/types/api.ts`.
- [ ] **T016** Create MSW handlers that satisfy contract schemas in `web-client/src/mocks/characterServiceHandlers.ts` with toggles for outage mode.
- [ ] **T017** Build typed API client wrapper functions (`fetchCatalog`, `fetchRoster`, `createCharacter`, `selectCharacter`, `getServiceHealth`) in `web-client/src/features/character/api/characterClient.ts` including error normalization.
- [ ] **T018** Implement Zustand store + selectors managing roster state, optimistic intents, and outage flags in `web-client/src/features/character/state/characterStore.ts`.
- [ ] **T019** Build `AuthProvider` using `@azure/msal-browser` redirect flow and expose auth context hooks in `web-client/src/providers/AuthProvider.tsx`.
- [ ] **T020** Implement application router shell (protected routes, loading gates) in `web-client/src/app/AppRouter.tsx` with suspense-ready layout.
- [ ] **T021** Implement accessible `CharacterCreationForm` component with validation + submit UX in `web-client/src/features/character/components/CharacterCreationForm.tsx`.
- [ ] **T022** Implement responsive `CharacterRoster` component with multi-character selection controls in `web-client/src/features/character/components/CharacterRoster.tsx`.
- [ ] **T023** Implement `OutageBanner` component displaying service status and retry controls in `web-client/src/features/character/components/OutageBanner.tsx`.
- [ ] **T024** Compose dashboard page wiring form, roster, outage banner, and diagnostics timers in `web-client/src/features/character/pages/CharacterDashboardPage.tsx`.
- [ ] **T025** Wire application entry point (`web-client/src/main.tsx`) to mount providers, initialize MSW worker in dev, and load global styles.

## Phase 3.4: Integration & Cross-Cutting Concerns
- [ ] **T026 [P]** Implement diagnostics overlay (FPS/latency/loaded chunks) toggled via config in `web-client/src/features/diagnostics/DiagnosticsOverlay.tsx`.
- [ ] **T027** Apply responsive design tokens and shared styles in `web-client/src/styles/theme.css` ensuring 44px touch targets and mobile-first layout.
- [ ] **T028** Add bundle budget check and build analysis scripts (`pnpm run build:analyze`) in `web-client/package.json` with CI guard enforcing <200 KB gzip.

## Phase 3.5: Polish & Validation
- [x] **T029 [P]** Write unit tests for domain types and type guards in `web-client/tests/unit/types.spec.ts` covering all interfaces and validation functions.
- [x] **T030 [P]** Write unit tests for error handling classes and utilities in `web-client/tests/unit/errors.spec.ts` covering error classification and user-friendly messaging.
- [x] **T031 [P]** Write unit tests for API response types and utilities in `web-client/tests/unit/api.spec.ts` covering type guards, error extraction, and retry logic.
- [ ] **T032 [P]** Write unit tests for Zustand store reducers/selectors in `web-client/tests/unit/characterStore.spec.ts`.
- [ ] **T033 [P]** Write unit tests for creation form and roster components covering validation and accessibility in `web-client/tests/unit/characterComponents.spec.tsx`.
- [ ] **T034 [P]** Update documentation (`web-client/README.md` or root README) with auth setup, outage toggle instructions, and diagnostics overlay usage.
- [ ] **T035** Execute quickstart smoke script, capture results, and ensure CI scripts (lint, typecheck, tests, build) run clean before handoff.

## Dependencies
- T002 depends on T001.
- T003 depends on T002.
- T004 depends on T002.
- T005–T012 depend on T003 and must be completed before any implementation task T013+.
- T013–T015 depend on T005–T012 (types referenced in tests).
- T016 depends on T005–T012.
- T017 depends on T016.
- T018 depends on T017.
- T019 depends on T013–T018.
- T020 depends on T003 (config) and is required before T021–T025.
- T021 depends on T019 and relevant contract tests.
- T022–T024 depend on T018 and relevant contract tests.
- T025 depends on T021–T024.
- T026 depends on T025 (overlay consumes store data).
- T027 depends on T024 (styles for composed page).
- T028 depends on T003 (build tooling ready).
- T029–T031 completed (unit tests for type system).
- T032–T033 depend on T018–T024 (unit targets implemented).
- T035 depends on all prior tasks; T034 can run after T028 and component implementations.

## Current Progress Summary
**Completed**: T001–T015, T029–T031 (15/35 tasks complete, 43%)

**Phase 3.1 Setup**: ✅ Complete  
**Phase 3.2 Tests First**: ✅ Complete (73 failing tests established for TDD)  
**Phase 3.3 Core Implementation**: 🔄 In Progress (Types complete, need MSW + components)  
**Phase 3.4 Integration**: 🔄 Pending  
**Phase 3.5 Polish**: 🔄 Partially Complete (unit tests for types done)

**Next Priority**: T016 (MSW handlers) to enable API client implementation

## Parallel Execution Example
Launch these independent tasks together after completing T015:
```
Task: "T016 Create MSW handlers that satisfy contract schemas"
Task: "T026 Implement diagnostics overlay toggled via config"
```

After T018 (API client) completion:
```
Task: "T019 Build AuthProvider using @azure/msal-browser redirect flow"
Task: "T032 Write unit tests for Zustand store reducers/selectors"
Task: "T033 Write unit tests for creation form and roster components"
```

## Next Steps
The project has completed the foundational type system and test scaffolding. The immediate next priority is:

1. **T016**: Implement MSW handlers to satisfy the contract tests
2. **T017**: Build the typed API client wrapper functions  
3. **T018**: Create the Zustand store for state management

This will enable the React component implementation phase (T019-T025).

## Notes
- Maintain TDD discipline: ensure contract/integration tests fail before implementing functionality.
- Keep MSW mocks aligned with OpenAPI contract; regenerate fixtures if the contract file changes.
- Respect constitutional budgets and diagnostics requirements during implementation.
- Commit after each task; include test evidence for every change.
