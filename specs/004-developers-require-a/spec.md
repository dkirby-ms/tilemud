# Feature Specification: Developer Infrastructure: Local Docker Compose for Redis & PostgreSQL

**Feature Branch**: `004-developers-require-a`  
**Created**: 2025-09-28  
**Status**: Draft  
**Input**: User description: "Developers require a docker-compose file for setting up the necessary infrastructure to dev and test. The docker-compose file should include the necessary infra components such as Redis and PostgreSQL. The expectation is that developers will run the server and web-client locally (not in containers) development, with PostgreSQL and Redis running in containers."

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

## Clarifications
### Session 2025-09-28
- Q: How should database migrations be executed in this workflow? → A: Manual command after infra up (Option A)
- Q: How should default port overrides be provided? → A: Environment variables in `.env` (POSTGRES_PORT, REDIS_PORT)
- Q: What healthcheck timing policy do you want for PostgreSQL and Redis readiness? → A: Balanced (interval 5s, timeout 2s, retries 12 ≈60s max)
- Q: Should this same docker-compose setup be officially supported for CI automation? → A: No (local development only; CI uses different provisioning)
- Q: Should local test scripts automatically start/stop infra if not running? → A: Yes (auto-start if absent; leave running after)

Clarification Impact:
- Selected manual approach; compose will not run migrations automatically.
- Documentation must specify a single developer-invoked command (e.g., an npm script) executed only after healthchecks pass.
- Port overrides via `.env` ensure low-friction conflict resolution.
- Balanced healthchecks define deterministic readiness window (~60s max wait).
- CI usage explicitly excluded; compose stability guarantees are local-only.
- Test scripts will detect missing infra and auto-start it (idempotent), but will NOT auto-stop to preserve developer iteration speed.


## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a developer working on the TileMUD server or web client, I need a single, documented command to start required infrastructure services (PostgreSQL and Redis) so that I can run the Node.js server and React web client locally without manually installing or configuring those backing services on my machine.

### Acceptance Scenarios
1. **Given** a clean repository clone with Docker + Docker Compose installed, **When** the developer runs the documented compose startup command, **Then** both a PostgreSQL container and a Redis container are started and become reachable on documented host ports from the host network (e.g., localhost) for the server process.
2. **Given** the infrastructure stack is running, **When** the developer starts the server locally, **Then** the server can establish successful connections to PostgreSQL (for persistence) and Redis (for caching / presence) using environment variables documented alongside the compose file.
3. **Given** the infrastructure stack is running, **When** the developer stops it using the documented shutdown command, **Then** containers terminate cleanly and (by default) persisted database data remains available across restarts unless a documented command for a clean reset is executed.
4. **Given** another developer wishes to reset all infrastructure state, **When** they run the documented reset/destroy command, **Then** volumes (or data directories) are removed and subsequent startup yields a fresh empty database and cache.
5. **Given** a new developer without local PostgreSQL/Redis installed, **When** they follow the quickstart instructions, **Then** they can execute integration and contract tests that depend on those services without additional machine-level setup.

### Edge Cases
- Developer already has services running on the default host ports → Developer sets `POSTGRES_PORT` and/or `REDIS_PORT` in `.env` to alternate free ports; compose uses variable substitution.
- Container crashes during startup due to port conflicts → Guidance will recommend checking running processes / adjusting env ports (no automated port detection included in scope unless later expanded).
- Need for seeded schema/migrations at first run → Developer runs manual migration command after `docker compose up -d` once services report healthy (compose does NOT auto-run migrations).
- CI usage → Explicitly out of scope; CI will provision its own ephemeral services (compose file not guaranteed stable for CI workflows).
- Test script invocation with infra down → Scripts auto-start infra via compose, then proceed; they do not tear it down automatically.
- Handling of sensitive credentials (passwords) → Must not commit secrets; rely on `.env` with example template.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: A Docker Compose configuration MUST define services for PostgreSQL and Redis only (no application containers) to support local development.
- **FR-002**: The PostgreSQL service MUST expose a stable host port (default 5432) and allow configuration via environment variables loaded from a developer-managed `.env` file (with a committed `.env.example`).
- **FR-003**: The Redis service MUST expose a stable host port (default 6379) and require no password by default unless security requirements later mandate it (document future option).
- **FR-004**: The compose setup MUST enable persistent PostgreSQL storage across container restarts via a named volume.
- **FR-005**: The compose setup MUST allow developers to optionally reset (wipe) all persisted data with a documented single command (e.g., `docker compose down -v`).
- **FR-006**: The repository MUST include clear quickstart documentation (section or file) showing start, stop, reset, and troubleshooting commands for infra.
- **FR-007**: The server MUST be able to connect using environment variables without code changes when compose stack is up (variables documented: DB host, port, user, password, database name; Redis host and port).
- **FR-008**: The compose definition MUST declare healthchecks for PostgreSQL and Redis using a Balanced policy: interval 5s, timeout 2s, retries 12 (approximate maximum wait ~60s) to provide deterministic readiness for tests.
- **FR-009**: The solution MUST avoid committing real credentials; any defaults MUST be non-sensitive placeholders.
- **FR-010**: The compose file MUST be compatible with Docker Compose v2 syntax and not rely on deprecated fields.
- **FR-011**: A developer MUST be able to override default ports via environment variable substitution without editing the compose file, supporting `POSTGRES_PORT` (default 5432) and `REDIS_PORT` (default 6379) defined in `.env`.
- **FR-012**: The feature MUST include guidance for running database migrations via a single documented manual command executed after infrastructure services are healthy (compose itself MUST NOT auto-run migrations).
- **FR-013**: The compose setup SHOULD NOT introduce dependencies beyond Docker/Compose (no requirement for Make, Taskfile, etc.).
- **FR-014**: Local test scripts MUST automatically start the compose infra (if not already running) before executing tests and MUST leave it running afterward to optimize iteration; scripts MUST be idempotent on repeated invocation.
- **FR-015**: The docker-compose configuration is NOT an official CI dependency; CI pipelines will use separate provisioning scripts or managed services (local compose stability guarantees do not extend to CI).
- **FR-016**: Auto-start logic MUST detect readiness via healthchecks and abort with a clear error message if services fail to become healthy within the ~60s window.

*Ambiguity markers retained pending product/engineering clarification.*

### Key Entities *(include if feature involves data)*
- **Infrastructure Service Definition**: Conceptual grouping describing each backing service (name, purpose, default port, persistence behavior, healthcheck expectation).
- **Environment Configuration**: Set of variables required by the application layer to connect to infra (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, REDIS_HOST, REDIS_PORT). No secrets committed; example values only.

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [ ] No implementation details (languages, frameworks, APIs)  
   (Note: Intentional mention of Docker Compose is intrinsic to the feature scope; verify acceptable.)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous  
- [ ] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified (Docker + Compose prerequisite)

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
  
Progress Notes:
- User description parsed ✔
- Key concepts extracted (services: PostgreSQL, Redis; actors: developers; goals: start/stop/reset infra) ✔
- Ambiguities marked (ports override, healthcheck timing, migration automation, CI usage) ✔
- User scenarios defined ✔
- Requirements generated ✔ (some pending clarifications)
- Entities identified ✔
- Review checklist pending unresolved clarifications

---
