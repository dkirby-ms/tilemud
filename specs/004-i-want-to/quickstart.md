# Quickstart: Running & Testing the Game Backend (Planned Implementation)

This guide will be validated after implementation tasks are completed. It describes the intended developer workflow for the new backend service.

## 1. Prerequisites
- Node.js 20 LTS
- Docker (PostgreSQL + Redis via existing `infrastructure` scripts) running: `./infrastructure/scripts/infra-up.sh`
- Yarn or npm (project will define package manager in future commit)

## 2. Install Dependencies (after backend folder added)
```
cd server
npm install
```

## 3. Start Dev Backend (planned)
```
npm run dev
```
Expected:
- Express HTTP server on PORT (default 4000?)
- Colyseus listens for WebSocket connections at `/colyseus`
- Health endpoint: `GET /health` returns `{ status: "ok" }`

## 4. Create / Join Battle Flow (Conceptual)
1. Client sends `create_or_join` message to BattleLobby room (or REST POST) → returns `roomId`.
2. Client connects to BattleRoom via Colyseus join.
3. Server broadcasts initial board + participants.
4. Client sends tile placement action messages: `{ op: "tile.place", x, y, tileType }`.
5. Server resolves ordering, updates state, patch diff flows to all clients.

## 5. Private Messaging Flow
1. Client issues `pm.send` message: `{ toPlayerId, content }`.
2. Server validates rate limit + permission, persists message, forwards to recipient.
3. Optional retrieval via REST: `GET /players/{playerId}/messages?since=...` (deferred until needed).

## 6. Reconnection Flow
1. Client loses connection; within 60s attempts rejoin with same session token.
2. Server validates grace window and returns fresh snapshot if accepted.
3. After 60s server purges membership; late attempt receives `grace_period_expired` error.

## 7. Running Tests (after implementation)
```
npm test
```
- Contract tests: validate OpenAPI matches endpoints.
- Integration tests: simulate multiple players joining a room and performing actions.
- Unit tests: ordering algorithm, rate limit logic.

## 8. Seed Data (Optional)
Insert baseline ruleset version:
```
insert into rulesets (id, version, metadata_json) values (gen_random_uuid(), '1.0.0', '{}');
```

## 9. Environment Variables (Planned)
```
DATABASE_URL=postgres://user:pass@localhost:5438/tilemud
REDIS_URL=redis://localhost:6380
PORT=4000
LOG_LEVEL=info
```

## 10. Error Codes
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

## 11. Future Enhancements (Beyond Slice)
- Horizontal scaling with room distribution & Redis presence.
- Metrics endpoint (Prometheus format).
- Extended error code registry in DB.
- NPC behavior scripting DSL.
- Shared type package exported to web-client.

## 12. Validation Checklist (to run post-implementation)
- Can create & join room; board state received.
- Tile placement updates broadcast <=150ms p95 locally (rough measurement via test harness timestamps).
- Precedence conflict behaves deterministically (write deterministic test scenario).
- Private message persisted & retrievable before purge window.
- Rate limits enforced with correct rejection codes.
- Reconnect <60s resumes; reconnect >60s rejected correctly.

---
This quickstart will be updated if implementation details diverge during task execution.
