# TileMUD Web Client Constitution

This constitution defines the minimum, non-negotiable requirements for the Vite-based web client of the massively multiplayer tile placement game ("TileMUD"). It governs architecture, quality bars, and delivery gates to ensure a fast, resilient, and accessible client.

## Core Principles

### I. Thin Client, Server-Authoritative
- The server is the source of truth. The client issues intents and renders confirmed state.
- Client-side logic is limited to presentation, input handling, prediction (optional), and reconnection.
- All game-critical validation occurs on the server.
- The server uses [colyseus.js](https://docs.colyseus.io/server).

### II. Real-time First, Efficient by Default
- Networking is WebSocket-based; messages are compact and diff-oriented where possible.
- Rendering uses a single HTML Canvas 2D context (or WebGL if required later) with culling to draw only visible tiles.
- Budgets exist for bundle size, network, CPU, and memory; changes must stay within them unless explicitly amended.

### III. Type-Safe, Testable, and Observable
- TypeScript everywhere with strict type-checking enabled.
- Unit tests for protocol handling, rendering helpers, and state reducers are mandatory.
- Basic in-client diagnostics (FPS, network latency, reconnect state) are available in dev builds.

## Governance
- This constitution supersedes other practices for the web client.
- Amendments require: a written proposal, explicit budget/impact statement, and approval by maintainers.
- PR checklist must include a link or reference showing compliance with: Networking, Rendering, State, Budgets.
- Any exception is temporary and must include a rollback date or follow-up issue.

**Version**: 1.0.0 | **Ratified**: 2025-09-25 | **Last Amended**: 2025-09-25