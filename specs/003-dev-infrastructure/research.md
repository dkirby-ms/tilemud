# Research: Local Developer Data Infrastructure (Phase 0)

Feature: Local Redis & PostgreSQL containers for development/testing
Branch: 003-the-developer-needs
Date: 2025-09-28
Scope: Resolve unknowns identified in `plan.md` Phase 0 so Phase 1 design can proceed without ambiguity.

---
## Decision Matrix Summary
| Topic | Decision | Status |
|-------|----------|--------|
| Migration Approach | Pure ordered SQL files + lightweight idempotent wrapper script (no external migration lib yet) | Final |
| Connection Detail Exposure | Generate `.env.local.infra` (ignored by git) + README section; do NOT auto-merge into existing env files | Final |
| Readiness Checks | Compose native healthchecks: `pg_isready` for Postgres, `redis-cli PING`; scripts wait on health + migration completion marker | Final |
| Port Selection & Collision Handling | Defaults: PG=5438, REDIS=6380 (avoid common defaults); fail-fast with override via env vars | Final |
| Image Digest Pinning Workflow | Store canonical digests in `infrastructure/IMAGE_DIGESTS` + verify script compares running images; allow tag drift only via explicit update workflow | Final |
| Transactional Test Isolation Pattern | Document future backend implementation; interim: no-op placeholder helper that warns if invoked; maintain FR-017 in scope as design contract | Final (interim) |
| Platform Support Clarification | Linux & macOS supported; Windows via WSL2 best-effort (doc caveats on file permissions & volume performance) | Final |
| Default Credentials Strategy | Deterministic non-sensitive defaults (user: `tilemud`, db: `tilemud`, password: `tilemud_dev_pw`) surfaced only locally | Final |

---
## 1. Migration Approach
**Decision**: Use a simple ordered SQL migration directory (`infrastructure/migrations/*.sql`) applied exactly once per filename hash; track applied set in an internal file-based ledger volume-mounted to a scratch path (e.g., `/var/lib/tilemigr/state.json`) rather than introducing a migration library. Idempotency: skip already-applied hashes each startup.

**Rationale**:
- Avoids premature dependency on a backend application or Node migration package before a server exists.
- Pure SQL ensures transparency and easy diff/review.
- File-based ledger keeps logic out of the application domain while enabling re-runs.
- FR-003 / FR-010 / FR-016 require deterministic auto-application; the lightweight wrapper can satisfy under 30s constraint with small migration count.

**Alternatives Considered**:
- A) Node-based migration tool (e.g., Knex / Umzug) — adds JS runtime & deps without backend code yet; overhead unjustified.
- B) psql apply-all-each-start — violates idempotent logging visibility (re-runs each time, harder to debug partial failure scenarios).
- C) Defer migrations entirely until backend emerges — conflicts with FR-003 and test repeatability.

**Implications**:
- Need a small script (bash or Node) to compute checksum/hashes of SQL files.
- Future backend adoption can migrate the ledger table-based approach; design adapter layer so file ledger can bootstrap DB table later.

**Follow-ups**: Phase 1 will define ledger JSON schema.

---
## 2. Connection Detail Exposure
**Decision**: Generate a `.env.local.infra` file containing connection variables. Document developer either sources it or copies relevant lines into existing environment files. Do not auto-append to avoid accidental merge conflicts.

**Rationale**:
- Minimizes risk of overwriting user-managed env files.
- Makes test tooling integration trivial (explicit import path).
- Keeps secrets (which are low sensitivity here) out of committed repo.

**Alternatives Considered**:
- A) README-only: Increases manual copy errors.
- B) Auto-inject into `.env.local`: Risky side effects, merge collisions.
- C) Provide shell export script only: Harder for GUI tools that read dotenv files.

**Implications**: Add `.env.local.infra` to `.gitignore` (ensure present). Quickstart includes “source the file” step for manual shell usage.

---
## 3. Readiness Checks
**Decision**: Use Docker Compose `healthcheck` directives for each service; `infra-up.sh` waits for both healthchecks to report healthy AND migrations script to emit a readiness marker file (`/tmp/tilemigr.ready`).

