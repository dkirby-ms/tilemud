# Data Model: Local Infrastructure Orchestration

Even though this feature does not introduce application-domain entities (game state, users, etc.), we formalize conceptual entities to enable consistent scripting, validation, and documentation.

## Entities

### InfraService
Represents a single docker-managed backing service.
| Field | Type | Values / Example | Notes |
|-------|------|------------------|-------|
| name | string | `postgres`, `redis` | Unique within compose file |
| image | string | `postgres:18-alpine` | Latest major (18) at plan time; reproducible via explicit tag |
| healthcheck | object | `{ cmd, interval, timeout, retries }` | Drives readiness gating |
| defaultPort | number | 5432 / 6379 | Conventional defaults |
| envPortVar | string | `POSTGRES_PORT` / `REDIS_PORT` | Override mechanism |
| persistence | boolean | true (postgres), false (redis) | Data retention expectations |
| volume | string? | `postgres_data` | Named volume for stateful services |
| state | enum | stopped, starting, healthy, unhealthy, degraded | Derived via helper script |

### EnvironmentVariableSet
Captures the resolved variable surface required by the application layer.
| Variable | Purpose | Source |
|----------|---------|--------|
| POSTGRES_USER | DB auth user | `.env` default / developer override |
| POSTGRES_PASSWORD | DB auth password | `.env` |
| POSTGRES_DB | Default database | `.env` |
| POSTGRES_PORT | Host port mapping | `.env` (numeric) |
| REDIS_PORT | Host port mapping | `.env` |
| DB_HOST | Application connection host | Hardcoded `localhost` (dev) |
| DB_PORT | Application DB port | Mirrors POSTGRES_PORT |
| DB_USER | Application DB user | Mirrors POSTGRES_USER |
| DB_PASSWORD | Application DB password | Mirrors POSTGRES_PASSWORD |
| DB_NAME | Application DB name | Mirrors POSTGRES_DB |
| REDIS_HOST | Redis connection host | `localhost` |
| REDIS_URL | Combined connection URI | Derived from host + port |

## Relationships
- One EnvironmentVariableSet binds to many InfraServices (fan-out consumption).
- InfraService state transitions inform readiness gating logic for test commands.

## State Model
```
stopped → starting → healthy → (unhealthy | degraded)
            ^             ↓          ↘
            |             └─────────── restart (compose restart policy/manual)
```
- degraded: service running but failing healthcheck intermittently (e.g., flapping)
- unhealthy: healthcheck never succeeded within timeout window

## Validation Rules
- `envPortVar` must exist in `.env.example` if referenced.
- `defaultPort` must be free OR developer provided override; detection not automated (documented responsibility).
- Healthcheck retries * interval must be ≥ expected cold start time; chosen 12 * 5s = 60s.

## Open Questions
None (all clarifications resolved).

## Future Extensions
- Add `serviceLabels` for metrics aggregation
- Optional `pgvector` or other Postgres extensions for later AI features
- Support ephemeral test network (docker compose profile)
