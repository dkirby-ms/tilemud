# Local Developer Data Infrastructure

Infrastructure for local development environment setup with Docker containers.

This directory provides a complete local data infrastructure for TileMUD development, consisting of:
- **PostgreSQL 18** (persistent storage via Docker volume)
- **Redis 8.2** (ephemeral in-memory cache)
- **Migration system** (idempotent SQL file execution)
- **Verification tooling** (image digest security checks)

## Quick Start

### 1. Start Infrastructure
```bash
./infrastructure/scripts/infra-up.sh
```

This will:
- Check Docker availability and port conflicts
- Pull and start PostgreSQL + Redis containers
- Apply database migrations
- Generate `.env.local.infra` with connection details
- Display ready summary

### 2. Verify Setup
```bash
./infrastructure/scripts/infra-verify.sh
```

Checks that running container images match expected security digests.

### 3. Use the Services
After startup, services are available at:
- **PostgreSQL**: `localhost:5438` (user: `tilemud`, db: `tilemud`, password: `tilemud_dev_pw`)  
- **Redis**: `localhost:6380` (no auth required)

Connection details are automatically written to `.env.local.infra` in the project root.

### 4. Manage Infrastructure
```bash
# Stop containers (keeps data)
./infrastructure/scripts/infra-down.sh

# Reset everything (deletes all data)
./infrastructure/scripts/infra-reset.sh
```

## Configuration

All settings can be overridden via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TILEMUD_PG_PORT` | 5438 | Host port for PostgreSQL |
| `TILEMUD_REDIS_PORT` | 6380 | Host port for Redis |
| `TILEMUD_PG_USER` | tilemud | PostgreSQL username |
| `TILEMUD_PG_PASSWORD` | tilemud_dev_pw | PostgreSQL password |
| `TILEMUD_PG_DB` | tilemud | PostgreSQL database name |

Example with custom ports:
```bash
TILEMUD_PG_PORT=5440 TILEMUD_REDIS_PORT=6382 ./infrastructure/scripts/infra-up.sh
```

## File Structure

```
infrastructure/
├── docker-compose.dev.yml      # Container definitions
├── IMAGE_DIGESTS               # Security digest pins
├── migrations/                 # SQL migration files
│   ├── 001_init.sql           # Initial baseline
│   └── ledger.json            # Applied migrations log
└── scripts/
    ├── infra-up.sh            # Start infrastructure
    ├── infra-down.sh          # Stop infrastructure  
    ├── infra-reset.sh         # Reset all data
    ├── infra-verify.sh        # Verify image digests
    ├── migrate.sh             # Apply migrations
    └── infra-common.sh        # Shared utilities
```

## Security

- Container images are pinned to specific SHA256 digests in `IMAGE_DIGESTS`
- Use `infra-verify.sh` to detect image drift
- Credentials are for local development only - never use in production
- Redis runs without authentication (local development only)
- All containers run in isolated Docker network

## Troubleshooting

### Port Conflicts
If startup fails due to port conflicts:
```bash
TILEMUD_PG_PORT=5440 ./infrastructure/scripts/infra-up.sh
```

### Docker Issues
Ensure Docker is running:
```bash
docker info
```

### Migration Failures
Check migration logs and verify PostgreSQL container health:
```bash
docker compose -f infrastructure/docker-compose.dev.yml ps
docker compose -f infrastructure/docker-compose.dev.yml logs postgres
```

### Reset Everything
If you encounter persistent issues:
```bash
./infrastructure/scripts/infra-reset.sh
./infrastructure/scripts/infra-up.sh
```

## For More Details

See the complete quickstart guide at: [`../specs/003-the-developer-needs/quickstart.md`](../specs/003-the-developer-needs/quickstart.md)

For contract specifications and advanced usage, see the contracts directory: [`../specs/003-the-developer-needs/contracts/`](../specs/003-the-developer-needs/contracts/)