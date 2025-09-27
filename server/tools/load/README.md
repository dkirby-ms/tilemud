# TileMUD Load Testing Tools

Load testing suite for TileMUD game server performance validation and stress testing.

## Overview

This directory contains specialized load testing tools designed to validate:

- **Arena Mode**: Large-scale PvP with 200+ concurrent users
- **Battle Mode**: High-frequency conflict resolution with AI elasticity
- **WebSocket Performance**: Connection stability and message throughput
- **Metrics Collection**: Real-time monitoring under load

## Tools

### `arena-load-test.ts`
Tests arena game mode with concurrent users placing tiles and chatting.

**Features:**
- Simulates 200 concurrent arena users (configurable)
- Tile placement with conflict detection
- Chat message broadcasting
- Heartbeat/latency monitoring
- Connection stability testing

**Usage:**
```bash
# Default test (200 users, 5 minutes)
npm run arena-load-test

# Custom configuration
npm run arena-load-test -- --users 300 --duration 180 --server ws://staging:3000

# Quick smoke test
npm run quick-test
```

**Options:**
- `--server <url>`: WebSocket server URL (default: `ws://localhost:3000`)
- `--users <number>`: Concurrent users (default: 200)
- `--duration <seconds>`: Test duration (default: 300)
- `--tile-rate <ms>`: Tile placement interval (default: 2000)
- `--chat-rate <ms>`: Chat message interval (default: 10000)

### `battle-load-test.ts`
Tests battle room mode with intentional conflict generation and AI spawning.

**Features:**
- Multiple concurrent battle instances
- Aggressive conflict generation (same coordinates)
- AI entity spawn triggering
- Conflict resolution time measurement
- Throughput analysis

**Usage:**
```bash
# Default test (10 battles, 8 players each)
npm run battle-load-test

# High-intensity conflict test
npm run battle-load-test -- --battles 20 --intensity 200 --duration 180
```

**Options:**
- `--server <url>`: WebSocket server URL
- `--battles <number>`: Number of battle instances (default: 10)
- `--players <number>`: Players per battle (default: 8)
- `--duration <seconds>`: Test duration (default: 180)
- `--intensity <ms>`: Tile placement interval - lower = more conflicts (default: 500)

## Installation

```bash
cd server/tools/load
npm install
```

## Success Criteria

### Arena Load Test
- **Connection Success Rate**: ≥80%
- **Average Latency**: <200ms
- **Throughput**: >50 tiles/sec sustained
- **Stability**: No connection drops during test

### Battle Load Test
- **Battle Success Rate**: ≥80%
- **Conflict Generation**: ≥10 conflicts per battle
- **AI Spawn Trigger**: Activates when player count drops
- **Resolution Time**: <100ms average

## Monitoring Integration

Both tools integrate with the server's Prometheus metrics:

- `actions_total{action_type="place_tile"}`: Tile placement counts
- `tile_tick_duration_ms`: Processing latency
- `conflict_resolution_duration_ms`: Conflict handling time
- `broadcast_duration_ms`: Message broadcast latency
- `current_players_connected`: Live connection count

## CI/CD Integration

Load tests can be integrated into deployment pipelines:

```bash
# Full load test suite
npm run full-load-test

# Stress test for production readiness
npm run stress-test

# Exit codes:
# 0 = All tests passed
# 1 = Tests failed (performance/stability issues)
```

## Example Results

```
📊 Arena Load Test Results:
========================
Total Users: 200
Successful Connections: 198 (99.0%)
Total Tiles Placed: 12,543
Total Messages Received: 8,721
Average Latency: 45.23ms
Throughput: 83.62 tiles/sec
Test Duration: 300.0s
Errors: 2

✅ Load test completed successfully
```

```
⚔️ Battle Load Test Results:
===============================
Battle Instances: 10
Total Players: 80
Successful Battles: 10 (100.0%)
Total Conflicts: 234
AI Entities Spawned: 15
Avg Conflict Resolution: 23.45ms
Peak Throughput: 156.78 actions/sec
Errors: 0

✅ Battle load test completed successfully
```

## Troubleshooting

### Common Issues

**High Connection Failures:**
- Check server capacity and connection limits
- Verify server is running and accessible
- Check network stability

**Low Throughput:**
- Review server resource usage (CPU, memory)
- Check database connection pool limits
- Verify Redis performance

**High Latency:**
- Network latency to server
- Server processing delays
- Database query performance

### Debugging

Enable verbose logging:
```bash
DEBUG=* npm run arena-load-test
```

Monitor server metrics during tests:
```bash
curl http://localhost:3001/metrics
```

## Performance Baselines

### Arena Mode (200 users)
- **Target Latency**: <100ms p95
- **Target Throughput**: >50 tiles/sec
- **Target Success Rate**: >95%
- **Target Memory**: <2GB server RAM

### Battle Mode (10x8 battles)
- **Target Resolution**: <50ms p95 conflicts
- **Target AI Response**: <5s spawn time
- **Target Stability**: 0 battle crashes
- **Target Throughput**: >100 actions/sec peak

## Contributing

When adding new load tests:

1. Follow the existing patterns for metrics collection
2. Include proper error handling and cleanup
3. Add CLI options for key parameters
4. Document success criteria and expected results
5. Test with both localhost and remote servers