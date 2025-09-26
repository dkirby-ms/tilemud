# Data Model – Persistent Character Creation

## Entities

### PlayerAccount
| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `id` | string | Stable identifier from Entra ID external identities (objectId/subject). | Required; immutable. |
| `displayName` | string | Preferred name surfaced post-login. | Optional; derived from identity provider. |
| `characters` | CharacterProfile[] | Collection of characters owned by the player in roster order. | Maximum list length configurable (default 10). |
| `activeCharacterId` | string \| null | Character selected for the current session. | Must reference an existing `characters.id` when not null. |

### CharacterProfile
| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `id` | string | Server-assigned unique identifier for the character. | Required; UUID v4. |
| `ownerId` | string | FK to `PlayerAccount.id`. | Required. |
| `name` | string | Globally unique display name. | Required; `^[A-Z][a-z]+$`; uniqueness enforced server-side. |
| `archetypeId` | string | FK to `Archetype.id`. | Required. |
| `createdAt` | string (ISO 8601) | Timestamp of creation. | Required. |
| `status` | enum(`active`,`retired`) | Character lifecycle marker. | Defaults to `active`; `retired` used for future archival. |

### Archetype
| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `id` | string | Identifier provided by game developers. | Required. |
| `name` | string | Display label shown to players. | Required; localized strings supported later. |
| `description` | string | Flavor text/abilities summary. | Optional but recommended. |
| `isAvailable` | boolean | Indicates whether the archetype can be selected. | Required; defaults true. |
| `lastUpdatedAt` | string (ISO 8601) | Timestamp of server-side update. | Required for cache invalidation. |

### OutageNotice
| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `service` | enum(`character-service`) | Which dependency is degraded. | Required. |
| `message` | string | User-facing explanation for banner. | Required. |
| `retryAfterSeconds` | number \| null | Suggested retry interval. | Optional; when null, manual retry only. |

## Relationships & Lifecycle
- `PlayerAccount` owns multiple `CharacterProfile` entries; creation is one-way and irreversible per spec.
- `CharacterProfile.status` becomes `retired` only when future server workflows archive characters; no update path in current MVP.
- `Archetype` catalog is sourced from the game server at startup; client refreshes on login or when receiving catalog version change notifications.
- `OutageNotice` is transient UI state derived from failed service health checks; it is not persisted but informs disabled controls.

## Derived & View Models
- **CharacterRosterView**: Combines `PlayerAccount.characters`, current `activeCharacterId`, and availability flags to drive roster selection UI.
- **CreationFormState**: Local UI state mapping to `name`, `archetypeId`, validation errors, and submission status; persists across reconnects during outage.
