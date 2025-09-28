# Research: Local Docker Compose Infrastructure (PostgreSQL + Redis)

## Decision Matrix
| Topic | Decision | Rationale | Alternatives | Risks & Mitigations |
|-------|----------|-----------|-------------|---------------------|
| Compose File Location | `infra/docker-compose.yml` | Central, separated from app code; scales if more infra added later | Root-level `docker-compose.yml`; inside `server/` | Confusion about path → Document in quickstart
| Compose Version | `3.9` | Current stable; wide support | `2.x` legacy schema | None (modern Docker Desktop includes v2)
| PostgreSQL Image | `postgres:18-alpine` | Latest major (18.0 released 2025-09-25); aligns dev with current feature set | `postgres:17-alpine`, `postgres:16-alpine`, `bitnami/postgresql` | Early major adoption risk → acceptable for dev; rollback by editing tag
| Redis Image | `redis:8.2-alpine` | Latest stable 8.2 per redis.io | `redis:8-alpine`, `redis:7-alpine`, `bitnami/redis` | Potential emerging regression → can pin to patch if needed
| Healthcheck Strategy | interval=5s timeout=2s retries=12 | Bounded startup wait ~60s | Longer wait (slower feedback), shorter (flaky) | Service slow start → Developer can re-run; doc guidance
| Migration Execution | Manual `npm run db:migrate` after health | Simplicity; avoids coupling migrations to container lifecycle | Init container / entrypoint script | Forgetting to migrate → Quickstart emphasizes step
| Credentials Handling | `.env` + `.env.example` with non-sensitive defaults | Standard dev practice; no secrets committed | Hardcode in compose; generate script | Accidental commit of real creds → Git ignore guidance
| Port Overrides | `POSTGRES_PORT`, `REDIS_PORT` env vars | Developer control w/out editing compose | Dynamic free-port detection | Conflict still possible → Document troubleshooting
| Persistence | Named volume `postgres_data` | Easy reset with `down -v` | Host bind mount | Volume corruption (rare) → Reset command
| Auto-start Tests | Helper script triggers `docker compose up -d` | Transparent DX; idempotent | Require manual infra start | Mask infra failures → Script surfaces health errors clearly

## Detailed Decisions
### 1. Environment Variables
Variables placed in root `.env` for broad accessibility. Compose uses substitution; server code loads via `dotenv` (already dependency). Example file includes:
```
POSTGRES_USER=tilemud
POSTGRES_PASSWORD=tilemud
POSTGRES_DB=tilemud
POSTGRES_PORT=5432
REDIS_PORT=6379
DB_HOST=localhost
DB_PORT=${POSTGRES_PORT}
DB_USER=${POSTGRES_USER}
DB_PASSWORD=${POSTGRES_PASSWORD}
DB_NAME=${POSTGRES_DB}
REDIS_HOST=localhost
REDIS_URL=redis://localhost:${REDIS_PORT}
```

### 2. Healthchecks
Postgres: `pg_isready -U $POSTGRES_USER` (rely on image's installed client).  
Redis: `redis-cli ping | grep PONG` (ensure non-zero exit on failure).  
Fail-fast design avoids false positives—compose marks unhealthy until success.

### 3. Migration Command
Document a simple script (to be added later):
```
psql postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:$POSTGRES_PORT/$POSTGRES_DB -f server/migrations/001_initial_schema.sql
```
Will be wrapped in npm script `db:migrate` under `server/`.

### 4. Auto-start Helper
Planned TypeScript script under `server/scripts/ensureInfra.ts`:
1. Check `docker compose ps` for `postgres` & `redis` healthy.
2. If absent/unhealthy → `docker compose up -d`.
3. Poll health status every 2s until both healthy or 60s exceeded.
4. Exit non-zero with diagnostic table on timeout.

### 5. Security Considerations
- Local-only credentials, explicit disclaimer not for production.
- Encourage developers to rotate defaults if running other local stacks.
- No SSL/TLS; outside scope for dev.

### 6. Documentation Emphasis
Quickstart includes: start, verify, migrate, run server, run web client, run tests, stop, reset, port override, troubleshooting.

### 7. Out of Scope
- CI pipelines integration
- Production hardening (auth, SSL)
- Automatic schema migration on container start
- Multi-service dependency expansion (e.g., message brokers)

## Summary
All clarifications addressed. Approach is minimal, extensible, and constitution-neutral. Ready for Phase 1 design outputs.
