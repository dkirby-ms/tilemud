# Quickstart: Scalable Game Service Backend (003-server)

## Prerequisites
- Node.js LTS (>=18)
- PostgreSQL (>=13) running on localhost:5432
- Redis (>=6) running on localhost:6379
- Docker (optional, for database setup)

## Quick Database Setup with Docker
```bash
# Start PostgreSQL and Redis services
cd server/
docker-compose up -d postgres redis

# Verify services are running
docker-compose ps
```

## Install Dependencies
```bash
cd server/
npm install

# Install load testing tools (optional)
cd tools/load/
npm install
cd ../..
```

## Database Setup
```bash
# Run database migrations
npm run db:migrate

# Seed with test data (optional)
npm run db:seed
```

## Run Development Server
```bash
# Start server with development configuration
npm run dev

# Server will be available at:
# - HTTP API: http://localhost:3001
# - WebSocket: ws://localhost:3000
# - Metrics: http://localhost:3001/metrics
# - Health Check: http://localhost:3001/health
```

## Production Server
```bash
# Build TypeScript to JavaScript
npm run build

# Start production server
npm run start

# Or using PM2 for process management
npm install -g pm2
npm run start:prod
```

## Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

Key environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `NODE_ENV`: development | production
- `LOG_LEVEL`: debug | info | warn | error
- `COLYSEUS_SECRET`: Secret for room authentication

## API Testing with curl

### Authentication
```bash
# Create session with client token
curl -X POST http://localhost:3001/auth/session \
  -H "Content-Type: application/json" \
  -d '{"clientToken": "test-client-token-123"}'

# Response:
# {"sessionId": "sess_abc123", "expiresAt": "2024-01-01T12:00:00Z"}
```

### Arena Management
```bash
# List available arenas
curl http://localhost:3001/arenas

# Get specific arena details  
curl http://localhost:3001/arenas/arena_abc123
```

### Guild Operations
```bash
# Create a new guild
curl -X POST http://localhost:3001/guilds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sess_abc123" \
  -d '{"name": "TestGuild", "displayName": "Test Guild"}'
```

### Replay Access
```bash
# Get replay metadata
curl http://localhost:3001/replays/replay_abc123

# Stream replay events (if available)
curl http://localhost:3001/replays/replay_abc123/stream
```

## WebSocket Client Testing

### Basic Arena Connection
```bash
# Install wscat for WebSocket testing
npm install -g wscat

# Connect to arena room
wscat -c ws://localhost:3000

# Send messages (after connection):
{"type": "join_arena", "data": {"tier": "bronze", "displayName": "TestPlayer"}}
{"type": "place_tile", "data": {"x": 10, "y": 15, "color": "red"}}
{"type": "chat", "data": {"content": "Hello arena!", "channelType": "arena"}}
{"type": "heartbeat", "data": {"timestamp": 1704067200000}}
```

### Battle Room Connection
```bash
# Connect to battle instance
wscat -c ws://localhost:3000

# Join battle:
{"type": "join_battle", "data": {"instanceId": "battle_123", "battleType": "small", "displayName": "Warrior"}}
{"type": "place_tile", "data": {"x": 50, "y": 50, "color": "blue"}}
```

## Sample WebSocket Client Script
```javascript
// save as test-client.js
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
    console.log('Connected to server');
    
    // Join arena
    ws.send(JSON.stringify({
        type: 'join_arena',
        data: { tier: 'bronze', displayName: 'TestBot' }
    }));
    
    // Place tiles every 2 seconds
    setInterval(() => {
        ws.send(JSON.stringify({
            type: 'place_tile',
            data: { 
                x: Math.floor(Math.random() * 100), 
                y: Math.floor(Math.random() * 100), 
                color: 'green' 
            }
        }));
    }, 2000);
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('Received:', message.type, message);
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

// Run with: node test-client.js
```

## Rate Limit Testing
```bash
# Test chat rate limiting (>5 messages per 10 seconds)
for i in {1..10}; do
  echo '{"type": "chat", "data": {"content": "Spam message '$i'", "channelType": "arena"}}' | wscat -c ws://localhost:3000 -x
  sleep 0.5
done

# Expected: rate_limited error after 5th message
```

## Load Testing
```bash
# Arena load test with 50 users for 60 seconds
cd server/tools/load/
npm run arena-load-test -- --users 50 --duration 60

# Battle room conflict testing
npm run battle-load-test -- --battles 5 --intensity 300

# Full load test suite
npm run full-load-test
```

## Monitoring & Observability
```bash
# View Prometheus metrics
curl http://localhost:3001/metrics | grep -E "(actions_total|tile_tick_duration)"

# Check health status
curl http://localhost:3001/health

# View structured logs
tail -f logs/server.log | jq '.'

# Monitor specific arena
curl http://localhost:3001/arenas/arena_123 | jq '.playerCount'
```

## Troubleshooting

### Common Issues

**Database Connection Failed:**
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Test connection
psql -h localhost -U postgres -d tilemud
```

**Redis Connection Failed:**
```bash
# Check Redis is running
redis-cli ping

# Should return PONG
```

**WebSocket Connection Refused:**
```bash
# Check server is listening on correct port
netstat -tlnp | grep 3000

# Check for port conflicts
lsof -i :3000
```

**High Memory Usage:**
```bash
# Monitor Node.js heap
curl http://localhost:3001/metrics | grep nodejs_heap

# Enable heap profiling
NODE_OPTIONS="--inspect" npm run dev
```

### Performance Debugging
```bash
# Enable debug logging
DEBUG=tilemud:* npm run dev

# Profile WebSocket messages
DEBUG=ws npm run dev

# Monitor metrics in real-time
watch -n 1 'curl -s http://localhost:3001/metrics | grep current_players_connected'
```

## Development Workflow
```bash
# Start development with hot reload
npm run dev

# Run tests
npm run test
npm run test:integration
npm run test:load

# Lint and format
npm run lint
npm run format

# Build for production
npm run build

# View API documentation
npm run docs:serve
```

## Next Steps
- Review API documentation at `/docs` endpoint
- Explore integration tests in `tests/` directory
- Check load testing results for performance baselines
- Monitor metrics during development
- Set up CI/CD pipeline with automated testing

For detailed development setup, see `server/README.md`.
