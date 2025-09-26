# WebSocket / Colyseus Room Contracts (Initial Draft)

## Rooms
- `arena:<id>`: Large-scale arena; messages broadcast to participants.
- `battle:<instanceId>`: Instanced tactical session.
- `guild:<guildId>`: Optional for real-time guild chat (else via other channel bus).

## Handshake
Client obtains session ticket via `/auth/session` then joins room with:
```
{
  type: "join",
  ticket: string,
  clientProtocol: { versions: ["tile.v1", "chat.v1"] }
}
```
Server responds with:
```
{
  type: "join-ack",
  serverTime: epochMillis,
  supported: ["tile.v1", "chat.v1"],
  rejected?: [string]
}
```

## Message Families
### tile.v1
| Type | Direction | Payload | Notes |
|------|-----------|---------|-------|
| place_tile | client→server | { x:int, y:int, tileType:string, seq?:int } | Collected in 100ms window |
| tile_update | server→client | { placements:[ { x, y, tileType, playerId, order } ], tick:int } | Batched authoritative commit |

### chat.v1
| Type | Direction | Payload | Notes |
|------|-----------|---------|-------|
| chat_send | client→server | { channelId, content } | Rate limited |
| chat_deliver | server→client | { channelId, msgId, seq, senderId, content, ts } | Exactly-once perceived (critical) or at-least-once (public) |

### presence.v1
| heartbeat | client→server | { ts } | Used for grace period and latency calc |
| presence_update | server→client | { playerId, state } | state: joined/left/afk |

### replay.v1
| replay_ready | server→client | { instanceId, replayId } | Emitted when persisted |

## Error Envelope
```
{ type: "error", code: string, message: string }
```
Common Codes: `unauthorized`, `rate_limited`, `validation_error`, `capacity_exceeded`.

## Flow Example (Tile Placement)
1. Client sends `place_tile`.
2. Server queues in current tick window.
3. At tick boundary, server resolves conflicts, commits, broadcasts `tile_update`.
4. Client reconciles state.

## Open Points
- Binary compression decision deferred.
- Partial reliability optimization for large arena broadcast (future).
