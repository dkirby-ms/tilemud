# Quickstart: Verifying User Logout Capability

This guide provides manual and automated test flows to validate the logout feature.

## Pre-Requisites
- Running dev server: `npm run dev` from `web-client/`.
- Test user able to authenticate via Entra ID.
- At least one character created (optional for purge visibility).

## Smoke Test Steps
1. Authenticate and land on character dashboard.
2. Open DevTools console; note absence of logout events.
3. Click `Logout` button.
4. EXPECT immediate navigation to public landing (login screen) with no success banner.
5. EXPECT character store reset (no residual roster in memory on re-auth reinitialize).

## Unsaved Changes Guard
1. Log in and focus a text input (e.g., character creation name field) - type a non-empty value (do not submit).
2. While focus remains in that dirty field, click `Logout`.
3. EXPECT confirmation dialog with clear message about unsaved changes.
4. Cancel → remain authenticated; data still present.
5. Invoke logout again, Confirm → proceed to public landing.

## Multi-Tab Scenario
1. Log in (Tab A). Duplicate the tab (Tab B) confirming both authenticated.
2. In Tab A, click `Logout`.
3. EXPECT Tab A navigates to public landing.
4. In Tab B, BEFORE interaction, still shows protected UI (allowed).
5. Click anywhere or attempt navigation in Tab B.
6. EXPECT Tab B transitions to public landing and state purged.

## Offline Scenario
1. Log in.
2. Simulate offline (disable network or set `navigator.__defineGetter__('onLine', () => false)` if feasible in test harness).
3. Click `Logout`.
4. EXPECT local purge & public landing even without remote confirmation.

## Back Navigation Protection
1. After logging out, press browser Back.
2. EXPECT no protected data flashes; remain on public landing (route guard re-check + cleared store).

## Double Click / Idempotency
1. Log in.
2. Rapidly double-click `Logout`.
3. EXPECT a single redirect, no errors, no duplicate events.

## Progress Indicator Threshold
1. (Optional) Artificially delay `logoutRedirect` promise (MSW or monkey patch) >400ms.
2. EXPECT spinner or status to appear after 400ms, then redirect when continue.

## Structured Event (Dev Observability)
- On logout, a dev-only console log with `eventType: 'logout'` appears; can be asserted in tests.

## Integration Test Mapping
| Scenario | Test Type | Test File | Notes |
|----------|-----------|-----------|-------|
| Standard logout | Integration | `tests/integration/logout.standard.spec.ts` | Assert redirect + purge |
| Unsaved changes guard | Integration | `tests/integration/logout.unsaved.spec.ts` | Simulate focused dirty field |
| Multi-tab propagation | Unit + Integration | `tests/unit/logoutListener.spec.ts` + cross-tab test | Use jsdom + storage event simulation |
| Offline logout | Integration | `tests/integration/logout.offline.spec.ts` | Force offline flag |
| Back navigation | Integration | `tests/integration/logout.backnav.spec.ts` | Simulate history back after purge |
| Idempotent double click | Unit | `tests/unit/logoutIdempotent.spec.ts` | Rapidly invoke handler |
| Event emission shape | Unit | `tests/unit/logoutEvent.spec.ts` | Validate object fields |
| localStorage broadcast | Unit | `tests/unit/logoutBroadcast.spec.ts` | Spy on localStorage.setItem |
| Cross-tab listener | Unit | `tests/unit/logoutListener.spec.ts` | Storage event handling |
| Focused dirty guard | Unit | `tests/unit/focusedDirtyGuard.spec.ts` | Form element dirty detection |
| Character store purge | Unit | `tests/unit/logoutPurge.spec.ts` | Store reset behavior |

## Failure Recovery
- If logout error surfaces, user already appears logged out (fail-secure). Re-login path tested by standard auth flows.

## Future Enhancements (Not in Scope)
- Device list remote termination.
- Analytics identifier rotation test.
- Persistent audit logging validation.
