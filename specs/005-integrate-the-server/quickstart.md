# Quickstart: Integrated Server + Web Client

## Prerequisites
- Local infrastructure running (PostgreSQL, Redis): `./infrastructure/scripts/infra-up.sh`
- Server dependencies installed: `npm install` inside `server/`
- Web client dependencies installed: `npm install` inside `web-client/`
- External IdP token acquisition flow available (stub or dev token)

## Steps
1. Start server (dev mode): `cd server && npm run dev` (assumes existing script)  
2. Start web client: `cd web-client && npm run dev`  
3. Open browser: http://localhost:5173 (adjust if different)  
4. Authenticate: obtain dev token (paste or automatically injected)  
5. Connect: observe transition CONNECTING → ACTIVE (dev overlay)  
6. Perform movement: verify action latency overlay stays ≤200ms p95 (simulated metric)  
7. Kill network (e.g., disable adapter) for <4s then restore: state returns without duplicate movements  
8. Force version mismatch (manipulate client build version flag): connection rejected with UPDATE_REQUIRED messaging  
9. Simulate Redis down (stop container): DEGRADED state surfaced; actions still persisted  
10. Stop PostgreSQL: attempt action → user-facing pause / UNAVAILABLE message (no ack)  
11. Wait 10 minutes idle: session terminated; reconnect triggers clean resync  
12. (Optional) Run the latency budget test suite: `cd server && npx vitest run tests/integration/perf/latency-budget.spec.ts`  
13. (Optional, heavy) Execute the load harness once implemented: `cd server && npx vitest run tests/integration/load/500-concurrency.spec.ts --run` (remove `.skip` when ready)

## Expected Outcomes
- No acknowledged action lost across reconnect or server restart
- Per-action durability confirmed via ActionEvent row count increments
- Freshness enforcement: state diff delivered within 100ms window (dev instrumentation)
- Latency budget checks report p95 ≤ 200ms (see `server/tests/integration/perf/latency-budget.spec.ts`)

## Verification Commands (Optional)
```bash
# Check action events count
psql $DB_URL -c "SELECT COUNT(*) FROM action_events;"

# Tail server logs for version rejects
grep version_reject server.log | tail -20

# Inspect in-memory metrics snapshot during development
node -e "import('./dist/infra/metrics.js').then(m => console.log(m.snapshotMetrics()))"
```

## Troubleshooting
| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| Stuck CONNECTING | Token invalid | Refresh token / re-auth |
| High latency overlay | Local resource contention | Close heavy browser tabs |
| Duplicate movement | Missing idempotency sequence guard | Inspect server action handler |
| No DEGRADED state when Redis down | Health mapping incomplete | Ensure cache outage propagates status event |

## Cleanup
- Stop processes (Ctrl+C)
- `./infrastructure/scripts/infra-down.sh`

