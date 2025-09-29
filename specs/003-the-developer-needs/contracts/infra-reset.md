# Contract: infra-reset.sh

Purpose: Perform full teardown including removal of Postgres persistent volume for a clean slate (FR-006).

## Behavior
1. Invoke `infra-down` logic (stop containers if running).
2. Remove Postgres named volume (`tilemud_pg_data` or override).
3. Remove migration ledger file/directory if present.
4. Print confirmation and hints to re-run `infra-up`.

## Failure Modes
| Code | Condition | Message |
|------|-----------|---------|
| 30 | Docker unavailable | "ERROR: Docker daemon not reachable" |
| 31 | Volume removal error | "ERROR: Failed removing volume tilemud_pg_data" |

## Safety
- Prompts not allowed; non-interactive. Use `--force` not required; always proceeds.

## Outputs
- Exit 0 success; non-zero on error.

## Notes
- Redis data inherently cleared by container stop (ephemeral).
