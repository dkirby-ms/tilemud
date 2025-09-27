# TileMUD Game Server

Real-time multiplayer tile-based game server built with Node.js, TypeScript, Colyseus, and PostgreSQL.

## 🎯 Overview

TileMUD is a scalable real-time multiplayer game featuring:

- **Arena Mode**: Large-scale PvP with 200+ concurrent players
- **Battle Mode**: Instanced conflict resolution with AI elasticity  
- **Real-time Communication**: WebSocket-based tile placement and chat
- **Persistent Systems**: Guild management, replay storage, and player progression
- **Advanced Features**: Rate limiting, moderation tools, and comprehensive monitoring

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   Web Client    │ ←→ │   HTTP API   │ ←→ │ PostgreSQL  │
└─────────────────┘    │              │    │             │
                       │   Express    │    │ Replays     │
┌─────────────────┐    │   Server     │    │ Players     │
│  WebSocket      │ ←→ │              │    │ Guilds      │
│  Game Client    │    └──────────────┘    └─────────────┘
└─────────────────┘           │
        │                     │            ┌─────────────┐
        ▼                     └────────── →│    Redis    │
┌─────────────────┐                       │             │
│   Colyseus      │                       │ Rate Limit  │
│   Game Rooms    │                       │ Sessions    │
│                 │                       │ Cache       │
│ • ArenaRoom     │                       └─────────────┘
│ • BattleRoom    │
└─────────────────┘
```

### Key Components

- **HTTP API**: RESTful endpoints for authentication, arena management, guild operations, and replay access
- **WebSocket Rooms**: Real-time game logic using Colyseus framework
- **Service Layer**: Business logic for chat delivery, moderation, AI elasticity, and soft-fail monitoring
- **Persistence Layer**: PostgreSQL repositories with transaction support
- **Monitoring**: Prometheus metrics, structured logging, and health checks

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (LTS recommended)
- PostgreSQL 13+
- Redis 6+
- Docker (optional, for local database setup)

### Installation

```bash
# Clone and navigate to server directory
cd tilemud/server

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### Database Setup

Option 1 - Docker (Recommended):
```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Run migrations
npm run db:migrate
```

Option 2 - Local Installation:
```bash
# Create database
createdb tilemud

# Configure DATABASE_URL in .env
export DATABASE_URL="postgresql://postgres:password@localhost:5432/tilemud"

# Run migrations
npm run db:migrate
```

### Development Server

```bash
# Start development server with hot reload
npm run dev

# Server endpoints:
# - HTTP API: http://localhost:3001
# - WebSocket: ws://localhost:3000  
# - Metrics: http://localhost:3001/metrics
# - Health: http://localhost:3001/health
```

### Production Deployment

```bash
# Build TypeScript
npm run build

# Start production server
npm run start

# Or with PM2 process manager
npm install -g pm2
npm run start:prod
```

## 🎮 Game Modes

### Arena Mode (FR-002)
- Large-scale PvP with 100+ players per arena
- Real-time tile placement with conflict resolution
- Tiered matchmaking (Bronze, Silver, Gold)
- Chat system with arena-wide and private messaging
- Soft-fail monitoring for connection stability

### Battle Mode (FR-001)  
- Instanced 8-16 player battles
- High-frequency conflict resolution
- AI entity spawning for player balance
- Battle-specific rule sets and victory conditions

## 🔧 Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/tilemud
REDIS_URL=redis://localhost:6379

# Server
NODE_ENV=development
PORT=3001
WS_PORT=3000
LOG_LEVEL=info

# Game Settings  
ARENA_MAX_PLAYERS=200
BATTLE_MAX_PLAYERS=16
TILE_RATE_LIMIT=10
CHAT_RATE_LIMIT=5

# Monitoring
METRICS_PORT=9090
PROMETHEUS_ENABLED=true
HEALTH_CHECK_INTERVAL=30000

# Features
AI_ELASTICITY_ENABLED=true
REPLAY_RETENTION_HOURS=72
MODERATION_ENABLED=true
```

### Docker Configuration

```yaml
# docker-compose.yml excerpt
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tilemud
      POSTGRES_USER: postgres  
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
```

## 📡 API Reference

### Authentication
```bash
# Create session
POST /auth/session
{
  "clientToken": "client-generated-uuid"
}

# Response
{
  "sessionId": "sess_abc123",
  "expiresAt": "2024-01-01T12:00:00Z"
}
```

### Arena Management
```bash
# List arenas
GET /arenas?tier=bronze&status=active

