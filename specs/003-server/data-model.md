# Data Model: Scalable Game Service Backend (003-server)

## Conventions
- `id` fields are UUIDv7 unless otherwise noted.
- Timestamps are ISO-8601 UTC.
- Denormalize selective counters (e.g., guild member count) for performance with triggers/job reconciliation.

## Entities

### Player
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Account identity (global) |
| displayName | string | Unique handle or nickname (scope TBD) |
| createdAt | datetime |  |
| lastLoginAt | datetime |  |
| status | enum(active, banned, dormant) |  |
| blockListVersion | int | Increment when block list changes |

### Guild
| Field | Type | Notes |
| id | UUID |  |
| name | string | Global unique (case-insensitive), reserved post-delete 30d |
| leaderPlayerId | UUID | FK Player |
| createdAt | datetime | |
| deletedAt | datetime? | If soft-deleted |
| memberCount | int | Cached |

### GuildMembership
| Field | Type | Notes |
| playerId | UUID | PK part |
| guildId | UUID | PK part |
| role | enum(leader, officer, veteran, member) | |
| joinedAt | datetime | |

### BlockListEntry
| Field | Type | Notes |
| ownerPlayerId | UUID | PK part |
| blockedPlayerId | UUID | PK part |
| createdAt | datetime | |

### Instance (Battle)
| Field | Type | Notes |
| id | UUID | |
| mode | enum(battle) | Distinguish from arena |
| state | enum(pending, active, resolved, aborted) | |
| createdAt | datetime | |
| startedAt | datetime? | |
| resolvedAt | datetime? | |
| ruleConfigVersion | string | FK RuleConfigVersion.versionId |
| replayId | UUID? | FK ReplayMetadata.id |
| initialHumanCount | int | For quorum/abort logic |
| shardKey | string | Mode|Region|ShardIndex composite |

### Arena
| Field | Type | Notes |
| id | UUID | |
| tier | enum(small, large, epic) | Cap enforces | 
| currentHumanCount | int | |
| currentAICount | int | |
| region | string | Geographic label |
| shardKey | string | Mode|Region|ShardIndex |
| createdAt | datetime | |

### AIEntity
| Field | Type | Notes |
| id | UUID | |
| instanceId | UUID? | FK Instance | 
| arenaId | UUID? | FK Arena |
| type | string | Behavior classification |
| spawnedAt | datetime | |
| despawnedAt | datetime? | |

### TileBoard (Logical)
Stored via events and derived state; minimal persistent snapshot optional for optimization.

### ChatChannel
| Field | Type | Notes |
| id | UUID | |
| channelType | enum(private, guild, party, arena, system) | |
| scopeRef | UUID? | e.g., guildId, arenaId |
| retentionPolicy | enum(private7d,guild7d,party24h,public12h,system30d) | Materialized from type |

### ChatMessage
| Field | Type | Notes |
| id | UUID | |
| channelId | UUID | FK ChatChannel |
| senderPlayerId | UUID | FK Player |
| seq | bigint | Monotonic per-channel sequence |
| createdAt | datetime | |
| content | text | Sanitized/validated |

### ReplayMetadata
| Field | Type | Notes |
| id | UUID | |
| instanceId | UUID | FK Instance |
| createdAt | datetime | |
| sizeBytes | int | Gz size |
| expiresAt | datetime | Purge after 7d |
| storageRef | string | Path or object key |

### RuleConfigVersion
| Field | Type | Notes |
| versionId | string | Semantic version |
| createdAt | datetime | |
| checksum | string | Integrity hash |
| config | jsonb | Rule parameters |

### RateLimitBucket (Ephemeral - Redis)
| Key Composition | TTL | Notes |
| playerId:actionType | 10s | Stores count + window start |

### Metrics (Ephemeral)
Collected via process instrumentation; not stored as entities.

## Relationships
- Player 1..* GuildMembership; Guild 1..* GuildMembership.
- Player 1..* ChatMessage; ChatChannel 1..* ChatMessage.
- Instance 1..* AIEntity (or Arena 1..* AIEntity).
- Instance 1 ReplayMetadata (optional while unresolved).

## State Transitions (Instance)
```
pending -> active -> resolved
pending -> active -> aborted
```
Abort triggered by quorum logic (FR-018).

## Validation Rules
- Guild.name: normalize (lowercase) uniqueness enforced.
- BlockListEntry: prevent self-block.
- ChatMessage.content: length ≤ 512 chars (suggested cap) & sanitized.
- ReplayMetadata.expiresAt = createdAt + 7d.

## Derived / Indexed Fields
- Index guild.name normalized.
- Index chatmessage(channelId, seq) for ordered fetch.
- Partial index replaymetadata(expiresAt) for purge jobs.

## Purge Jobs
- Replay purge daily (expire < now).
- Chat retention purge per channel policy schedule.

## Open Considerations
- Potential snapshotting tile board for long matches (not in MVP).
- Potential friend list explicit entity (if needed) – derivable for now by join table variant.
