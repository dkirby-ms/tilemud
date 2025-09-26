# Quickstart: Scalable Game Service Backend (003-server)

## Prerequisites
- Node.js LTS (>=18)
- PostgreSQL & Redis running locally (docker-compose suggested; config TBD)

## Install
```
# (Backend directory to be created) placeholder
npm install
```

## Run Dev Server (placeholder until backend scaffold exists)
```
npm run dev:server
```

## Auth Session Flow (Simulated)
1. POST /auth/session with client token → receive session ticket.
2. Join Colyseus room `arena:<id>` using ticket.
3. Send `place_tile` messages; observe `tile_update`.

## Rate Limit Test
Rapidly send >20 chat messages in 10s → expect `rate_limited` error envelope.

## Replay Retrieval
After instance resolves, GET /replays/{id} returns metadata; (future) stream events.

## Next Steps
- Implement backend scaffolding in `server/`.
- Flesh out automated integration tests referencing contracts.
