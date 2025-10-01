# Feature Specification: Large-Scale Multiplayer Tile Game Backend Service

**Feature Branch**: `004-i-want-to`  
**Created**: 2025-09-29  
**Status**: Draft  
**Input**: User description: "I want to build a game service that serves as a game backend for a tile placement game. Players may range in count from 1 to hundreds using the service at any given time. Players interact with each other through instanced battles with groups of other playerts and environmental and AI controlled gameplay elements such as NPCs or scripted scenarios. Players also interact with each other through social channels like grouping and private chats."  
**Current Scope Adjustment**: For the initial slice we explicitly LIMIT social features to (a) in-battle (instance) chat among active participants and (b) direct player-to-player private messages. Pre-instance grouping, parties, guilds, or broader social organization are deferred.

## Execution Flow (main)
```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors, actions, data, constraints
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., "login system" without auth method), mark it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies  
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a player, I want to log into the tile game backend, enter or create an instanced battle containing a shared tile-based playfield with other players and AI-controlled entities, manipulate tiles according to game rules, and communicate via in-battle chat and private direct messages so that I can coordinate gameplay while the system scales from a single player session to hundreds of concurrent players.

### Acceptance Scenarios
1. **Given** a registered/logged-in player and no existing active battle, **When** the player requests to start an instanced battle (solo mode), **Then** the system creates an isolated battle instance with an initialized tile map and assigns the player to it.
2. **Given** two or more players individually join the same open battle instance, **When** the instance starts, **Then** all participants see a synchronized initial tile state.
3. **Given** a player inside an active battle instance, **When** they place a tile per game rules, **Then** the updated tile state becomes visible to all other participants in that instance within ≤150ms end-to-end (client action to applied state) at the 95th percentile.
4. **Given** a battle instance containing AI/NPC entities, **When** scripted environmental events trigger (e.g., NPC move, environmental hazard), **Then** the instance state updates and all players receive consistent event notifications.
5. **Given** two players with mutual communication permissions, **When** one sends a private direct message, **Then** only the target player receives it and delivery success or failure is known to the sender.
6. **Given** a player in an instance posts an in-battle chat message, **When** the message is accepted, **Then** all current active participants of that instance receive it in order.
7. **Given** a player disconnects temporarily during an instanced battle, **When** they reconnect within 60 seconds (grace period), **Then** they resume the same instance state (tile layout, position, pending effects) without data loss; after 60 seconds the slot may be reclaimed and state discarded or summarized for outcomes.
8. **Given** a battle instance reaches its end condition (e.g., objective met), **When** the end condition is detected, **Then** final results (scores, outcomes, rewards) are produced and persisted for later retrieval.
9. **Given** system load of up to ~1,000 concurrent connected players across multiple active instances, **When** standard gameplay actions occur (tile placement, in-battle chat messages, private messages), **Then** the system maintains performance meeting latency targets (tile placement ≤150ms p95, chat delivery ≤150ms p95) and does not exceed yet-to-be-defined throughput and error rate thresholds.

### Edge Cases
- Single-player scenario: player starts solo instance and immediately ends (ensure lifecycle still recorded).
- Simultaneous tile placements targeting same board cell by different players are resolved by predetermined player initiative order (higher priority wins; losers receive rejection with precedence reason).
- Player attempts action in an instance they are no longer part of (should be rejected with an explanatory reason).
 - NPC scripted event collides with a player move in the same tick: resolve via deterministic priority list (player initiative ordering vs event priority tier; compare first by event priority tier, then by player initiative for ties; losing action/event rejected or deferred with precedence-conflict reason).
 - Chat spam or rate limit exceed events: enforce per-player limits (in-battle chat ≤20 messages / rolling 10s window; private direct messages ≤10 messages / rolling 10s window; tile placement actions ≤5 per second with burst allowance up to 10 in any 2-second span) — excess attempts rejected with standardized rate-limit error.
- Instance capacity reached when new player tries to join (reject join once 32 active player slots filled).
- Attempt to send in-battle chat from a player no longer marked active (should be rejected with explicit reason).
- Sudden server failure mid-instance: active instance is irrecoverably lost; players must start a new instance (ephemeral durability model, no automatic recovery).
- Cross-instance message attempt (should not be delivered; verify isolation).
 - Private message retrieval attempt after 30-day retention window (should return retention-expired or not-found result without content exposure).

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST allow a player to create or join an instanced battle session (instance) corresponding to a tile-based playfield.
 - **FR-002**: System MUST initialize each new instance with a deterministic starting tile map bound to an immutable semantic rule set version (MAJOR.MINOR.PATCH). Once an instance starts its referenced version MUST NOT change; new behavior changes require publishing a new semantic version. Older versions remain loadable for already-running instances until they end.
- **FR-003**: System MUST enforce isolation so that game state mutations (tile placements, NPC events) in one instance are not visible in others.
- **FR-004**: System MUST broadcast approved tile placement updates to all active participants of the instance.
- **FR-005**: System MUST validate tile placement actions against game rules (placement legality, resource costs, timing constraints) and reject invalid actions with a reason code [NEEDS CLARIFICATION: catalog of rejection codes].
- **FR-006**: System MUST support AI / NPC / scripted environmental events that can modify the instance state and be observable to all participants.
- **FR-007**: System MUST provide real-time communication channels: in-battle (instance) chat among active participants and private direct messages between two players with permission.
- **FR-008**: System MUST preserve ordering of messages per channel scope (instance, private) as perceived by recipients and deliver each chat message to all intended recipients within ≤150ms end-to-end at the 95th percentile; ordering behavior across shards/instances remains to be clarified [NEEDS CLARIFICATION: cross-shard ordering model].
- **FR-009**: System MUST track and persist battle outcomes (win/loss/objective metrics, rewards) accessible to relevant players after instance completion.
- **FR-010**: System MUST handle player temporary disconnection with a 60-second grace period allowing seamless rejoin retaining prior state; attempts to rejoin after 60 seconds MUST be rejected with a standardized grace-expired error and the player treated as removed for outcome processing.
- **FR-011**: System MUST enforce a hard cap of 32 concurrent players per instance for the initial release and reject additional join attempts with a standardized capacity-exceeded error.
- **FR-012**: System MUST prevent players from performing in-instance actions or sending in-battle chat if they are no longer active participants (e.g., removed, disconnected past grace period, instance ended).
- **FR-013**: System MUST provide a mechanism to end an instance when victory/defeat or other termination condition is reached and transition all participants to a post-instance state.
- **FR-014**: System MUST protect privacy of private messages so that only intended recipients can access their content AND persist all private direct messages in an immutable audit log for a fixed 30-day retention window after which messages are permanently and irrecoverably purged; no user-initiated deletion prior to expiry is supported in this slice.
- **FR-015**: System MUST support scalable concurrent operation sustaining ~1,000 simultaneous connected players across multiple instances in the initial release (future scalability beyond this may be addressed in later features); associated KPIs (latency, error rate, throughput) to be defined in subsequent clarification.
- **FR-016**: System MUST apply per-player rate limiting for anti-spam: (a) in-battle chat: max 20 messages per rolling 10-second window, (b) private direct messages: max 10 messages per rolling 10-second window, (c) tile placement actions: max 5 per second with a burst ceiling of 10 actions in any rolling 2-second interval. Requests exceeding limits MUST be rejected with a standardized rate-limit error (referenced in the error code schema) and MUST NOT consume additional quota; no adaptive penalty escalation in this initial slice beyond simple rejection.
 - **FR-017**: System MUST emit structured JSON logs for only critical game events (instance creation, instance completion, tile placement rejection, rate limit rejection, unrecoverable failure, moderation / security relevant event) and retain these logs for 7 days hot storage; no distributed tracing or advanced metrics beyond basic counters (counts of rejections, instance creations/completions) in this slice.
- **FR-018**: System MUST ensure that conflicting tile placement attempts affecting the same location are resolved deterministically using a predefined player initiative priority order (higher initiative wins; all losing actions are rejected with a standardized precedence-conflict error code).
- **FR-019**: System MUST supply a consistent snapshot of instance state to reconnecting players.
- **FR-020**: System MUST reject cross-instance interaction attempts (e.g., tile placement referencing another instance ID) with an error.
- **FR-021**: System MUST support scripted scenario triggers (time-based or condition-based) that can queue or execute instance events.
 - **FR-022**: System MUST provide a standardized error code schema using numeric stable codes (E####) paired with a symbolic reason key. Every error response MUST include: numericCode (e.g., E1001), reason (snake_case symbolic string), category (one of: validation, conflict, capacity, rate_limit, state, security, internal), retryable (boolean), and humanMessage (localizable template key). Numeric codes are immutable once assigned.
 - **FR-023**: System MUST treat an unrecoverable infrastructure failure of an active instance as immediate termination without state recovery; subsequent player actions referencing that instance MUST receive an instance-terminated error and no state restoration attempt is made.
 - **FR-024**: System MUST apply a deterministic resolution order each tick: (1) higher priority scripted/NPC events by explicit event priority tier ascending (lower number executes first), (2) player tile placement actions ordered by player initiative (higher initiative wins), (3) remaining lower-priority events; ties within same category resolved by monotonic server timestamp then stable unique ID. Conflicts must yield a standardized precedence-conflict rejection for losing operations.

*Ambiguities & Clarifications required are explicitly marked; no implementation technology is specified.*

## Clarifications

### Session 2025-09-29
- Q: What peak concurrent connected player scale should the backend handle in the initial release? → A: ~1,000 concurrent players (Option B)
- Q: What end-to-end latency targets for tile placement propagation and chat delivery? → A: Tile ≤150ms p95, Chat ≤150ms p95 (Option A)
- Q: What is the maximum number of players allowed in a single battle instance? → A: 32 players (Option D)
- Q: When simultaneous tile placements target the same cell how is precedence resolved? → A: Player initiative priority order (Option B)
- Q: What reconnection grace period is allowed for a disconnected player to rejoin the same instance? → A: 60 seconds (Option B)
 - Q: If the server hosting an active battle instance fails abruptly, what is the required behavior for that instance? → A: Ephemeral loss; instance terminated with no recovery (players must start new instance).
 - Q: When NPC/scripted events and player actions collide in the same tick, how are they ordered? → A: Deterministic priority list (event priority tier, then player initiative, then timestamp/ID).
 - Q: What is the retention policy for private direct messages in the initial slice? → A: 30-day immutable audit log (Option D).
 - Q: What initial per-player rate limit policy should we adopt? → A: Moderate (Chat 20/10s, Private 10/10s, Tile 5/sec burst 10) (Option B).
 - Q: What base error code schema format should we adopt? → A: Numeric stable codes + symbolic reason (Option C).
   - Q: How should rule set versioning be modeled for this initial slice? → A: Immutable semantic versions (Option A).
   - Q: What observability/log retention profile should the initial slice adopt? → A: Minimal 7-day critical event logs (Option A).

### Key Entities *(include if feature involves data)*
- **Player**: Represents an individual user participating in gameplay. Attributes (conceptual): unique identifier, display name, initiative priority rank, current instance (nullable), connection status.
- **Instance (Battle Session)**: Isolated tile playfield and session scope. Attributes: instance ID, rule set version, current tile map state, participants (≤32), NPC entities, start time, end condition, status (active/completed/terminated), capacity limit (=32), open slots.
- **Tile Map / Board**: Structured grid or spatial layout where placements occur. Attributes: dimensions, rule constraints, per-cell state, version/timestamp.
- **Tile Placement Action**: Proposed change to board state. Attributes: acting player, target coordinates, tile type, request timestamp, resolution status, rejection code (if any).
- **NPC / AI Entity**: Non-player controlled actor. Attributes: entity ID, type/archetype, position/state, behavior script reference.
- **Scripted Scenario / Event Trigger**: Defines conditional or scheduled events. Attributes: trigger ID, condition spec (time, state predicate), actions to apply.
- **Chat Message**: Communication unit. Attributes: message ID, channel scope (instance/private), sender, recipients / scope reference, content metadata, timestamp, delivery status.
### Deferred / Out of Scope (Future Social Expansion)
The following are intentionally excluded from the current scope and will be addressed in later feature specs:
* Pre-instance party / group formation workflows
* Group / party chat outside an active instance
* Guilds, alliances, or other persistent social organizations
* Global / zone / lobby chat channels
* Friend lists / presence subscriptions beyond what is required for a private message permission check
* Rich moderation tooling (beyond minimal logging and rate limiting)

- **Battle Outcome Record**: Summary persistent artifact post-instance. Attributes: instance ID, participants, outcome metrics, reward descriptors, completion timestamp.
- **Action / Event Log Entry**: Audit trail conceptual entity. Attributes: timestamp, actor (player/system), event type, relevant IDs (instance, tile), narrative.

### Initial Error Code Catalog (Seed Set)
| Numeric | Reason Key | Category | Retryable | Description |
|---------|------------|----------|-----------|-------------|
| E1001 | invalid_tile_placement | validation | false | Tile action violates ruleset (illegal position/resource) |
| E1002 | precedence_conflict | conflict | false | Losing action/event in deterministic ordering |
| E1003 | instance_capacity_exceeded | capacity | false | Join rejected; 32 player limit reached |
| E1004 | instance_terminated | state | false | Instance no longer active (ephemeral failure or ended) |
| E1005 | grace_period_expired | state | false | Reconnect window elapsed; slot released |
| E1006 | rate_limit_exceeded | rate_limit | true | Channel-specific per-player limit exceeded |
| E1007 | cross_instance_action | validation | false | Action references non-current instance |
| E1008 | unauthorized_private_message | security | false | Sender lacks permission to message target |
| E1009 | retention_expired | state | false | Requested private message aged beyond 30-day window |
| E1010 | internal_error | internal | true | Generic fall-back for unexpected failure (no sensitive detail) |

Future codes MUST append without reusing retired numbers; deprecation handled by marking description as "DEPRECATED" while retaining row.

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness
- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous  
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [ ] User description parsed
- [ ] Key concepts extracted
- [ ] Ambiguities marked
- [ ] User scenarios defined
- [ ] Requirements generated
- [ ] Entities identified
- [ ] Review checklist passed

---
