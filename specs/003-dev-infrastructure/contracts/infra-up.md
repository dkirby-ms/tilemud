# Contract: infra-up.sh

Purpose: Launch local PostgreSQL + Redis infrastructure deterministically for development and testing.

## Inputs
Environment variables (optional overrides):
- `TILEMUD_PG_PORT` (default 5438)
- `TILEMUD_REDIS_PORT` (default 6380)
- `TILEMUD_PG_USER` (default tilemud)
- `TILEMUD_PG_PASSWORD` (default tilemud_dev_pw)
- `TILEMUD_PG_DB` (default tilemud)
- `TILEMUD_INFRA_NETWORK` (default tilemud_net)
- `TILEMUD_PG_VOLUME` (default tilemud_pg_data)
- `TILEMUD_PG_IMAGE` (default postgres:18.0-alpine)
- `TILEMUD_REDIS_IMAGE` (default redis:8.2-alpine)

## Preconditions
- Docker daemon reachable
- Required ports free
- `IMAGE_DIGESTS` file present (warning if absent; verify script enforces separately)

## Behavior
1. Perform pre-flight checks (docker, resource baseline, port availability).
2. Pull images if not present.
3. Bring up docker compose stack (detached).
4. Wait for service healthchecks.
5. Execute migration wrapper (idempotent).
6. Write `.env.local.infra` file (atomic write) with connection info.
7. Print readiness summary + next steps.

## Outputs
- Exit 0 on success
- Non-zero on failure with descriptive stderr message
- `.env.local.infra` file created/updated

## Failure Modes
| Code | Condition | Message Example |
|------|-----------|-----------------|
| 10 | Docker unavailable | "ERROR: Docker daemon not reachable" |
| 11 | Port conflict | "ERROR: Port 5438 in use. Set TILEMUD_PG_PORT to override." |
| 12 | Migration failure | "ERROR: Migration failed at 003_add_index.sql" |
| 13 | Health timeout | "ERROR: Postgres did not become healthy in 30s" |

## Non-Functional
- Must complete typical startup (no migrations) < 10s on baseline machine.
- Must not prompt interactively.

## Logging
- INFO-level steps printed chronologically
- ERROR messages start with `ERROR:` prefix

## Open Items
- Optional flag `--no-verify-digests` (future) to skip warning.
