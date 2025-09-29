# Data Model: Local Developer Data Infrastructure

Feature: Local Redis & PostgreSQL Containers  
Branch: 003-the-developer-needs  
Status: Phase 1 Draft (pre-implementation)

This document captures conceptual entities required to satisfy Functional Requirements (FR-001 – FR-023) and provides stable naming conventions that the implementation, scripts, and tests will reference.

---
## 1. Entities Overview
| Entity | Purpose | Lifecycle | Persistence |
|--------|---------|-----------|-------------|
| InfrastructureEnvironment | Logical grouping of Postgres + Redis containers, network, volumes | Created by `infra-up` / destroyed by `infra-down`/`infra-reset` | Docker runtime + named volume (Postgres) |
| ConnectionDescriptor | Consumable connection information (DB + Redis) for app/tests | Generated at successful readiness | Ephemeral file `.env.local.infra` |
| MigrationLedger | Tracks which SQL migration files have been applied | Created first migration run | File-based JSON (mounted path) |
| ResourceBaselineReport | Reports local machine resource check results | Generated at pre-flight stage | Ephemeral stdout (optionally log file) |
| ImageDigestPolicy | Captures expected image tags & digests for verification | Manual update workflow | `IMAGE_DIGESTS` file |

---
## 2. InfrastructureEnvironment
Fields:
- networkName (string; default: `tilemud_net`)
- pgContainerName (string; default: `tilemud_postgres`)
- redisContainerName (string; default: `tilemud_redis`)
- pgVolumeName (string; default: `tilemud_pg_data`)
- pgImageTag (string; default: `postgres:18.0-alpine`)
- pgImageDigest (string; derived from `IMAGE_DIGESTS`)
- redisImageTag (string; default: `redis:8.2-alpine`)
- redisImageDigest (string; derived from `IMAGE_DIGESTS`)
- status (enum: starting|migrating|ready|error)

Constraints:
- Names MUST be unique among running local containers.
- Prefix `tilemud_` enforced for cleanup simplicity (FR-023).

---
## 3. ConnectionDescriptor
Fields:
- dbHost (string; default `localhost`)
- dbPort (int; default 5438 or overridden by `TILEMUD_PG_PORT`)
- dbName (string; default `tilemud`)
- dbUser (string; default `tilemud`)
- dbPassword (string; default `tilemud_dev_pw`)
- redisHost (string; default `localhost`)
- redisPort (int; default 6380 or overridden by `TILEMUD_REDIS_PORT`)

Output Format: dotenv key=value pairs written to `.env.local.infra`.

Validation:
- Ports validated as free before compose up (FR-019).
- File overwritten atomically (write temp then move) to avoid partial writes.

---
## 4. MigrationLedger
Purpose: Provide idempotent tracking of applied SQL migrations (FR-003, FR-010, FR-016).

Storage: JSON file inside a lightweight persistent location *separate* from the main DB volume to allow manual reset without volume purge if desired. (Initial implementation may colocate within volume path for simplicity; design allows relocation.)

Schema Example:
```json
{
  "version": 1,
  "applied": [
    {
      "filename": "001_init.sql",
      "checksum": "sha256:...",
      "appliedAt": "2025-09-28T12:34:56Z"
    }
  ]
}
```

Rules:
- Filenames MUST follow `NNN_description.sql` increasing numeric prefix.
- Checksum: sha256 of file content at apply time.
- On checksum mismatch for already applied filename → abort with explicit integrity warning.

---
## 5. ResourceBaselineReport
Fields:
- cpuCount (int)
- freeMemMB (int)
- freeDiskMB (int for docker volume storage path)
- warnings (array<string>)
- pass (boolean)

Logic:
- pass=true if thresholds met; else pass=false only when docker unavailable or catastrophic shortage; otherwise pass with warnings (FR-020).

---
## 6. ImageDigestPolicy
File `IMAGE_DIGESTS` lines format:
```
postgres:18.0-alpine@sha256:<digest>
redis:8.2-alpine@sha256:<digest>
```
Parsed objects:
- repo (string)
- tag (string)
- digest (string)

Validation logic (infra-verify):
1. Parse lines ignoring comments (`#`).
2. For each repo:tag check local docker inspect RepoDigests includes digest.
3. If missing image locally, perform `docker pull repo:tag` then re-check.
4. Non-zero exit if digest absence persists.

---
## 7. Derived Behaviors & Relationships
- `infra-up` populates InfrastructureEnvironment, then produces ConnectionDescriptor after MigrationLedger updated.
- MigrationLedger relies on ConnectionDescriptor (DB connectivity) to apply SQL (if using container-exec pattern this is implicit).
- ImageDigestPolicy validated both by `infra-verify` and (optionally) at `infra-up` pre-flight (warning mode to avoid blocking initial spin-up if user hasn't pulled yet—final behavior determined in Phase 2 tasks).

---
## 8. Open Extensions (Deferred)
- Promote MigrationLedger into a real `schema_migrations` database table (bridge path ensures backwards compatibility).
- Add optional seed dataset entity once future feature approves.
- Add telemetry counters (startup time, migration duration) for DX metrics.

---
## 9. Traceability Matrix
| FR | Entity Reference |
|----|------------------|
| FR-001 | InfrastructureEnvironment |
| FR-002 | ConnectionDescriptor |
| FR-003/010/016 | MigrationLedger |
| FR-004 | InfrastructureEnvironment (redisContainerName) |
| FR-005 | ResourceBaselineReport |
| FR-006 | InfrastructureEnvironment + pgVolumeName |
| FR-007 | InfrastructureEnvironment (prefixed names) |
| FR-008 | (Documentation – not data entity) |
| FR-009 | (Script design) |
| FR-011 | (Explicit exclusion) |
| FR-012 | pgVolumeName & ephemeral Redis (no volume field) |
| FR-013 | ConnectionDescriptor (ports) |
| FR-014 | Status transitions + readiness marker (status) |
| FR-017 | (Future transactional layer) |
| FR-018 | ImageDigestPolicy |
| FR-019 | ConnectionDescriptor (ports) |
| FR-020 | ResourceBaselineReport |
| FR-021 | (Documentation) |
| FR-022 | (Documentation) |
| FR-023 | InfrastructureEnvironment (name prefix) |

---
**End of Data Model (Phase 1)**
