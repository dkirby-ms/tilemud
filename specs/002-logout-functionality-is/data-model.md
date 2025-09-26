# Data Model: User Logout Capability

Date: 2025-09-26  
Branch: 002-logout-functionality-is

## Entities

### Session (Conceptual, server authoritative)
| Field | Type | Notes |
|-------|------|-------|
| id | string | Server-managed unique session identifier |
| userId | string | Authenticated user identifier |
| createdAt | ISO timestamp | Session creation time |
| lastActivityAt | ISO timestamp | Updated on protected action |
| status | enum(`active`,`expired`,`terminated`) | Drives acceptance scenarios 4,5,6 |

State Transitions:
- active → terminated (manual logout)
- active → expired (timeout) → terminated (lazy on next interaction)

### LogoutEvent (Ephemeral client emission)
| Field | Type | Notes |
|-------|------|-------|
| eventType | string(`logout`) | Constant discriminator |
| userSurrogateId | string | Non-PII stable surrogate (from auth context if available) |
| timestampUTC | ISO timestamp | UTC event time |
| reason | enum(`manual`,`timeout`,`forced`) | From triggering action; manual only for this feature |
| wasOffline | boolean | True if network unreachable at initiation |
| latencyMs | number | Elapsed time until purge + redirect decision (optional dev metric) |

### UserCachedData (Client aggregate, purged on logout)
| Component | Contents | Purge Strategy |
|-----------|----------|---------------|
| characterStore.player | Player roster + activeCharacterId | Reset via `reset()` action |
| characterStore.archetypeCatalog | Archetype list | Reset |
| characterStore.serviceHealth | Last known health/outage | Reset |
| optimisticCharacters | Pending creations | Reset |
| tokens (MSAL) | Access & refresh tokens | MSAL logoutRedirect + local clear fallback |
| localStorage keys (feature-scoped) | Character selections, feature flags | Selective remove (none yet persisted) |
| analytics identifiers | Stable anonymous IDs | Retained (per clarification) |

## Validation Rules
- Logout MUST purge all fields in UserCachedData except analytics identifiers (FR-09).
- Double invocation MUST NOT throw; subsequent calls are no-ops (FR-06).
- Unsaved changes confirmation gate applied before purge if focused dirty field heuristic matches (FR-08).

## Invariants
- After purge, any protected route navigation MUST redirect or render unauthenticated view (FR-05).
- Post-logout localStorage broadcast timestamp monotonic per tab.

## Derived / Ephemeral Values
- `latencyMs` for LogoutEvent derived from high-resolution timer at action start.

## Exclusions
- No persistence of LogoutEvent beyond optional dev logging.
- No rotation of analytics identifiers at logout.

## Future Extensions (Documented, not implemented)
- Session list & remote device termination.
- Audit log persistence for LogoutEvent.
- Analytics identifier rotation policy toggle.
