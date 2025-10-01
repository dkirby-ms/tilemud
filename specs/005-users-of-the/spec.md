# Feature Specification: Web Client Login, Character Selection, Server Connection & In-Game Chat

**Feature Branch**: `005-users-of-the`  
**Created**: 2025-10-01  
**Status**: Draft  
**Input**: User description: "Users of the web-client should be able to login, select a character, and then connect to a running instance of a server using the selected character. Once in the server, they should be able to chat with other players connected to the same server."

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
As a returning player, I open the web client, successfully authenticate, see a list of my existing playable characters, choose one, and am connected into a live game server instance where I can exchange chat messages with all other currently connected players on that same server instance.

### Acceptance Scenarios
1. **Given** an authenticated user with at least one existing character, **When** they open the character selection view, choose a character, and explicitly click a "Connect" action/button, **Then** the system establishes a game session using that character and displays confirmation that they are connected (e.g., shows other player chat stream) and they can submit a chat message which is visible to other connected players.
2. **Given** a user who has multiple characters, **When** they select a different character before joining, **Then** the system connects them using only the newly selected character and no data from an unselected character is applied to the session.
3. **Given** a user connected to a server instance, **When** they send a chat message inside an allowed size and rate, **Then** all currently connected players on that same server instance see the message in ordered sequence.
4. **Given** a user connected to a server instance, **When** another player joins, **Then** subsequent chat messages from that player appear for the user (late joiners do NOT receive any pre-join chat history).
5. **Given** a user connected to a server instance, **When** they disconnect intentionally (logout or leave) or lose connection, **Then** they are no longer considered present for new chat deliveries (re-join behavior [NEEDS CLARIFICATION: should last character auto-reconnect?]).

### Edge Cases
- Character list empty: authenticated user sees an empty roster state with a clear call-to-action that navigates them into the existing character creation flow; joining a server is blocked until at least one character exists.
- Multiple simultaneous browser tabs using different characters (policy [NEEDS CLARIFICATION: allow concurrent sessions per account?]).
- Rapid message sending approaching rate limits (excess after 5 messages within 5s sliding window rejected with user-visible error).
- Oversized chat message exceeding maximum permitted length (expected result: rejection with user-facing error — max length value [NEEDS CLARIFICATION]).
- Server instance at capacity when attempting to connect: Out of scope for this feature (no enforced numeric cap; joins proceed while server operational).
- Network drop mid-session (session presence retained up to 15s grace; reconnect within window resumes seamlessly, else presence removed).
- Attempt to send message before server session fully established (should be blocked with clear status message).
- Duplicate character selection submission (idempotent handling required; only one session established).
- Offensive or disallowed content: advanced moderation out of scope; baseline sanitization only (no banned-word filtering).
 - Time skew or ordering issues for chat messages (ordering rule: chronological by accepted timestamp; tie-break = original server receive queue order).

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST allow a user to authenticate via Entra ID External Identities (SSO) before any character selection or server connection occurs.
- **FR-002**: After successful authentication, system MUST present the user with a list of their available playable characters (if any) containing at minimum each character's name and an unambiguous identifier.
- **FR-003**: System MUST prevent entering a game server instance until exactly one character is selected.
- **FR-004**: System MUST establish a player game session bound to the selected character such that all in-session actions and chat messages are attributed only to that character.
- **FR-005**: System MUST ensure a user cannot simultaneously join the same server instance with the same character more than once (idempotent join / duplicate prevention).
- **FR-006**: System MUST provide clear feedback of connection state transitions: (a) connecting, (b) connected, (c) disconnected, (d) reconnecting (if supported). [NEEDS CLARIFICATION: is automatic reconnection in scope?]
- **FR-007**: While connected, the user MUST be able to submit textual chat messages associated with the active character.
- **FR-008**: System MUST deliver each submitted chat message to all currently connected players on the same server instance AND include the sender's own message in the feed only after server acceptance (no speculative/optimistic local echo prior to acceptance).
- **FR-009**: Chat messages MUST appear to all recipients in a consistent, deterministic order: primary sort ascending by accepted timestamp; if two messages share the same accepted timestamp, the server's original receive queue order is used as a tie-break.
- **FR-010**: System MUST enforce a maximum chat message length of 256 characters (Unicode code points) and reject any longer submission with a user-visible validation error.
- **FR-011**: System MUST enforce a rate limit of 5 messages per 5-second sliding window per user per server instance; submissions exceeding the limit are rejected with a user-visible error message and not queued.
- **FR-012**: System MUST prevent sending chat messages before the server session is confirmed established.
- **FR-013**: System MUST remove a user's presence from the server instance promptly upon logout, browser close, or connectivity timeout, applying a 15-second reconnection grace period for transient disconnects (presence retained and chat blocked during grace; after 15s without reconnection presence is removed).
- **FR-014**: System MUST NOT expose characters belonging to other users in the selection list.
- **FR-015**: System MUST restrict chat visibility so only players in the same server instance receive the messages (no cross-instance leakage).
-- **FR-015**: System MUST restrict chat visibility so only players in the same server instance receive the messages (no cross-instance leakage). (Superseded conceptually by FR-028 while only one global instance exists; retained for future multi-instance evolution.)
- **FR-016**: System MUST clearly communicate any failure to join (e.g., authentication expired, server unavailable) with a user-understandable reason. [NEEDS CLARIFICATION: list of possible join failure reasons in scope]
- **FR-017**: System MUST, when the authenticated user has zero characters, present an empty-state UI and redirect (via action/CTA) into the existing character creation flow; server connection remains disabled until a character is created.
- **FR-018**: System MUST ensure that disconnect events (intentional or unintentional) stop further chat reception and sending until reconnection.
- **FR-019**: System MUST log session start and end events for audit / operational insight. [NEEDS CLARIFICATION: required retention / visibility of logs]
- **FR-020**: System MUST provide baseline validation & sanitization of chat input to prevent injection of disallowed control sequences. [NEEDS CLARIFICATION: specific prohibited content scope]
- **FR-021**: System MUST expose a visible indicator of other players currently connected (at minimum a count or list). [NEEDS CLARIFICATION: which form—count vs. names?]
- **FR-022**: System MUST prevent switching characters without first leaving the current server session (no mid-session identity swap).
- **FR-023**: System MUST support at least one concurrent active session per authenticated user (multi-tab policy beyond that [NEEDS CLARIFICATION]).
 - **FR-024**: System MUST surface a user-facing error if message delivery fails (e.g., disconnected state) instead of silently dropping.
 - **FR-025**: System MUST present no historical chat backlog on join; only messages accepted after the player's join timestamp are displayed.
 - **FR-028**: System MUST connect all users to a single global shared server instance (no manual selection UI) when they click Connect; multi-instance discovery / routing is explicitly out of scope for this feature but the design MUST NOT preclude adding multiple instances later.

