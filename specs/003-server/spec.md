# Feature Specification: Scalable Game Service Backend

**Feature Branch**: `003-server`  
**Created**: September 26, 2025  
**Status**: Draft  
**Input**: User description: "I want to build a game service that serves as a game backend for a tile placement game. Players may range in count from 1 to hundreds using the service at any given time. Players interact with each other through instanced battles with groups of other playerts and environmental and AI controlled gameplay elements such as NPCs or scripted scenarios. Players also interact with each other through social channels like grouping, guilds, and private chats."

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
- Focus on WHAT users need and WHY
- Avoid HOW (no implementation technology decisions here)
- Audience: product & domain stakeholders

---

## User Scenarios & Testing *(mandatory)*

## Clarifications

### Session 2025-09-26
- Q: How should the system resolve simultaneous conflicting tile placements targeting the same board cell? → A: Batched queued resolution (collect all in a tick/window, apply deterministic ordering rule)
 - Q: How should the system define maximum AI (NPC/scripted) entities per instance? → A: Hybrid model (Option E): tiered base caps per mode with elastic reductions under sustained resource pressure.
 - Q: What is the reconnect grace period length for a disconnected player to resume without state loss? → A: Fixed 120 seconds (Option B), measured from last authoritative heartbeat received server-side; after expiry, slot/resources may be reallocated.
 - Q: What delivery semantics should chat channels guarantee? → A: Tiered semantics: Private, Guild, Party channels provide user-perceived exactly-once (idempotent ordered delivery via server-assigned monotonic IDs); Public/Arena/System channels at-least-once with client de-duplication. No custom retry logic—leverages existing messaging substrate.
 - Q: What is the primary sharding / segmentation basis for sessions? → A: Hybrid priority (Option D): (1) Game Mode (Arena vs Battle vs Social), (2) Geography / latency region, (3) Real-time load (player concurrency & CPU), using deterministic composite shard keys.
 - Q: What guild role model is used? → A: Four fixed roles (Option B): Leader (unique), Officer, Veteran, Member; fixed semantics (no custom roles) with defined permission tiers.
 - Q: What baseline rate limits apply to chat and action submissions? → A: Option A: Chat limited to 20 messages per 10-second sliding window per player identity; Game actions limited to 60 actions per 10-second sliding window per player identity. (Additional long‑window caps & penalty escalation to be defined if needed later.)
 - Q: What are the chat retention durations by channel? → A: Option B: Private & Guild 7 days; Party 24 hours; Public/Arena 12 hours; System 30 days.
 - Q: What is the replay retention window? → A: 7 days for all completed instances (Option 1) after which replay artifacts are purged.
   - Q: What is the guild name uniqueness policy? → A: Global uniqueness with post-deletion reservation (Option D). Assumed reservation hold: 30 days (pending confirmation) during which the name cannot be re-registered by others.
      - Q: What is the block list scope? → A: Global per account (Option A): blocking suppresses all direct chat, private invites, friend requests, and visibility in social discovery lists across all modes.
         - Q: What is the instance soft-fail abort criterion? → A: Option B: Abort if active human player count remains below quorum = min(floor(initial_humans / 2), 3) for a continuous 45-second interval; otherwise continue. On abort, system finalizes with partial resolution status.
 - Q: What are the arena capacity tiers? → A: Small Arena ≤ 80, Large Arena ≤ 160, Epic Event Arena ≤ 300 concurrent human players (hard caps; queueing activates beyond 90% threshold; dynamic scaling attempts before hard reject at cap).

### Primary User Story
Players engage in a persistent tile placement game ecosystem where they can (a) participate in instanced tactical tile battles with other players and AI/ environmental elements, (b) cooperate or compete in PvP arenas, and (c) socialize through grouping, guilds, and private chat channels – all supported by a scalable backend handling from solo play to hundreds of concurrent participants.

