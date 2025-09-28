# Developer Infrastructure Contract

Defines the operational interface for local infrastructure (PostgreSQL + Redis) required by TileMUD developers.

## Scope
Only local development. Not a production deployment specification. No CI stability guarantees.

## Services
| Service | Image | Default Port | Override Var | Persistence | Health Command | Ready Criteria |
|---------|-------|--------------|--------------|-------------|----------------|----------------|
| postgres | postgres:18-alpine | 5432 | POSTGRES_PORT | Yes (named volume `postgres_data`) | `pg_isready -U $POSTGRES_USER` | Exit 0 within 60s |
| redis | redis:8.2-alpine | 6379 | REDIS_PORT | No | `redis-cli ping | grep PONG` | Returns PONG within 60s |

## Environment Variables
See `.env.example` (to be added). Variables must be read by server via `dotenv` at startup.

Required set for application:
```
DB_HOST=localhost
DB_PORT=${POSTGRES_PORT}
DB_USER=${POSTGRES_USER}
DB_PASSWORD=${POSTGRES_PASSWORD}
DB_NAME=${POSTGRES_DB}
REDIS_HOST=localhost
REDIS_PORT=${REDIS_PORT}
REDIS_URL=redis://localhost:${REDIS_PORT}
```

## Commands (Documented Workflow)
| Action | Command | Notes |
|--------|---------|-------|
| Start | `docker compose -f infra/docker-compose.yml up -d` | Creates volume, starts services |
| Status | `docker compose -f infra/docker-compose.yml ps` | Shows health states |
| Stop | `docker compose -f infra/docker-compose.yml down` | Preserves volume |
| Reset | `docker compose -f infra/docker-compose.yml down -v` | Destroys Postgres data |
| Logs | `docker compose -f infra/docker-compose.yml logs -f postgres` | Service-specific logs |
| Migrate | `npm --prefix server run db:migrate` | Manual, after health |

## Readiness Semantics
A service is considered ready when compose reports `healthy`. Test helper will poll up to 60s (12 * 5s). Failure to reach healthy state aborts test run with diagnostic guidance.

## Failure Modes
| Mode | Detection | Developer Action |
|------|-----------|------------------|
| Port conflict | Container exits; unhealthy | Adjust override vars in `.env` |
| Migration fails | Non-zero exit | Verify health/logs; rerun |
| Redis flapping | Repeated unhealthy states | Check host resources; restart stack |
| Volume corruption | Postgres crashes repeatedly | Reset with `down -v` (data loss) |

## Non-Goals
- Automatic migrations
- High availability
- Securing credentials (beyond basic placeholders)
- TLS encryption

## Acceptance Mapping
| Functional Requirement | Contract Element |
|------------------------|------------------|
| FR-001, FR-010 | Compose file with only postgres & redis, v3.9 syntax |
| FR-002, FR-011 | Port override vars in `.env.example` |
| FR-003 | Redis runs no password; note future option |
| FR-004, FR-005 | Named volume + reset command |
| FR-006 | Quickstart + this contract |
| FR-007 | Environment variable set documented |
| FR-008, FR-016 | Healthcheck definitions + polling limits |
| FR-009 | Example-only creds, no secrets |
| FR-012 | Manual migration command |
| FR-013 | Pure Docker/Compose solution |
| FR-014 | Future helper script (auto-start) |
| FR-015 | CI exclusion noted |

## Change Control
Any modification to images, ports, or health semantics must update:
1. `infra/docker-compose.yml`
2. `.env.example`
3. `quickstart.md`
4. This contract file

## Open Issues
None.
