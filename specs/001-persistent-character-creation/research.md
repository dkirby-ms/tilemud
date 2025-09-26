# Phase 0 Research – Persistent Character Creation

## Authentication Flow (Entra ID External Identities)
- **Decision**: Use the MSAL Browser SPA redirect flow with an auth context provider that wraps the entire React app, deferring token acquisition to the existing user flow configured in the Entra tenant.
- **Rationale**: Redirect flow is explicitly supported for external identities, avoids popup blockers on mobile, and aligns with future server-side API calls once real persistence is enabled.
- **Alternatives Considered**:
  - Popup login: Rejected due to inconsistent behavior on mobile/tabs and additional UX prompts.
  - Embedding auth into mock UI: Rejected because we must exercise the actual identity flow even while data is mocked.

## Mock Persistence Strategy
- **Decision**: Represent character data through an MSW-backed mock service that serves deterministic JSON responses conforming to the planned OpenAPI contracts.
- **Rationale**: Keeps UI interactions grounded in real HTTP/WebSocket semantics while allowing offline development; MSW can be disabled later when live endpoints exist.
- **Alternatives Considered**:
  - Hard-coding JSON modules: Rejected because it bypasses network layers and would require refactoring to adopt real services.
  - LocalStorage persistence: Rejected for now to avoid implying long-term client-authoritative storage.

## Responsive Layout & Accessibility
- **Decision**: Implement a mobile-first layout using CSS grid/flex for the roster and character creation form, with 44px minimum touch targets and semantic landmarks for screen readers.
- **Rationale**: Meets responsive/mobile requirements and satisfies accessible interaction expectations with minimal CSS tooling.
- **Alternatives Considered**:
  - Desktop-first layout with breakpoints: Rejected because it increases rework for mobile readiness.

## Performance & Observability Guardrails
- **Decision**: Enforce Vite bundle analysis in CI (target <200 KB gzip), initialize lazy loading for non-critical panels, and attach a dev-only diagnostics overlay (fps, latency placeholder) per constitution.
- **Rationale**: Upholds constitutional performance budgets and keeps observability hooks visible from the first iteration.
- **Alternatives Considered**:
  - Postponing diagnostics until real-time features: Rejected to avoid violating the constitution and to ensure outage banner integration has telemetry hooks.
