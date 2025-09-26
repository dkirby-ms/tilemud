# Research: User Logout Capability

Date: 2025-09-26  
Branch: 002-logout-functionality-is

## Decision Records

### 1. Cross-Tab Logout Propagation
- Decision: Use `localStorage` key write (e.g., `tilemud.logout` with timestamp) to signal logout; other tabs detect on focus or periodic lightweight check (or storage event) and invoke local purge.
- Rationale: Zero extra dependency, broadly supported, minimal code (<20 LOC), satisfies FR-11 lazy interaction propagation.
- Alternatives:
  - BroadcastChannel API: Cleaner API but slightly less universal; overkill here.
  - Service Worker messaging: Complexity unjustified; no offline sync needed beyond purge.
  - No propagation: Increases stale sensitive data risk until protected request made.

### 2. Unsaved Changes Guard Heuristic
- Decision: Only trigger confirmation if currently focused field is dirty & non-empty (clarified answer A).
- Rationale: Minimizes friction; spec narrows requirement; avoids scanning whole form tree.
- Alternatives: Full form dirty check (heavier), multi-step flow detection (out of current scope).

### 3. Progress Indicator Threshold
- Decision: Delay spinner until 400ms after action start (FR-07); if logout redirect fires earlier, show nothing.
- Rationale: Avoids UI flicker for fast network/local operations.
- Alternatives: Immediate spinner (noisy) or longer delay (risks perceived unresponsiveness).

### 4. State Purge Ordering
- Decision: Purge character store & sensitive caches before initiating MSAL redirect; also ensure final purge on app rehydrate if no active account.
- Rationale: Ensures FR-05 (no stale flash) and FR-09 (no residual data) even if redirect partially fails.
- Alternatives: Purge only after redirect return (risk of brief stale state exposure).

### 5. Lazy Global Invalidation Enforcement
- Decision: Rely on server token revocation on next request; do not attempt proactive remote session enumeration.
- Rationale: Matches clarification (lazy), reduces external dependency calls.
- Alternatives: Active device list fetch & termination (scope creep).

### 6. Analytics Identifier Handling
- Decision: Retain analytics/telemetry identifiers unchanged across logout (FR-09, clarification final answer) and document future rotation as potential enhancement.
- Rationale: Simplicity; rotation semantics not required yet.
- Alternatives: Rotate or drop identifiers (added complexity without requirement).

### 7. Accessibility Baseline
- Decision: Ensure logout control is keyboard focusable and has accessible name if icon-only (FR-15 clarified). Provide visible focus ring via existing CSS tokens.
- Rationale: Low overhead compliance; satisfies minimal acceptance bar.
- Alternatives: Announce sign-out via live region (explicitly not required per clarification).

## Open Questions (None)
All clarifications resolved. No residual unknowns gating design.

## Impact Summary
- Code Additions: ~1 small component (LogoutButton), one hook (useLogout), modifications to AuthProvider (local purge + broadcast), store reset integration, test cases.
- Risk: Low; relies on established MSAL logout flow.
- Rollback Plan: Remove LogoutButton + hook, revert AuthProvider additions, leaving session unchanged behavior.

## Monitoring & Diagnostics
- Structured console event (dev only) on logout: `{ type: 'logout', ts, offline, latencyMs }` to aid test verification (optionally behind DEV flag).
- Potential Future: Central analytics event pipeline.

## Security Considerations
- Ensure state purge executes even if MSAL redirects fail (try/finally pattern around pre-redirect purge).
- Avoid logging PII; user ID displayed only when already visible (profile display name).

## Performance Considerations
- Added code path is rarely invoked; negligible runtime impact.
- localStorage event listener cost is minimal; conditional registration only when authenticated.

## Alternatives Rejected as Over-Engineering
- Complex session synchronization service.
- Dedicated global sign-out across IdP device list.
- Full form dirtiness scanning with deep diff every keypress.

## Conclusion
Design choices optimize simplicity, user clarity, and adherence to the thin-client constitution while fulfilling all functional requirements with minimal surface area.
