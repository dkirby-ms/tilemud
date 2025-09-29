# tilemud Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-09-28

## Active Technologies
- TypeScript 5.x (ES2022 target) + React 18, Vite 5, `@azure/msal-browser` (Entra ID auth), `zustand` state store, `react-router-dom`, Testing Library (001-persistent-character-creation)
- Docker, Docker Compose, PostgreSQL 18, Redis 8.2, Bash scripting (003-the-developer-needs)
- TypeScript (Node.js 20 LTS) + Colyseus v0.16 (server), colyseus.js (client dependency already noted in constitution), Express 5 (HTTP API), zod (validation), pg (PostgreSQL driver), node-redis v5, pino (structured logging) (004-i-want-to)
- PostgreSQL (durable domain data + audit log metadata), Redis (ephemeral: rate limits, presence, transient locks), In-memory per-room state (authoritative runtime) (004-i-want-to)

## Project Structure
```
src/
tests/
infrastructure/
  docker-compose.dev.yml
  scripts/
  migrations/
```

## Commands
npm test [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] npm run lint
./infrastructure/scripts/infra-up.sh
./infrastructure/scripts/infra-down.sh
./infrastructure/scripts/infra-reset.sh
./infrastructure/scripts/infra-verify.sh

## Code Style
TypeScript 5.x (ES2022 target): Follow standard conventions

## Recent Changes
- 004-i-want-to: Added TypeScript (Node.js 20 LTS) + Colyseus v0.16 (server), colyseus.js (client dependency already noted in constitution), Express 5 (HTTP API), zod (validation), pg (PostgreSQL driver), node-redis v5, pino (structured logging)
- 001-persistent-character-creation: Added TypeScript 5.x (ES2022 target) + React 18, Vite 5, `@azure/msal-browser` (Entra ID auth), `zustand` state store, `react-router-dom`, Testing Library
- 003-the-developer-needs: Added Docker-based local development infrastructure with PostgreSQL and Redis, migration system, environment configuration, verification tooling, and management scripts

<!-- MANUAL ADDITIONS START -->
## Infrastructure (003-the-developer-needs)

This project includes a complete Docker-based local development infrastructure:

### Quick Start
- Start: `./infrastructure/scripts/infra-up.sh`
- Stop: `./infrastructure/scripts/infra-down.sh` 
- Reset: `./infrastructure/scripts/infra-reset.sh`
- Verify: `./infrastructure/scripts/infra-verify.sh`

### Services
- **PostgreSQL 18**: localhost:5438 (persistent data)
- **Redis 8.2**: localhost:6380 (ephemeral cache)
- **Auto-generated env**: `.env.local.infra` with connection details

### Key Features
- Idempotent startup/shutdown
- Database migration system
- Security digest verification
- Resource conflict detection
- Atomic configuration generation

### Testing
- Contract tests validate environment variables and digest verification
- Integration tests cover acceptance scenarios (currently in TDD placeholder state)
- All infrastructure scripts are fully tested and functional

### Configuration
All ports and settings can be overridden via environment variables (see `specs/003-the-developer-needs/contracts/environment-variables.md`).
<!-- MANUAL ADDITIONS END -->
