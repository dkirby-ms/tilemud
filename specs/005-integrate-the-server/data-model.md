# Data Model: Integrate Server, Web Client, and Backing Data Layers

## Entities

### PlayerSession (Ephemeral + Derived Durable Audit)
| Field | Type | Source | Notes |
|-------|------|--------|-------|
| session_id | uuid | generated | Unique per connection lifecycle |
| user_id | string | IdP token | Opaque external identity reference |
| character_id | uuid | persistent | Active character linkage |
| status | enum(connecting, active, reconnecting, terminating) | runtime | Drives UI states |
| last_action_seq | bigint | runtime | Highest acknowledged action sequence |
| last_heartbeat_at | timestamp | runtime | Idle timeout basis |
| protocol_version | string | client | Must match server build |
| reconnect_attempts | smallint | runtime | For policy enforcement |

### CharacterProfile (Durable)
| Field | Type | Notes |
|-------|------|-------|
| character_id | uuid (PK) | Stable identifier |
| user_id | string | Ownership boundary |
| display_name | string | Presentation only |
| position_x | int | Tile coordinate |
| position_y | int | Tile coordinate |
| health | int | Domain rule constraints TBD |
| inventory_json | jsonb | Compact serialized items |
| stats_json | jsonb | Skill/attribute map |
| updated_at | timestamp | Concurrency detection |

### ActionEvent (Durable Log / Audit)
| Field | Type | Notes |
|-------|------|-------|
| action_id | uuid (PK) | Unique action identifier |
| user_id | string | Actor |
| character_id | uuid | Character context |
| sequence_number | bigint | Monotonic per session (gap triggers resync) |
| action_type | enum(move, chat, ability, system) | Classification |
| payload_json | jsonb | Schema validated at ingress |
| persisted_at | timestamp | Durability guarantee time |

### ReconnectToken (Ephemeral / Derivable)
| Field | Type | Notes |
|-------|------|-------|
| session_id | uuid | Back-reference |
| issued_at | timestamp | Lifespan control |
| expires_at | timestamp | Security window |
| last_sequence_number | bigint | For delta replay determination |

### MetricsSnapshot (Not stored per-row; conceptual aggregation)
| Metric | Description |
|--------|-------------|
| connect_attempts_total | Counter |
| connect_success_total | Counter |
| reconnect_attempts_total | Counter |
| reconnect_success_total | Counter |
| version_reject_total | Counter |
| action_latency_ms | Histogram |
| state_refresh_forced_total | Counter |
| cache_hit_ratio | Gauge |
| active_sessions_gauge | Gauge |

## Relationships
- PlayerSession : CharacterProfile = many sessions potentially referencing one character over time (sequential, not concurrent for single user in normal flow).
- ActionEvent : CharacterProfile = many-to-one.
- ReconnectToken : PlayerSession = 1:1 (lifecycle scoped).

## State Transitions
PlayerSession.status:
- connecting → active (token validated + version lock passed)
- active → reconnecting (transient network loss detection)
- reconnecting → active (successful delta or snapshot sync)
- active/reconnecting → terminating (explicit logout or timeout)
- terminating → (removed)

## Validation / Constraints
- Version lock: protocol_version == server_build_version
- Per-action durability: ActionEvent persisted before ack → last_action_seq advanced
- Staleness window: any cached entity older than 100ms for freshness-critical fields triggers refresh
- Inventory and stats: schema validated with zod; max payload size TBD (add guard in contract)

## Derived / Indices (PostgreSQL)
- ActionEvent (character_id, sequence_number) btree for replay ordering
- ActionEvent (persisted_at) for retention management / archival
- CharacterProfile (user_id) for ownership queries

## Retention
- ActionEvent retained for 30 days (placeholder; adjust with compliance) then archived.

## Open TBD (Documented in research.md)
- Availability SLA numeric target
- Threat model elaboration
- Cache eviction parameters

## Rationale Highlights
- Sequence-based replay simpler than vector clocks for linear action stream.
- jsonb fields trade early schema rigidity for iteration speed while keeping validation at ingress.