*Ambiguity Examples (retained intentionally for clarification):*
- ~~FR-026: System MUST moderate or filter disallowed language.~~ (Removed: advanced moderation out of scope; baseline sanitization only.)
- ~~FR-027: System MUST define maximum simultaneous players per server instance.~~ (Removed: explicit numeric capacity management out of scope; implicit process limits only.)

### Open Questions (Consolidated)
1. Multi-tab / multi-character concurrent session policy?
2. Required visibility for other players (names vs. count only)?
3. Join failure reason taxonomy to standardize user messaging?
4. Logging retention and access expectations?
5. Character switching policy after connection (explicit leave only?).
6. Sanitization scope (which characters or formats are disallowed)?

### Key Entities *(include if feature involves data)*
- **User**: Represents an authenticated account; attributes: unique identifier, associated characters. (Credentials / auth details out of scope.)
- **Character**: Playable persona owned by a user; attributes: character ID, name, status (active/disabled), ownership link to User.
- **Server Instance (Game Session Context)**: Logical environment players join; attributes: instance ID, capacity, current player list, status (accepting connections / full).
- **Player Session**: Association of (User, Character) actively connected to a Server Instance; attributes: session ID, connection state, join timestamp, last activity time.
- **Chat Message**: A discrete text communication; attributes: message ID, sending Player Session reference, content text, accepted timestamp, (optional) delivery order token.
- **Presence Roster**: Derived view listing active Player Sessions in an instance.

---

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

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed (pending resolution of [NEEDS CLARIFICATION] items)

## Clarifications

### Session 2025-10-01
- Q: What authentication approach will this feature use prior to character selection? → A: Entra ID External Identities (SSO)
- Q: How should the system handle an authenticated user with zero characters? → A: Redirect to existing character creation flow (empty-state CTA, joining blocked)
- Q: How is the server instance selected for a user when they click Connect? → A: Single global shared instance (no selection UI)
- Q: Will multiple server instances be supported now or only later? → A: Single instance now; future multi-instance expansion planned (design must not preclude)
- Q: Should users see any prior chat history immediately upon joining the server? → A: No history (only messages after join)
- Q: What is the maximum chat message length (in characters) to enforce? → A: 256
- Q: What are the chat rate limit thresholds (messages per time window) and how to handle excess? → A: 5 messages / 5s sliding window; excess rejected with visible error
- Q: Should the sender see their own chat message echoed in the feed? → A: Yes, only after server acceptance (no optimistic local echo)
- Q: Tie-break rule for identical accepted timestamps? → A: Use original server receive queue order as deterministic tie-break
- Q: Numeric capacity limit per single global server instance? → A: No fixed limit in this feature (capacity management out of scope)
 - Q: Are offensive content filtering / moderation requirements in scope for chat? → A: Out of scope; only baseline sanitization (no banned-word filtering)
 - Q: Reconnection grace period for transient disconnects? → A: 15s grace; presence retained, removed after timeout

---