**Rationale**:
- Compose-native health reduces custom polling logic.
- Postgres: `pg_isready -U $TILEMUD_PG_USER -d $TILEMUD_PG_DB` is stable and lightweight.
- Redis: `redis-cli -h localhost -p $REDIS_PORT PING` reliable indicator.
- Migration readiness marker decouples infrastructure health from schema state (FR-014 and FR-010 alignment).

**Alternatives Considered**:
- A) External polling script only: Reinvents health semantics; loses Compose integration.
- B) Application-level readiness (not present yet) — backend absent.
- C) Sleep-based delay — non-deterministic and brittle.

**Implications**: Compose file gains healthcheck sections & extended start period tolerances (e.g., Postgres start + migration window).

---
## 4. Port Selection & Collision Handling
**Decision**: Default ports: PostgreSQL = 5438, Redis = 6380. Detect collision by probing with `lsof` / fallback `nc -z`. If occupied: print error with override instructions: `export TILEMUD_PG_PORT=...` or `TILEMUD_REDIS_PORT=...`.

**Rationale**:
- Avoids overshadowing a developer’s system Postgres (5432) or Redis (6379).
- Fail-fast expectation in FR-019.

**Alternatives Considered**:
- A) Auto-random free port — Increases variability and reduces deterministic reuse; docs & tests complicated.
- B) Attempt sequential increment fallback — Hidden magic, may obscure issues.

**Implications**: Tests referencing connection assume deterministic defaults unless env overrides provided.

---
## 5. Image Digest Pinning Workflow
**Decision**: Maintain a file `infrastructure/IMAGE_DIGESTS` with lines: `postgres:18.0-alpine@sha256:<digest>` and `redis:8.2-alpine@sha256:<digest>`. Verification script:
1. Reads file
2. For each image: `docker image inspect` to compare RepoDigests
3. Non-zero exit if mismatch (FR-018 & Acceptance Scenario 8)
4. Provide guidance: run `./scripts/update-digests.sh` (future) to refresh intentionally.

**Rationale**:
- Guards against upstream tag mutation (rare but possible) ensuring deterministic dev baseline.
- Lightweight; no registry API dependency (local docker metadata sufficient after pull).

**Alternatives Considered**:
- A) Rely solely on tags — Less reproducible.
- B) Hard-code digests directly in compose — Harder manual update process; unreadable diff noise.
- C) External lock tooling — Overkill at current scale.

**Implications**: Compose will still reference tag; verification ensures digest integrity.

---
## 6. Transactional Test Isolation Pattern (Interim)
**Decision**: Provide a placeholder helper `withDbTransaction(testFn)` that currently logs a warning (no-op) because there is no backend DB access layer in this repository yet. Document migration path: when backend added, wrap each test in BEGIN; ROLLBACK pattern via a pooled connection.

**Rationale**:
- FR-017 sets expectation; providing a documented placeholder prevents silent omission.
- Avoids inventing premature Node DB layer just for wrapping.

**Alternatives Considered**:
- A) Introduce Node script w/ `pg` driver now — Adds dependencies unused elsewhere.
- B) Omit entirely — Creates future ambiguity whether requirement forgotten.

**Implications**: A follow-up feature will implement real transaction harness once backend emerges.

**Follow-ups**: Add backlog item referencing FR-017 implementation upgrade.

---
## 7. Platform Support Clarification
**Decision**: Official instructions validated for Linux & macOS; Windows users must run via WSL2. Provide guidance on enabling Docker integration & note possible slower volume performance (acceptable for local dev DB scale).

**Rationale**: Matches FR-021; avoids promising unsupported direct Windows Docker behavior.

**Alternatives**: Native Windows volume mapping (inconsistent path semantics) — higher support cost.

---
## 8. Default Credentials & Security Posture
**Decision**: Use deterministic non-sensitive credentials: user `tilemud`, password `tilemud_dev_pw`, db `tilemud`. Redis: no auth. Bind services to project network plus expose mapped host ports. Document do-not-expose externally.

**Rationale**: Satisfies FR-022 (local-only risk model) while keeping tests straightforward.