# Get arena details
GET /arenas/{arenaId}
```

### Guild Operations
```bash
# Create guild
POST /guilds
{
  "name": "unique-guild-name",
  "displayName": "My Awesome Guild"
}

# Join guild
POST /guilds/{guildId}/join
```

### Replay System
```bash
# Get replay metadata
GET /replays/{replayId}

# Stream replay events
GET /replays/{replayId}/stream
```

## 🎮 WebSocket Protocol

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  // Join arena room
  ws.send(JSON.stringify({
    type: 'join_arena',
    data: { tier: 'bronze', displayName: 'Player1' }
  }));
});
```

### Game Actions
```javascript
// Place tile
ws.send(JSON.stringify({
  type: 'place_tile',
  data: { x: 10, y: 15, color: 'red' }
}));

// Send chat message
ws.send(JSON.stringify({
  type: 'chat',
  data: { content: 'Hello!', channelType: 'arena' }
}));

// Heartbeat (connection keepalive)
ws.send(JSON.stringify({
  type: 'heartbeat',
  data: { timestamp: Date.now() }
}));
```

### Server Events
```javascript
ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  switch (message.type) {
    case 'tiles_updated':
      // Handle tile placement updates
      break;
    case 'chat_message':
      // Handle incoming chat message
      break;
    case 'player_joined':
      // Handle player join/leave events
      break;
  }
});
```

## 🧪 Testing

### Unit Tests
```bash
# Run all unit tests
npm run test

# Run specific test suite
npm run test -- --grep "RateLimitService"

# Watch mode for development
npm run test:watch
```

### Integration Tests
```bash
# Run integration tests
npm run test:integration

# Test specific functionality
npm run test:integration -- --grep "arena.tilePlacement"
```

### Load Testing
```bash
# Arena load test (200 concurrent users)
cd tools/load
npm run arena-load-test

# Battle room stress test
npm run battle-load-test

# Custom configuration
npm run arena-load-test -- --users 500 --duration 300 --server ws://staging:3000
```

### Contract Testing
```bash
# API contract tests
npm run test:contract

# Validate OpenAPI spec compliance
npm run test:api-spec
```

## 📊 Monitoring & Observability

### Metrics Collection

The server exposes Prometheus metrics at `/metrics`:

```bash
# View all metrics
curl http://localhost:3001/metrics

# Key metrics:
actions_total{action_type="place_tile"}          # Total tile placements
tile_tick_duration_ms                           # Processing latency  
conflict_resolution_duration_ms                 # Conflict handling time
current_players_connected                       # Live player count
chat_messages_total{channel_type="arena"}       # Chat volume
rate_limit_hits_total                          # Rate limiting events
```

### Health Checks
```bash
# Basic health check
curl http://localhost:3001/health

# Detailed health status
curl http://localhost:3001/health/detailed
```

### Structured Logging
```javascript
// Application logs with context
{
  "level": "info",
  "timestamp": "2024-01-01T12:00:00.000Z", 
  "service": "ArenaRoom",
  "event": "player_joined",
  "arenaId": "arena_abc123",
  "playerId": "player_def456",
  "playerCount": 42,
  "message": "Player joined arena"
}
```

### Performance Monitoring
```bash
# Real-time metrics
watch -n 1 'curl -s http://localhost:3001/metrics | grep current_players_connected'

# Memory usage
curl http://localhost:3001/metrics | grep nodejs_heap_size_used_bytes

# Database query performance  
curl http://localhost:3001/metrics | grep db_query_duration_ms
```

## 🔒 Security & Rate Limiting

### Rate Limiting Rules
- **Chat Messages**: 5 per 10 seconds per player
- **Tile Placement**: 10 per 5 seconds per player  
- **API Requests**: 100 per minute per IP
- **WebSocket Connections**: 5 per minute per IP

### Input Validation
All HTTP endpoints use Zod schema validation:

```typescript
const PlaceTileSchema = z.object({
  x: z.number().int().min(0).max(999),
  y: z.number().int().min(0).max(999),
  color: z.enum(['red', 'blue', 'green', 'yellow'])
});
```

### Moderation Features
- **Player Muting**: Temporary chat restrictions
- **Player Kicking**: Immediate room ejection
- **Block Lists**: Player-to-player communication blocking
- **Guild Dissolution**: Administrative guild removal

## 🏗️ Development

