# Implementation Plan: Scalable Game Service Backend (003-server)

**Branch**: `003-server` | **Date**: 2025-09-26 | **Spec**: `/home/saitcho/tilemud/specs/003-server/spec.md`
**Input**: Feature specification from `/specs/003-server/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Implement a scalable, server-authoritative backend for a persistent tile placement game supporting instanced battles, large PvP arenas (up to 300 concurrent players per epic arena), social systems (guilds, parties, private chat), AI/NPC entities with elastic capacity management, replay capture (7-day retention), audit/versioned rule configs, rate limiting, and global moderation features. Delivery semantics are tiered (exactly-once user perception in critical channels, at-least-once in high-volume). Sharding hierarchy: Mode → Region → Load. Reconnect grace: 120s. AI capacity hybrid with elastic reductions based on CPU/memory thresholds.

## Technical Context
**Language/Version**: TypeScript (server + existing web client)  
**Primary Dependencies**: Colyseus (real-time session framework), Node.js runtime, WebSocket transport (Colyseus internal), likely persistence layer (NEEDS SELECTION: candidate Postgres + Redis)  
**Storage**: NEEDS DECISION (proposed: Postgres for durable data; Redis for ephemeral session state & rate limit counters; object storage for replay artifacts)  
**Testing**: Vitest / Testing Library (frontend existing); add server: vitest + supertest (or Colyseus testing utilities)  
**Target Platform**: Linux server (containerized deployment future)  
**Project Type**: Multi-part (existing frontend web-client + new backend service)  
**Performance Goals**: Arena broadcast latency p95 < 200ms; conflict resolution tick ≤ 100ms; join handshake < 1s; support 300 concurrent players in epic arena with < 5% dropped messages (at-least-once channels)  
**Constraints**: Reconnect grace 120s; AI elastic thresholds (CPU>75% or Mem>70% for 3×10s); rate limits Chat 20/10s, Actions 60/10s; replay retention 7d; chat retention tiered  
**Scale/Scope**: Hundreds of concurrent players across multiple shards; epic arena up to 300; up to 100 AI entities per epic arena (elastic reductions possible)

Unknowns to resolve in research (Phase 0):
- Confirm persistence technology choice (Postgres vs alternative, schema migration tool)
- Replay artifact format (JSON event log vs binary delta stream)
- Message schema versioning strategy
- Rate limit storage backend (Redis vs in-memory + eventual cluster) for horizontal scale
- Observability stack (OpenTelemetry? minimal custom JSON logs?)
- Security: auth integration with existing client (token shape, session handshake)

## Constitution Check
The constitution provided targets the web client (thin client, server authoritative). Plan compliance:
- Server authoritative model preserved (all conflict resolution on server) ✔
- Real-time diff/compact messaging: Will design domain events & deltas in contracts ✔ (detail pending Phase 1)
- TypeScript strict across server code ✔ (to be enforced in tsconfig)
- Diagnostics: latency p95, actions/sec surfaced via metrics endpoints ✔
Potential deviations: None at this stage.  
Gate Status (initial): PASS

## Project Structure

### Documentation (this feature)
```
specs/003-server/
├── spec.md
├── plan.md
├── research.md        (Phase 0)
├── data-model.md      (Phase 1)
├── quickstart.md      (Phase 1)
├── contracts/         (Phase 1)
└── tasks.md           (Phase 2 - later)
```

### Source Code (proposed backend addition)
```
server/
  src/
    domain/
      entities/        # Player, Guild, Instance, Arena, Replay, ChatMessage
      value-objects/
      events/          # Domain & integration events
    infra/
      persistence/     # Repositories (Postgres adapters)
      cache/           # Redis clients (rate limiting, presence)
      messaging/       # Colyseus room setup & transport wrappers
      monitoring/      # Metrics + logging
    application/
      services/        # Use cases (join arena, place tile, create guild)
      commands/        # Command handlers (optional CQRS style if needed)
    api/
      http/            # REST endpoints (discovery, admin, auth handshakes)
      ws/              # Colyseus room handlers & schema definitions
    config/
    bootstrap/
  tests/
    contract/
    integration/
    unit/
```

**Structure Decision**: Extend existing monorepo with a `server/` directory encapsulating backend; keep existing `web-client/` untouched except for future protocol alignment.

## Phase 0: Outline & Research
Will generate `research.md` capturing decisions for: storage stack (Postgres + Redis), replay format, rate limiting implementation strategy, observability & metrics, schema versioning, security handshake. Each unknown becomes a Decision record.

## Phase 1: Design & Contracts
- `data-model.md`: Entities with fields & relationships (Player, Guild, BlockListEntry, Instance, Arena, AIEntity, ChatChannel (typed), Message, ReplayMetadata, RateLimitBucket, RuleConfigVersion)
- `contracts/`: HTTP + WebSocket contract definitions (OpenAPI fragments or minimal YAML + Colyseus room message schemas)
- Contract tests: placeholder failing tests referencing endpoints (join arena, create guild, send chat, place tile, reconnect, fetch replay)
- `quickstart.md`: Steps: install deps, run server (dev), run tests, simulate joining an arena from a mock client script.
- Update agent context file for new backend tech specifics.

## Phase 2: Task Planning Approach
(Descriptive only; tasks.md not generated now)  
Mapping: Each FR → at least one contract + test; AI elasticity & metrics produce additional infra tasks; security handshake tasks precede gameplay features; replay & audit after core session flows stable.

## Phase 3+: Future Implementation
(As template) No change.

## Complexity Tracking
Currently no constitution violations requiring justification.

## Progress Tracking
**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - approach documented)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented (N/A)

---
*Based on Constitution v1.0.0 (web client) with backend alignment policies introduced here*
