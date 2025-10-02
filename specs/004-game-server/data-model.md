# Data Model (Phase 1)

Derived from feature spec & research decisions. Focus: durable persistence + conceptual runtime entities informing contracts.

## Entity Overview

| Entity | Persistence | Description |
|--------|-------------|-------------|
| Player | Postgres `players` | Registered participant with initiative rank & status |
| BattleInstance | In-memory (runtime) + Postgres outcome record only | Active room state (not persisted mid-run) |
| BattleOutcome | Postgres `battle_outcomes` | Summary results at end of instance |
| RuleSetVersion | Postgres `rulesets` | Immutable semantic rule set descriptor |
| PrivateMessage | Postgres `private_messages` | Immutable direct message with 30-day retention |
| RateLimitCounter | Redis | Rolling counters / token buckets per player/channel |
| ReconnectSession | Redis | Grace period tracking for disconnected players |
| ActionRequest | In-memory queue | Pending player or NPC actions per tick |
| ErrorCode | Static in code (future db) | Numeric stable code mapping |

## Relational Schema (Initial)

```sql
-- players
players (
  id                uuid primary key,
  display_name      text not null,
  initiative_rank   int not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index players_display_name_idx on players (lower(display_name));

-- rulesets
rulesets (
  id              uuid primary key,
  version         text not null unique, -- semantic version MAJOR.MINOR.PATCH
  created_at      timestamptz not null default now(),
  metadata_json   jsonb not null default '{}'::jsonb
);

-- battle_outcomes
battle_outcomes (
  id                uuid primary key,
  instance_id       uuid not null,
  ruleset_version   text not null,
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  duration_ms       int not null,
  participants_json jsonb not null, -- array of player stats/roles
  outcome_json      jsonb not null, -- scores, rewards
  created_at        timestamptz not null default now()
);
create index battle_outcomes_player_search_idx on battle_outcomes using gin ((participants_json -> 'players'));

-- private_messages
private_messages (
  id             uuid primary key,
  sender_id      uuid not null references players(id),
  recipient_id   uuid not null references players(id),
  content        text not null,
  created_at     timestamptz not null default now()
);
create index private_messages_recipient_idx on private_messages ( recipient_id, created_at );
create index private_messages_sender_idx on private_messages ( sender_id, created_at );

-- (Future) error_codes table if dynamic mgmt needed
```

## Runtime Structures

### Room State (BattleRoomState)
```
BattleRoomState {
  instanceId: string
  rulesetVersion: string
  board: BoardState {
    width: number
    height: number
    cells: CellState[]  // flat or 2D; each cell: { tileType: number | null, lastUpdatedTick: number }
  }
  players: Map<PlayerId, PlayerSessionState> // { status: active|disconnected, initiative, lastActionTick }
  npcs: Map<NpcId, NpcState>
  tick: number
  startedAt: number (epoch ms)
  status: active|ending|ended
}
```

### Action Pipeline
```
PendingAction {
  id: string
  type: tile_placement | npc_event | scripted_event
  priorityTier: number (npc/scripted only)
  playerInitiative?: number (tile placement)
  timestamp: number (enqueue time)
  payload: {...}
}
```

Ordering comparator (per tick batch):
1. priorityTier ascending (undefined -> +infinity)  
2. type precedence: npc/scripted before tile_placement  
3. playerInitiative descending  
4. timestamp ascending  
5. id lexicographic as final tie-breaker

### Rate Limiting Keys
```
rate:{playerId}:chat_in_instance
rate:{playerId}:private_message
rate:{playerId}:tile_action
```
Implementation: token bucket (capacity / refill) or fixed windows (initial simpler):
- chat_in_instance: window 10s, limit 20
- private_message: window 10s, limit 10
- tile_action: window 1s limit 5 + auxiliary 2s rolling (limit 10) using second key.

## Validation Rules
- Tile placement coordinates within board bounds.
- Placement legality deferred to ruleset-defined predicate (version locked).
- Disconnected players (past grace) cannot enqueue actions.
- Private message sender != recipient (initial constraint not stated but assumed; can relax later) and permission check stub (future social feature expansion).

## State Transitions (Instance)
```
created -> active -> (ending?) -> ended
             |  \-> terminated (ephemeral failure)
```
- ended triggers persistence of BattleOutcome (idempotent guard).
- terminated persists minimal outcome record flagged `terminated=true` (optional extension; initial may skip record per spec - TO CONFIRM in future feature).

## Open Questions (Deferred – Non-blocking)
- Full detailed rejection code catalog expansion.
- Whether to persist terminated instance minimal record (leaning yes for audit).

## Mapping to Functional Requirements
| FR | Data Elements Involved |
|----|------------------------|
| 001,002,003 | BattleRoomState, rulesets |
| 004,005,018,024 | Action queue, ordering comparator |
| 006,021 | npc/scripted events in queue |
| 007,014 | private_messages table |
| 008 | message ordering via per-room sequential broadcast |
| 009 | battle_outcomes table |
| 010,019 | reconnect session (Redis) + snapshot serializer |
| 011 | players map size ≤32 |
| 012,020,023 | validation layer referencing room membership & instance status |
| 013 | state transition -> ended |
| 016 | rate limiting keys |
| 017 | logging events + counters |
| 022 | static error code registry |

## Conclusion
Data model supports minimal viable implementation while deferring unnecessary mid-battle persistence and complex indexing until scale demands.
