# Contract: Environment Variables (Infrastructure)

| Variable | Default | Description | FR Reference |
|----------|---------|-------------|--------------|
| TILEMUD_PG_PORT | 5438 | Host port for Postgres | FR-019 |
| TILEMUD_REDIS_PORT | 6380 | Host port for Redis | FR-019 |
| TILEMUD_PG_USER | tilemud | Local Postgres user | FR-002 |
| TILEMUD_PG_PASSWORD | tilemud_dev_pw | Local Postgres password (low sensitivity) | FR-002 |
| TILEMUD_PG_DB | tilemud | Local Postgres database name | FR-002 |
| TILEMUD_INFRA_NETWORK | tilemud_net | Docker network name | FR-007 / FR-023 |
| TILEMUD_PG_VOLUME | tilemud_pg_data | Persistent Postgres volume | FR-012 / FR-023 |
| TILEMUD_PG_IMAGE | postgres:18.0-alpine | Postgres image tag | FR-018 |
| TILEMUD_REDIS_IMAGE | redis:8.2-alpine | Redis image tag | FR-018 |

## Conventions
- All infrastructure names prefixed `tilemud_` (FR-023).
- Overriding ports should be rare; tests assume defaults unless environment variables are explicitly set.

## Security Considerations
- Credentials are for local development only; never reuse in any shared or production environment.
- Redis intentionally lacks authentication (FR-022); do not expose mapped ports beyond loopback.
