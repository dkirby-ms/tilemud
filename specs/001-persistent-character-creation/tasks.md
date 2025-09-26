# Tasks: Persistent Character Creation

**Input**: Design documents from `/specs/001-persistent-character-creation/`
**Prerequisites**: `plan.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Phase 3.1: Setup
- [ ] **T001** Scaffold Vite React TypeScript workspace in `web-client/` with ES2022 target and tailor `package.json` metadata for TileMUD.
- [ ] **T002** Install project dependencies (`react-router-dom`, `@azure/msal-browser`, `zustand`, `msw`, `vitest`, Testing Library, eslint/prettier plugins) and add `dev`, `build`, `preview`, `typecheck`, `test:unit`, `test:contract`, `test:integration` scripts in `web-client/package.json`.
- [ ] **T003** Configure strict TypeScript (`tsconfig.json`), ESLint + Prettier configs, and wire lint/typecheck/test commands into CI-ready `pnpm` scripts under `web-client/`.
- [ ] **T004** Create `web-client/.env.example` documenting required `VITE_` variables and update `README.md` quickstart section with local setup notes.

## Phase 3.2: Tests First (TDD)
- [ ] **T005 [P]** Author failing contract test for **GET** `/api/catalog/archetypes` in `web-client/tests/contract/catalog.get.spec.ts` validating schema from `ArchetypeCatalogResponse`.
- [ ] **T006 [P]** Author failing contract test for **GET** `/api/players/me/characters` in `web-client/tests/contract/characters.get.spec.ts` covering roster payload and outage notice handling.
- [ ] **T007 [P]** Author failing contract test for **POST** `/api/players/me/characters` in `web-client/tests/contract/characters.post.spec.ts` covering validation, collision, and limit responses.
- [ ] **T008 [P]** Author failing contract test for **POST** `/api/players/me/characters/{characterId}/select` in `web-client/tests/contract/characters.select.post.spec.ts` verifying 204/400/404/503 cases.
- [ ] **T009 [P]** Author failing contract test for **GET** `/api/service-health/character` in `web-client/tests/contract/service-health.get.spec.ts` validating health status schema.
- [ ] **T010 [P]** Author failing integration test for first-time player creation flow (auth → create → roster confirmation) in `web-client/tests/integration/create-character.spec.ts` using Testing Library + MSW.
- [ ] **T011 [P]** Author failing integration test for returning player roster auto-load, multi-character selection, and 2s render requirement in `web-client/tests/integration/returning-player.spec.ts`.
- [ ] **T012 [P]** Author failing integration test for outage-banner behavior and disabled character actions in `web-client/tests/integration/outage-handling.spec.ts`.

## Phase 3.3: Core Implementation
- [ ] **T013 [P]** Implement `PlayerAccount` domain types and helper assertions in `web-client/src/features/character/models/playerAccount.ts`.
- [ ] **T014 [P]** Implement `CharacterProfile` domain types and invariants in `web-client/src/features/character/models/characterProfile.ts`.
- [ ] **T015 [P]** Implement `Archetype` domain types and availability helpers in `web-client/src/features/character/models/archetype.ts`.
- [ ] **T016 [P]** Implement `OutageNotice` domain types and UX-friendly messaging helpers in `web-client/src/features/character/models/outageNotice.ts`.
- [ ] **T017** Create MSW handlers that satisfy contract schemas in `web-client/src/mocks/characterServiceHandlers.ts` with toggles for outage mode.
- [ ] **T018** Build typed API client wrapper functions (`fetchCatalog`, `fetchRoster`, `createCharacter`, `selectCharacter`, `getServiceHealth`) in `web-client/src/features/character/api/characterClient.ts` including error normalization.
- [ ] **T019** Implement Zustand store + selectors managing roster state, optimistic intents, and outage flags in `web-client/src/features/character/state/characterStore.ts`.
- [ ] **T020** Build `AuthProvider` using `@azure/msal-browser` redirect flow and expose auth context hooks in `web-client/src/providers/AuthProvider.tsx`.
- [ ] **T021** Implement application router shell (protected routes, loading gates) in `web-client/src/app/AppRouter.tsx` with suspense-ready layout.
- [ ] **T022** Implement accessible `CharacterCreationForm` component with validation + submit UX in `web-client/src/features/character/components/CharacterCreationForm.tsx`.
- [ ] **T023** Implement responsive `CharacterRoster` component with multi-character selection controls in `web-client/src/features/character/components/CharacterRoster.tsx`.
- [ ] **T024** Implement `OutageBanner` component displaying service status and retry controls in `web-client/src/features/character/components/OutageBanner.tsx`.
- [ ] **T025** Compose dashboard page wiring form, roster, outage banner, and diagnostics timers in `web-client/src/features/character/pages/CharacterDashboardPage.tsx`.
- [ ] **T026** Wire application entry point (`web-client/src/main.tsx`) to mount providers, initialize MSW worker in dev, and load global styles.

## Phase 3.4: Integration & Cross-Cutting Concerns
- [ ] **T027 [P]** Implement diagnostics overlay (FPS/latency/loaded chunks) toggled via config in `web-client/src/features/diagnostics/DiagnosticsOverlay.tsx`.
- [ ] **T028** Apply responsive design tokens and shared styles in `web-client/src/styles/theme.css` ensuring 44px touch targets and mobile-first layout.
- [ ] **T029** Add bundle budget check and build analysis scripts (`pnpm run build:analyze`) in `web-client/package.json` with CI guard enforcing <200 KB gzip.

## Phase 3.5: Polish & Validation
- [ ] **T030 [P]** Write unit tests for Zustand store reducers/selectors in `web-client/tests/unit/characterStore.spec.ts`.
- [ ] **T031 [P]** Write unit tests for creation form and roster components covering validation and accessibility in `web-client/tests/unit/characterComponents.spec.tsx`.
- [ ] **T032 [P]** Update documentation (`web-client/README.md` or root README) with auth setup, outage toggle instructions, and diagnostics overlay usage.
- [ ] **T033** Execute quickstart smoke script, capture results, and ensure CI scripts (lint, typecheck, tests, build) run clean before handoff.

## Dependencies
- T002 depends on T001.
- T003 depends on T002.
- T004 depends on T002.
- T005–T012 depend on T003 and must be completed before any implementation task T013+.
- T013–T016 depend on T005–T009 (types referenced in tests).
- T017 depends on T005–T009.
- T018 depends on T017.
- T019 depends on T013–T018.
- T020 depends on T003 (config) and is required before T021–T026.
- T021 depends on T020.
- T022–T024 depend on T019 and relevant contract tests.
- T025 depends on T022–T024.
- T026 depends on T021 & T025.
- T027 depends on T026 (overlay consumes store data).
- T028 depends on T025 (styles for composed page).
- T029 depends on T003 (build tooling ready).
- T030–T031 depend on T019–T024 (unit targets implemented).
- T033 depends on all prior tasks; T032 can run after T029 and component implementations.

## Parallel Execution Example
Launch these independent tasks together after completing T003:
```
Task: "T005 Author failing contract test for GET /api/catalog/archetypes"
Task: "T006 Author failing contract test for GET /api/players/me/characters"
Task: "T007 Author failing contract test for POST /api/players/me/characters"
Task: "T008 Author failing contract test for POST /api/players/me/characters/{characterId}/select"
Task: "T009 Author failing contract test for GET /api/service-health/character"
Task: "T010 Author failing integration test for first-time player creation flow"
Task: "T011 Author failing integration test for returning player roster auto-load"
Task: "T012 Author failing integration test for outage-banner behavior"
```

## Notes
- Maintain TDD discipline: ensure contract/integration tests fail before implementing functionality.
- Keep MSW mocks aligned with OpenAPI contract; regenerate fixtures if the contract file changes.
- Respect constitutional budgets and diagnostics requirements during implementation.
- Commit after each task; include test evidence for every change.