### Acceptance Scenarios
1. **Given** a solo player starts a session, **When** they enter a battle instance, **Then** the system provisions an isolated game state supporting optional AI/NPC participation.
2. **Given** a group forms a battle instance, **When** the instance starts, **Then** only invited/assigned players and configured AI entities can affect that instance state.
3. **Given** a large PvP arena (100+ players) is active, **When** multiple players submit tile actions simultaneously, **Then** the authoritative state processes them under defined resolution rules and propagates updates within target latency.
4. **Given** a guild chat channel exists, **When** a member sends a message, **Then** all online guild members receive it, and offline members can access the last 7 days of guild chat history on reconnect (channel retention: Guild 7d; Private 7d; Party 24h; Public/Arena 12h; System 30d).
5. **Given** a player disconnects mid-instance, **When** they reconnect within 120 seconds (grace window) of their last authoritative heartbeat, **Then** they resume their role without unfair advantage or loss of state; after 120s the slot may be recycled.
6. **Given** an instance reaches its victory condition, **When** the final action is resolved, **Then** rewards, rankings, and logs are generated and persisted.
7. **Given** system load increases sharply, **When** new large-scale arena joins are requested, **Then** capacity limits or queuing rules apply with user-facing feedback using defined tiers (Small ≤80, Large ≤160, Epic ≤300; queue engages ≥90% utilization, hard reject at cap).

### Edge Cases
- Simultaneous conflicting tile placements targeting the same board cell.
- Player reconnects after grace period expiration.
- NPC script stall or failure mid-instance.
- Duplicate guild names requested concurrently (global uniqueness with reservation should produce deterministic conflict rejection).
- Burst chat spam in public or guild channels. **[NEEDS CLARIFICATION: rate limits?]**
 - Burst chat spam in public or guild channels (handled via baseline rate limits in FR-012).
- Attempt to merge two partially filled arenas for load balancing.
 - Instance soft-fail (handled: abort if humans < quorum (= min(floor(initial/2),3)) for >45s continuous).

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST support instanced battle sessions isolated from other concurrent sessions.
- **FR-002**: System MUST scale to support sessions ranging from 1 player to hundreds of concurrent participants (across multiple instances and arenas).
- **FR-003**: System MUST differentiate interaction modes: instanced battles, large PvP arenas, social/guild spaces, and private chats.
 - **FR-004**: System MUST manage AI-controlled entities (NPCs, scripted scenarios) participating in instances alongside players under a hybrid capacity policy: (a) predefined base caps per mode; (b) dynamic elastic reductions when sustained resource pressure thresholds are exceeded; (c) a minimum guaranteed floor per mode.  
    Base Caps: Small Battle: 8; Standard Battle: 16; Large Arena: 40; Epic Event: 100.  
    Floors: Small:4; Standard:8; Large:20; Epic:50 (caps never reduced below these).  
    Elastic Reduction Rule: On sustained resource pressure—defined as CPU > 75% OR Memory > 70% for 3 consecutive 10-second monitoring intervals—apply one reduction step: decrease remaining AI spawn allowance (not currently spawned AI) by 25% of the original base cap. A second (and final) reduction step may be applied if pressure persists for an additional 3 consecutive intervals after the first step (max 2 steps). Recovery: When CPU < 65% AND Memory < 60% for 2 consecutive intervals, restore one step (in reverse order) per recovery window until base cap is reinstated. Restorations never exceed original base cap and do not violate floors. Monitoring intervals are synchronized shard-wide.
