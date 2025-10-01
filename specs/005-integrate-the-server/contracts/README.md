# Contracts (REST + Real-time)

This folder will contain:

## REST Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/session/bootstrap | POST | Validate token + return initial state summary + version |
| /api/health | GET | Liveness/readiness summary |
| /api/version | GET | Current server build identifier |

## Real-time Messages (Colyseus Room Schema Layer)
| Direction | Type | Description |
|-----------|------|-------------|
| C→S | intent.move | Player movement request (delta or absolute) |
| C→S | intent.chat | Chat message submission |
| C→S | intent.action | Generic gameplay action wrapper |
| S→C | event.state_delta | Compressed diff of authoritative state |
| S→C | event.ack | Acknowledgment referencing sequence number |
| S→C | event.error | Structured rejection (code, reason) |
| S→C | event.degraded | Cache/dependency degradation notice |
| S→C | event.version_mismatch | Immediate disconnect + update message |

## Validation Strategy
- All intents validated with zod schemas (size, required fields, enumerations)
- Sequence numbers monotonic; out-of-order intent rejected with event.error(code=SEQ_OUT_OF_ORDER)
- Rate limits (conceptual, TBD): movement intents max 20/sec, chat 5/sec (to be enforced server-side)

## Open TBD
- Detailed field-level schema for inventory or action payloads (will evolve with domain depth)

