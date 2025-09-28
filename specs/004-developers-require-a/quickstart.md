# Quickstart: Local Infrastructure (PostgreSQL + Redis)

This guide enables any developer to bring up the required backing services for TileMUD without installing PostgreSQL or Redis natively.

## Prerequisites
- Docker Engine + Docker Compose v2 available (`docker compose version` works)
- Node 18+ installed
- Repo cloned and at branch `004-developers-require-a`

## 1. Copy Environment Example
```
cp .env.example .env
```
Adjust ports if conflicts:
```
POSTGRES_PORT=55432
REDIS_PORT=56379
```

## 2. Start Infrastructure
(Actual compose file path will be added during implementation.)
```
docker compose -f infra/docker-compose.yml up -d
```

## 3. Verify Health
```
docker compose -f infra/docker-compose.yml ps
```
Both `postgres` and `redis` should report `healthy` within ~60s. If not:
- Check logs: `docker compose -f infra/docker-compose.yml logs postgres`
- Adjust ports / remove old containers

## 4. Run Database Migration (First Time)
```
npm --prefix server run db:migrate
```
(Will execute SQL in `server/migrations/` against the running Postgres.)

## 5. Run the Server
```
npm --prefix server run dev:server
```
Server should connect using env variables (`DB_HOST`, `DB_PORT`, etc.) automatically loaded via `dotenv`.

## 6. Run the Web Client (in separate terminal)
```
npm --prefix web-client run dev
```

## 7. Execute Tests (Auto-start Helper Will Be Added)
Initially you may need to ensure infra is up (steps above). After helper introduction:
```
npm --prefix server test
```
Helper script will: start infra if missing, wait for health, continue.

## 8. Stop Infrastructure (Keep Data)
```
docker compose -f infra/docker-compose.yml down
```

## 9. Reset Infrastructure (Wipe Data)
WARNING: Destroys Postgres volume.
```
docker compose -f infra/docker-compose.yml down -v
```

## 10. Troubleshooting
| Symptom | Possible Cause | Resolution |
|---------|----------------|------------|
| Port already in use | Local service or another stack running | Change POSTGRES_PORT / REDIS_PORT in `.env` then restart |
| Health never healthy (postgres) | Slow local IO or crash loop | Check logs; increase retries (edit compose) temporarily |
| Redis flapping health | Container restarting | Inspect `docker logs`, verify no port collisions |
| Migration fails | Infra not healthy yet | Re-run after health; ensure correct credentials |

## 11. Out of Scope
- CI pipeline usage
- Production hardening (TLS, auth enhancements)

## 12. Next Steps
Proceed to implementation tasks (once generated) to add the compose file, scripts, and helper utilities that make these commands concrete.
