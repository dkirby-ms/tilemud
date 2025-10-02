# Quickstart: Local Developer Data Infrastructure

This guide explains how to start, verify, use, and reset the local PostgreSQL + Redis infrastructure introduced by feature branch `003-the-developer-needs`.

## 1. Prerequisites
- Docker Engine / Docker Desktop running
- Bash shell available
- Sufficient resources (recommended ≥1 CPU free, ≥512MB RAM free, ≥500MB disk)

## 2. Default Ports & Overrides
| Service | Default Port | Override Env Var |
|---------|--------------|------------------|
| PostgreSQL | 5438 | `TILEMUD_PG_PORT` |
| Redis | 6380 | `TILEMUD_REDIS_PORT` |

If a port is busy, startup fails fast with an error showing an override example.

## 3. One-Step Startup
(Once implemented) run:
```
./infrastructure/scripts/infra-up.sh
```
This will:
1. Pre-flight check Docker, ports, minimal resources.
2. Pull required images if absent.
3. Launch containers via docker compose.
4. Wait for healthchecks.
5. Apply migrations idempotently.
6. Generate `.env.local.infra` with connection details.
7. Print readiness summary.

## 4. Connection Details
After success, inspect `.env.local.infra`:
```
TILEMUD_PG_PORT=5438
TILEMUD_PG_USER=tilemud
TILEMUD_PG_PASSWORD=tilemud_dev_pw
TILEMUD_PG_DB=tilemud
TILEMUD_REDIS_PORT=6380
```
Source it if desired:
```
source .env.local.infra
```

## 5. Running Tests
Ensure infra is up, then:
```
npm test
```
If infra is down, certain tests will fail fast with guidance to run the startup script.

## 6. Verifying Image Integrity
Run:
```
./infrastructure/scripts/infra-verify.sh
```
Expected output includes pinned tags:
- postgres:18.0-alpine
- redis:8.2-alpine

If digest mismatch: script exits non-zero with remediation instructions.

## 7. Stopping Infrastructure
```
./infrastructure/scripts/infra-down.sh
```
This stops containers but preserves the Postgres volume.

## 8. Resetting (Full Teardown)
```
./infrastructure/scripts/infra-reset.sh
```
Removes containers and the Postgres named volume (`tilemud_pg_data`). Redis is ephemeral by design.

## 9. Updating Image Digests (Manual Workflow)
1. Pull latest images: `docker pull postgres:18.0-alpine && docker pull redis:8.2-alpine`.
2. Run future helper (planned) `./infrastructure/scripts/update-digests.sh` or manually inspect digests:
   `docker image inspect postgres:18.0-alpine --format '{{json .RepoDigests}}'`.
3. Update `infrastructure/IMAGE_DIGESTS` and commit.
4. Run `infra-verify.sh` to confirm.

## 10. Transactional Test Isolation (Future)
A placeholder helper currently logs a warning. Real per-test transaction rollback will be added when a backend DB access layer is introduced.

## 11. Platform Notes
- macOS: Use Docker Desktop (colima should work but not formally tested yet).
- Windows: Use WSL2 with Docker integration; performance may vary for volume I/O.

## 12. Troubleshooting
| Symptom | Cause | Action |
|---------|-------|--------|
| Startup script exits: port in use | Conflict with local service | Export override env var & retry |
| Verify script fails digest check | Upstream tag mutated or local image stale | Pull, update digest file intentionally |
| Tests hang on DB connection | Infra not running | Run `infra-up.sh` then retry |
| Migration aborted mid-run | SQL error in new file | Fix SQL, remove partial entry from ledger (see logs), re-run |

## 13. Security Reminder
Redis runs without authentication and is intended for local isolation only. Do **not** expose these containers to public interfaces.

---
End of Quickstart.