**Alternatives**: Randomly generated password each startup (would complicate test determinism and `.env.local.infra` reuse).

**Security Note**: Explicit warnings in quickstart that credentials are for local use only.

---
## 9. Environment Variable Contract (Preliminary)
| Variable | Default | Purpose | Overridable |
|----------|---------|---------|-------------|
| TILEMUD_PG_PORT | 5438 | Host port for Postgres | Yes |
| TILEMUD_REDIS_PORT | 6380 | Host port for Redis | Yes |
| TILEMUD_PG_USER | tilemud | DB username | Yes |
| TILEMUD_PG_PASSWORD | tilemud_dev_pw | DB password | Yes |
| TILEMUD_PG_DB | tilemud | DB name | Yes |
| TILEMUD_INFRA_NETWORK | tilemud_net | Compose network name | Yes |
| TILEMUD_PG_VOLUME | tilemud_pg_data | Named volume for Postgres | Yes |
| TILEMUD_PG_IMAGE | postgres:18.0-alpine | Image tag (validated by digest) | Yes (advanced) |
| TILEMUD_REDIS_IMAGE | redis:8.2-alpine | Image tag (validated by digest) | Yes (advanced) |

---
## 10. Risk & Mitigation
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| Missing backend delays real transactional isolation | Medium | High (no backend yet) | Placeholder helper + backlog note |
| Developers forget to run verify script | Low | Medium | Include in quickstart & add optional pre-test check later |
| Port defaults still conflict in some environments | Low | Low | Clear override env vars + fail-fast message |
| Migration script error leaves DB partially migrated | Medium | Low | Use transaction per SQL file; abort & surface failing file |
| Digest mismatch false negative if image not pulled | Low | Low | Force `docker pull` step in verify script when digest absent |

---
## 11. Open Follow-Ups (Deferred – not blockers)
- Promote transaction helper to real implementation when backend added.
- Add `update-digests.sh` convenience script (Phase after core infra).
- Consider optional seed data feature (future FR set) with opt-in flag.
- Evaluate moving ledger from file to DB table once backend persists migrations state.

---
## 12. Alignment with Functional Requirements
| FR | Coverage Note |
|----|---------------|
| FR-001 | One-liner `infra-up.sh` planned + compose setup |
| FR-002 | `.env.local.infra` generation decision |
| FR-003/010/016 | Migration wrapper with ledger & idempotent apply |
| FR-004 | Redis service with healthcheck |
| FR-005 | Fail-fast checks (docker daemon, ports) |
| FR-006 | `infra-down.sh` + `infra-reset.sh` plan |
| FR-007 | Prefixed names via env defaults |
| FR-008 | Docs explicitly local-only; CI deferred |
| FR-009 | Non-interactive scripts |
| FR-011 | No seed data; documented exclusion |
| FR-012 | Volume vs ephemeral Redis confirmed |
| FR-013 | Distinct ports + deterministic defaults |
| FR-014 | Healthchecks + readiness marker |
| FR-017 | Placeholder documented (future enhancement) |
| FR-018 | Digest pin + verification workflow |
| FR-019 | Port probe + fail-fast override guidance |
| FR-020 | Resource baseline checks (script pre-flight) |
| FR-021 | Platform support clarified |
| FR-022 | Local-only unauth Redis rationale |
| FR-023 | Naming convention enforced via env defaults |

No unresolved unknowns remain for Phase 1.

---
## 13. Implementation Preview (Non-Binding)
High-level script sequence (`infra-up.sh`):
1. Pre-flight: docker available? resources? ports free? → else exit 1.
2. Ensure digest file present; pull images if not local.
3. `docker compose -f infrastructure/docker-compose.dev.yml up -d`.
4. Wait for service healthchecks.
5. Run migration wrapper (idempotent) inside ephemeral utility container or host `psql`.
6. Emit readiness marker & generate `.env.local.infra`.
7. Print summary (connection details + next steps + verify hint).

This preview informs design but final behavior governed by Phase 1 contracts.

---
**End of Phase 0 Research – All identified unknowns resolved.**