- **FR-005**: System MUST enforce authoritative tile placement validation and resolve conflicts via batched queued resolution windows (collect all submissions in the tick, apply deterministic ordering rule, then commit winning placement atomically).
- **FR-006**: System MUST support player grouping (ad‑hoc parties) and persistent guild membership with a fixed four‑role model: Leader (unique per guild), Officer, Veteran, Member. Each role has predefined permissions (e.g., Leader: full control; Officer: invite/kick/manage Veterans/Members; Veteran: limited invite; Member: basic participation). No custom roles beyond this fixed set. Guild names MUST be globally unique case-insensitively; upon guild deletion a 30-day reservation hold prevents reuse of the same normalized name (assumed value pending confirmation) to mitigate impersonation and churn abuse.
- **FR-007**: System MUST provide private, guild, party, public, and system chat channels with tiered delivery semantics: (a) Private, Guild, Party channels achieve user-perceived exactly-once via server-assigned monotonic per-channel message IDs enabling idempotent suppression of duplicates; (b) Public, Arena, and high-volume System broadcast channels use at-least-once delivery with client-side de-duplication based on message IDs. The system MUST NOT introduce bespoke retry algorithms beyond what the underlying messaging substrate supplies.
- **FR-008**: System MUST persist battle / arena outcomes, rewards, and activity logs.
- **FR-009**: System MUST allow reconnect within a fixed 120-second grace window (measured from last server-received heartbeat or action) without loss of character or instance state; after expiry, the player is removed from active rosters and their slot/resources may be reclaimed.
- **FR-010**: System MUST expose session discovery / joining for arenas, and invitation / assignment for instanced battles.
- **FR-011**: System MUST provide scalability controls (capacity thresholds, queueing, shard/segment criteria) using a hybrid segmentation hierarchy: primary partition by Game Mode (Arena / Battle / Social), secondary subdivision by Geography / latency region, tertiary balancing by real-time load metrics (player concurrency, CPU utilization). Deterministic composite shard keys (Mode|Region|ShardIndex) MUST enable predictable routing and horizontal elasticity.
- **FR-012**: System MUST apply baseline per-identity rate limits: Chat ≤ 20 messages / rolling 10s window; Game actions ≤ 60 actions / rolling 10s window. System MUST enforce sliding windows and reject (or queue-drop) excess with standardized throttle feedback.
- **FR-013**: System MUST track per-session metrics (players active, actions/sec, AI load, latency p95) for observability.
- **FR-014**: System MUST maintain social graph relationships (friend/block lists). Block lists are global per account identity, suppressing: direct/private chat, guild/party invites, friend requests, targeted pings, and presence visibility (except where compliance/log retention requires server-side preservation). Block status MUST apply across all modes and shards.
- **FR-015**: System MUST support administrative moderation (mute, kick from instance, guild dissolution requests).
- **FR-016**: System MUST record and version rule configurations used in each resolved instance for audit.
- **FR-017**: System MUST expose replay data for completed instances (sequence of authoritative state changes) for up to 7 days post-resolution, after which replay artifacts are purged. Replay access MUST include metadata (rule version, participants, duration) and support deterministic reconstruction within that window.
 - **FR-018**: System MUST detect and gracefully abort a soft-fail instance when active human participants remain below quorum (quorum = min(floor(initial_humans / 2), 3)) for a continuous 45-second measurement window; abort emits a partial result outcome with appropriate logging and reward adjustment rules.

### Key Entities
- **Player**: Human or AI-controlled participant with identity, session presence(s), social affiliations.
- **Instance (Battle)**: Isolated tactical tile session with bounded participants (players + AI) and lifecycle (pending → active → resolved/abandoned).
- **Arena**: Large shared competitive environment with higher participant counts and continuous or cyclical rounds.
- **Tile Board**: Spatial state container tracking tile placements, ownership, and environmental effects.
- **AI Entity / NPC**: Scripted or autonomous participant with behaviors and state constraints.
- **Guild**: Persistent social organization with membership roster, roles, and channels.
- **Group/Party**: Temporary cooperative unit for entering instances.
- **Chat Channel**: Logical stream (guild, party, private, arena, system) with retention and moderation attributes.
- **Match / Outcome Log**: Immutable record of end-state metrics, rewards, and applied rule set.
- **Replay Timeline**: Sequence of ordered authoritative events enabling deterministic reconstruction.

---

## Review & Acceptance Checklist
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
- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [ ] User scenarios defined
- [ ] Requirements generated
- [ ] Entities identified
- [ ] Review checklist passed

---
