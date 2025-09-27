# tilemud Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-09-27

## Active Technologies
- TypeScript 5.x (ES2022 target) + React 18, Vite 5, `@azure/msal-browser` (Entra ID auth), `zustand` state store, `react-router-dom`, Testing Library (001-persistent-character-creation)
- Redis (connection queues, sessions, rate limiting), WebSocket admission extensions, prom-client metrics (004-users-of-the)

## Project Structure
```
src/
tests/
```

## Commands
npm test [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] npm run lint

## Code Style
TypeScript 5.x (ES2022 target): Follow standard conventions

## Recent Changes
- 001-persistent-character-creation: Added TypeScript 5.x (ES2022 target) + React 18, Vite 5, `@azure/msal-browser` (Entra ID auth), `zustand` state store, `react-router-dom`, Testing Library
- 004-users-of-the: Added Redis-based connection admission, queue/session services, rate limiting, WebSocket reconnection, FSM state machine, prom-client metrics

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->