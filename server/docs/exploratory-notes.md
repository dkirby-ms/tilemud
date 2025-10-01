# Exploratory Testing Notes – 2025-09-30

## Environment
- Workspace: `tilemud/server`
- Node: 20.x (project requirement) – executed via `npx vitest`
- External services: Postgres/Redis not started for this session (contract/unit tests use pooled clients with test harness stubs).

## Sessions
1. **API Contract Sweep**
   - Command: `npx vitest run tests/contract`
   - Focus: health, error catalog, players outcomes/messages endpoints.
   - Result: Pass. Verified Redis/Postgres connection bootstrap logs emitted once per spec via shared test harness.

2. **Domain Service Focus**
   - Command: `npx vitest run tests/unit`
   - Focus: rate limiter edge windows, reconnect grace expiry, action pipeline ordering, ruleset normalization.
   - Result: Pass. Observed deterministic ordering assertions succeeding (e.g., `ordering.comparator`, `action.pipeline`).

3. **Coverage Probe**
   - Command: `npx vitest run tests/unit tests/contract --coverage`
   - Observation: All suites pass, but coverage providers report 0% (see `coverage-summary.md`). Root cause under investigation.

## Not Executed (Pending)
- **Integration Harness**: Instances, chat, reconnect E2E flows still scaffolded with `expect.fail(...)`. Requires full Colyseus runtime simulation and infrastructure backing services.
- **Quickstart Validator**: `npm run validate:quickstart` skipped because Docker infra was not running; would fail to connect to Postgres/Redis in current session.
- **Latency Harness**: Deferred until integration scenarios are implemented.

## Issues & Follow-ups
- Coverage instrumentation gap blocks visibility into critical-path metrics. See follow-up plan in `coverage-summary.md`.
- Need to script selective integration skips or provide mock runtime to unblock coverage runs without modifying placeholder specs.
- Recommend future exploratory pass once integration harness lands to validate room lifecycle, chat rate limiting, and reconnect behaviors end-to-end.