### Project Structure
```
server/
├── src/
│   ├── api/           # HTTP API routes and middleware
│   ├── application/   # Business logic services
│   ├── domain/        # Entity definitions and interfaces
│   ├── infra/         # Infrastructure (DB, monitoring, etc.)
│   ├── ws/           # WebSocket room implementations
│   └── bootstrap/     # Server initialization
├── tests/            # Test suites
├── migrations/       # Database migrations
└── tools/           # Development and deployment tools
```

### Adding New Features

1. **Define Domain Entities** (`domain/entities/`)
2. **Create Repository Interfaces** (`domain/`)  
3. **Implement Repositories** (`infra/persistence/`)
4. **Add Application Services** (`application/services/`)
5. **Create API Routes** (`api/routes/`)
6. **Add WebSocket Handlers** (`ws/rooms/`)
7. **Write Tests** (`tests/`)

### Code Quality
```bash
# Linting
npm run lint

# Type checking
npm run type-check

# Formatting  
npm run format

# Pre-commit hooks
npm run pre-commit
```

### Database Migrations
```bash
# Create new migration
npm run migration:create AddPlayerStats

# Run pending migrations
npm run db:migrate

# Rollback last migration
npm run db:migrate:down
```

## 🚀 Deployment

### Docker Deployment
```bash
# Build production image
docker build -t tilemud-server .

# Run with docker-compose
docker-compose up -d
```

### PM2 Process Management
```bash
# Install PM2 globally
npm install -g pm2

# Start with ecosystem file
pm2 start ecosystem.config.js

# Monitor processes
pm2 monit

# View logs
pm2 logs tilemud-server
```

### Environment-Specific Configuration
```bash
# Development
NODE_ENV=development npm run start

# Staging  
NODE_ENV=staging npm run start

# Production
NODE_ENV=production npm run start
```

## 📈 Performance Optimization

### Database Optimization
- Connection pooling with configurable limits
- Query optimization with indexes
- Read replica support for heavy queries
- Connection caching for frequently accessed data

### WebSocket Optimization  
- Message batching for tile updates
- Selective broadcasting based on player proximity
- Connection state management with heartbeat monitoring
- Graceful degradation under high load

### Caching Strategy
- Redis for session storage and rate limiting
- In-memory caching for frequently accessed game state
- Cache invalidation on state changes
- Configurable TTL values per data type

## 🐛 Troubleshooting

### Common Issues

**High Memory Usage:**
```bash
# Monitor heap size
curl http://localhost:3001/metrics | grep nodejs_heap

# Enable garbage collection logging
NODE_OPTIONS="--expose-gc" npm run start

# Heap snapshot for analysis
curl http://localhost:3001/debug/heap-snapshot
```

**Database Connection Issues:**
```bash
# Test PostgreSQL connectivity
pg_isready -h localhost -p 5432

# Check connection pool status
curl http://localhost:3001/debug/db-status

# View active connections
psql -c "SELECT * FROM pg_stat_activity WHERE datname='tilemud';"
```

**WebSocket Performance Issues:**
```bash
# Monitor WebSocket connections
curl http://localhost:3001/metrics | grep ws_connections

# Check message queue depth
curl http://localhost:3001/debug/ws-status

# Enable WebSocket debugging
DEBUG=ws npm run dev
```

### Debug Mode
```bash
# Enable comprehensive debugging
DEBUG=tilemud:* npm run dev

# Debug specific modules
DEBUG=tilemud:room,tilemud:db npm run dev

# Profile performance
NODE_OPTIONS="--inspect" npm run dev
# Then connect Chrome DevTools to localhost:9229
```

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make changes with tests
4. Run full test suite: `npm run test:all`
5. Submit pull request

### Testing Requirements
- Unit tests for all new services
- Integration tests for API endpoints
- Load tests for performance-critical features  
- Contract tests for external interfaces

### Code Standards
- TypeScript with strict mode
- ESLint + Prettier configuration
- Conventional commit messages
- 100% test coverage for critical paths

## 📚 Additional Resources

- [API Documentation](http://localhost:3001/docs)
- [WebSocket Protocol Guide](./docs/websocket-protocol.md)
- [Database Schema](./docs/database-schema.md)
- [Performance Tuning Guide](./docs/performance.md)
- [Deployment Guide](./docs/deployment.md)
- [Monitoring Setup](./docs/monitoring.md)

## 📄 License

MIT License - see [LICENSE](../LICENSE) file for details.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/tilemud/server/issues)
- **Documentation**: [Wiki](https://github.com/tilemud/server/wiki)
- **Discord**: [Community Server](https://discord.gg/tilemud)

---

Built with ❤️ using TypeScript, Colyseus, and PostgreSQL.