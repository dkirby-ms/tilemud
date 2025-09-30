# TileMUD Server

Authoritative backend for the TileMUD real‑time multiplayer tile game. Combines:

- Colyseus (WebSocket real‑time rooms) for Battle + Lobby rooms
- Express 5 HTTP API (health, outcomes, private messages, error catalog)
- PostgreSQL for durable domain data (players, outcomes, messages, rulesets)
- Redis for ephemeral state (rate limits, reconnect sessions)
- Pino structured logging
- TypeScript (Node.js 20, ESM, strict) + Vitest test harness

## Quick Start (Local Dev)

Prereqs: Docker (for infra scripts), Node.js 20.x, GNU bash.

```bash
# 1. Start infra containers (Postgres, Redis) from repo root
./infrastructure/scripts/infra-up.sh

# 2. Install dependencies
cd server
npm install

# 3. Build & run migrations + seed baseline rule set
npm run build
npm run migrate
npm run seed:ruleset

# 4. Start dev server (auto‑reload)
npm run dev
```

The server listens on `PORT` (default 4000). Real‑time Colyseus rooms share the same HTTP port.

## Environment Variables
| Name | Required | Description |
| ---- | -------- | ----------- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | Yes | HTTP/WS listen port |
| `LOG_LEVEL` | No  | Pino log level (default info) |
| `LOG_PRETTY` | No | If `true`, enable pino-pretty transport |

Misconfiguration produces a startup error (see `config.ts` / env contract test).

## Data Model (Summary)
- `players` (id, display name, initiative rank)
- `rulesets` (version + metadata JSON)
- `battle_outcomes` (instance results + participants/outcome JSON)
- `private_messages` (sender/recipient/content timestamps)

See migrations `001_init.sql` & `002_game_backend.sql` for full DDL.

## Core Services
| Service | Responsibility |
| ------- | -------------- |
| RateLimiterService | Sliding window limits (Redis) for actions & messages |
| ReconnectService | Grace period reconnect sessions (Redis) |
| MessageService | Private message send/list/purge + rate limiting |
| OutcomeService | Battle outcome persistence & retrieval |
| RuleSetService | Rule set version resolution / latest lookup |
| SnapshotService | State snapshot & per‑player view extraction |
| ActionPipeline | Queue + ordering + rate limit enforcement |

## Rooms
- `BattleRoom`: Validates & applies actions, broadcasts resolutions, manages reconnect windows, produces snapshots.
- `LobbyRoom`: Creates or matches players into battle instances, picking a ruleset version.

## Logging
Structured JSON via `pino`. Each logical subsystem uses child logger context (`scope` field) where integrated.
Enable pretty output: `LOG_PRETTY=true`.

## Scripts
| Purpose | Command |
| ------- | ------- |
| Run migrations | `npm run migrate` |
| Seed baseline ruleset | `npm run seed:ruleset` |
| Purge old messages | `npm run purge:messages` |
| Generate OpenAPI types | `./scripts/generate-openapi-types.sh` |
| Latency harness (WIP) | `npm run latency:harness` (after T066) |
| Quickstart validator (WIP) | `npm run validate:quickstart` (after T067) |

## Testing Strategy
- Contract tests assert HTTP surface matches OpenAPI spec and config constraints.
- Unit tests isolate services with in‑memory / mock Redis & repositories.
- Integration (future) exercise end‑to‑end room flows (currently placeholders to be implemented incrementally).
- Performance probes (ordering comparator) guard against regressions in core scheduling path.

Run all:
```bash
npm test
```

## Adding a New Rule Set
1. Author metadata & rules object shape.
2. Insert via repository or extend seed script.
3. Restart server (or call a future admin endpoint) to register.

## Reconnect Semantics
- Disconnect triggers session creation with grace period (default 60s).
- Reconnect attempts beyond grace throw `GRACE_PERIOD_EXPIRED` TileMudError.
- Extending grace period is possible through `ReconnectService.extendGracePeriod` (future admin tool).

## OpenAPI Contract Sync
`openapi.sync.spec.ts` ensures generated `api-types.d.ts` contains a signature marker. Run regeneration if test fails.

## Roadmap (Excerpt)
- Implement integration test harness for Colyseus rooms.
- Latency harness script simulating multi‑client load.
- Security hardening checklist completion & automated checks.
- Coverage target ≥ 80% (critical paths) before sign‑off.

---
*This README generated as part of T064.*
