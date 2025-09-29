# Contract: infra-down.sh

Purpose: Stop running infrastructure containers without removing persistent Postgres volume.

## Inputs
Optional environment overrides (same as `infra-up.sh` for naming consistency). No required args.

## Behavior
1. Detect running containers (names: `tilemud_postgres`, `tilemud_redis` or env overrides).
2. If none running: exit 0 with notice.
3. Run `docker compose down` (non-volume destructive).
4. Print summary of stopped services.

## Outputs
- Exit 0 success or no-op
- Non-zero only on docker errors

## Failure Modes
| Code | Condition | Message |
|------|-----------|---------|
| 20 | Docker unavailable | "ERROR: Docker daemon not reachable" |

## Logging
- INFO lines for each container stopped.

## Notes
- Volume retained to preserve Postgres data (FR-012).
