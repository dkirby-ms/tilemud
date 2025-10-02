# Quickstart: Running & Testing the Game Backend

Updated after automation (T067) & latency harness (T066). This reflects the **current implemented** backend workflow.

## 1. Prerequisites
| Requirement | Notes |
| ----------- | ----- |
| Node.js 20 LTS | ESM + TS strict build |
| Docker | Required for local Postgres + Redis infra scripts |
| Bash (GNU) | Infra & generation scripts |

Start infra (PostgreSQL 18 + Redis 8.2) from repo root:
```bash
./infrastructure/scripts/infra-up.sh
```
On success a `.env.local.infra` file is generated. Source it (or export the variables) before running the server:
```bash
set -a; source ./.env.local.infra; set +a
```

## 2. Install Dependencies
```bash
cd server
npm install
```

## 3. Build, Migrate & Seed
We compile first so runtime scripts exist in `dist/`.
```bash
npm run build
npm run migrate          # applies SQL files in infrastructure/migrations (idempotent)
npm run seed:ruleset     # inserts baseline ruleset version 1.0.0 (idempotent)
# pass "-- --version X.Y.Z --metadata path/to/file" to publish an alternate ruleset
```

## 4. Start Dev Backend
```bash
npm run dev
```
Expected (logs):
- `infra.postgres.initialized`, `infra.redis.initialized`
- `migrations.applied`
- `server.start { port: <PORT> }`

HTTP / WS Surface:
- Health: `GET /health` → `{ status: "ok", uptimeMs, ... }`
- Outcomes: `GET /outcomes/:id`
- Player outcomes: `GET /players/:playerId/outcomes`
- Player messages: `GET /players/:playerId/messages`
- Error catalog: `GET /errors/catalog`

Realtime Rooms (Colyseus):
- `lobby` (matchmaking / create instance)
- `battle` (active battle instances)

## 5. Create / Join Battle Flow (Implemented Shape)
1. Join `lobby` room (Colyseus) and send message `instance.create_or_join` with payload:
  ```json
  { "mode": "solo", "requestId": "r1" }
  ```
2. Receive `instance.ready` → contains `instanceId`, `roomId` (battle room id), `rulesetVersion`.
3. Join the `battle` room with `{ playerId: "p123" }`.
4. Receive initial `snapshot.update` (board + players).
5. Submit tile placement via message `action.submit` payload (simplified):
  ```json
  {
    "id": "a1",
    "type": "tile_placement",
    "instanceId": "<battle-instance-id>",
    "playerId": "p123",
    "playerInitiative": 10,
    "timestamp": 0,
    "payload": { "position": { "x": 1, "y": 2 }, "tileType": 3 }
  }
  ```
6. Expect `action.applied` broadcast with tick & effects or `action.rejected`.

## 6. Private Messaging Flow (HTTP Retrieval)
1. (Realtime send TBD future slice.)
2. Persisted messages query: `GET /players/:playerId/messages?direction=inbound|outbound&since=<ISO>&limit=50`.
3. Rate limiting enforced; rejection returns standardized error payload.

## 7. Reconnection Flow
1. Client loses connection; within 60s attempts rejoin with same session token.
2. Server validates grace window and returns fresh snapshot if accepted.
3. After 60s server purges membership; late attempt receives `grace_period_expired` error.

## 8. Running Tests
```bash
npm test
```
Layers:
- Contract: OpenAPI signature & endpoint behaviors.
- Unit: services (rate limiter, reconnect, message, ordering, snapshot, validation).
- Integration placeholders (scaffolded, some assertions may be TODO while slice evolves).
- Performance probe: ordering comparator (ensures sort under threshold).

## 9. Seeding & Purge Utilities
| Action | Command |
| ------ | ------- |
| Idempotent baseline ruleset (v1) | `npm run seed:ruleset` |
| Purge aged private messages (30d default) | `npm run purge:messages` |

## 10. Environment Variables
These are generated automatically by infra scripts (`.env.local.infra`). Minimal set:
```
DATABASE_URL=postgres://tilemud:tilemud@localhost:5438/tilemud
REDIS_URL=redis://localhost:6380
PORT=4000
LOG_LEVEL=info
LOG_PRETTY=true
```
Load manually if not exporting automatically.

## 11. Error Codes
Returned error payload shape:
```
{
  "numericCode": "E1002",
  "reason": "precedence_conflict",
  "category": "conflict",
  "retryable": false,
  "humanMessage": "errors.precedence_conflict"
}
```

## 12. Tooling & Automation
| Purpose | Script |
| ------- | ------ |
| OpenAPI types sync | `./server/scripts/generate-openapi-types.sh` |
| Quickstart validator (starts server, seeds, joins) | `npm run validate:quickstart` |
| Latency harness (multi-client snapshot RTT) | `npm run latency:harness` |

Latency harness environment overrides:
```
HARNESS_CLIENTS=10 HARNESS_SNAPSHOT_ROUNDS=10 npm run latency:harness
```

Sample output snippet:
```json
{
  "handshake": { "p95": 42.1, "average": 37.0, "count": 10 },
  "snapshotRtt": { "p95": 15.3, "average": 11.2 }
}
```

## 13. Future Enhancements (Beyond Slice)
- Horizontal scaling with room distribution & Redis presence.
- Metrics endpoint (Prometheus format).
- Extended error code registry in DB.
- NPC behavior scripting DSL.
- Shared type package exported to web-client.

## 14. Validation Checklist
- Can create & join room; board state received.
- Tile placement updates broadcast <=150ms p95 locally (rough measurement via test harness timestamps).
- Precedence conflict behaves deterministically (write deterministic test scenario).
- Private message persisted & retrievable before purge window.
- Rate limits enforced with correct rejection codes.
- Reconnect <60s resumes; reconnect >60s rejected correctly.

---
Generated & maintained by automation tasks (T064, T066–T068). Update when contract / flows change.
