# Interaction Contract: User Logout

Date: 2025-09-26  
Branch: 002-logout-functionality-is

## Overview
Logout is performed via Microsoft Entra ID (MSAL) redirect. No bespoke REST endpoint is added in this feature. Client responsibilities: purge sensitive state, initiate IdP logout, broadcast logout to other tabs, prevent stale protected content rendering.

## Flow Sequence (Single Tab)
1. User invokes LogoutButton (click / keypress Enter or Space).
2. Guard: if focused field dirty & non-empty → confirmation dialog (Confirm / Cancel). Cancel aborts.
3. On confirm (or if guard not triggered):
   - Record start time.
   - Purge character store & sensitive caches.
   - Emit structured dev event (optional) and write localStorage broadcast key.
   - Start 400ms delay timer → if still not redirected (network lag), show spinner.
   - Call `msalInstance.logoutRedirect` with active account.
4. Browser navigates to postLogoutRedirectUri `/`.
5. App reinitializes auth provider; no active account → public routes shown.

## Cross-Tab Propagation
- localStorage key: `tilemud.logout` value JSON `{ ts: <ISO string> }`.
- Storage event or periodic focus check triggers purge + navigation guard in other tabs if they remain on protected routes.
- No proactive fetch; lazy invalidation relies on server rejecting stale tokens.

## Structured Logout Event (Dev/Optional)
| Field | Type | Description |
|-------|------|-------------|
| eventType | string(`logout`) | Discriminator |
| timestampUTC | string | ISO timestamp |
| reason | string | `manual` fixed for this feature |
| wasOffline | boolean | Derived from `navigator.onLine === false` |
| latencyMs | number | Time from action start to purge completion |

## Error Handling
- If `logoutRedirect` throws synchronously: user state already purged → remain on public UI; display generic error banner only if user re-auth attempts fail later.
- Late async responses after purge are ignored (state cleared, FR-10).

## Accessibility Contract
- Logout control: focusable button element, accessible name `Logout` (or `aria-label` if icon-only).
- Confirmation dialog (if shown): focus trapped until user chooses action; `role="dialog"` and labelled by heading.

## Non-Goals
- No global device enumeration or forced remote session kill.
- No analytics identifier rotation.
- No persistent audit logging.

## Test Hooks
- Dev event emission enables assertion in unit/integration tests.
- Broadcast key write observable via mocked `localStorage.setItem` wrapper.
