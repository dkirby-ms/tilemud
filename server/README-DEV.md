# TileMUD Server Development Setup

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- npm

## Quick Start

1. **Start the infrastructure services (Redis + PostgreSQL):**
   ```bash
   npm run infra:up
   ```

2. **Wait for services to be ready:**
   ```bash
   npm run test:wait
   ```

3. **Run tests:**
   ```bash
   npm test
   ```

4. **Stop infrastructure when done:**
   ```bash
   npm run infra:down
   ```

## Available Scripts

### Infrastructure Management
- `npm run infra:up` - Start Redis and PostgreSQL containers
- `npm run infra:down` - Stop containers
- `npm run infra:logs` - View container logs
- `npm run infra:clean` - Stop containers and remove volumes

### Testing
- `npm test` - Run all tests (requires infrastructure)
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests (requires infrastructure)
- `npm run test:contract` - Run contract tests (requires infrastructure)
- `npm run test:ci` - Full CI pipeline (start infra, test, cleanup)
- `npm run test:watch` - Run tests in watch mode

### Development
- `npm run dev:server` - Start development server
- `npm run build` - Build TypeScript
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

## Test Types

### Unit Tests (`tests/unit/`)
- Test individual components in isolation
- Use mocked dependencies
- Fast execution

### Integration Tests (`tests/integration/`)
- Test component interactions
- Require Redis and PostgreSQL
- Test real service dependencies

### Contract Tests (`tests/contract/`)
- Test API contracts
- Require full infrastructure
- Validate request/response formats

## Configuration

The server uses different configurations for different environments:

- **Development**: `.env.development`
- **Test**: `.env.test` 
- **Production**: `.env.production` (not included)

Environment variables are loaded based on `NODE_ENV`.

## Database Setup

The PostgreSQL containers automatically run migrations on startup from the `migrations/` directory.

Two database instances are provided:
- **Development**: `localhost:5432/tilemud_dev`
- **Test**: `localhost:5433/tilemud_test`

## Troubleshooting

### Services Won't Start
```bash
# Check if ports are in use
lsof -i :5432 -i :5433 -i :6379

# Force cleanup
npm run infra:clean
```

### Tests Fail with Connection Errors
```bash
# Ensure services are running
npm run infra:up

# Wait for services to be ready
npm run test:wait

# Check service status
docker ps
```

### Reset Everything
```bash
npm run infra:clean
npm run infra:up
npm run test:wait
npm test
```