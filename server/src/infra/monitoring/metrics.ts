import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Centralized metrics registry for the game server
 * Implements FR-013: Real-time monitoring and alerting
 */

// Enable default Node.js metrics collection
collectDefaultMetrics({ register });

// Game-specific counters
export const actionsTotal = new Counter({
  name: 'actions_total',
  help: 'Total number of player actions processed',
  labelNames: ['action_type', 'arena_id', 'outcome'] as const,
});

export const chatMessagesTotal = new Counter({
  name: 'chat_messages_total', 
  help: 'Total number of chat messages processed',
  labelNames: ['channel_type', 'delivery_tier'] as const,
});

export const playersConnectedTotal = new Counter({
  name: 'players_connected_total',
  help: 'Total number of player connections established',
  labelNames: ['arena_tier'] as const,
});

export const playersDisconnectedTotal = new Counter({
  name: 'players_disconnected_total',
  help: 'Total number of player disconnections',
  labelNames: ['reason', 'arena_tier'] as const,
});

export const rateLimitHitsTotal = new Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit violations',
  labelNames: ['limit_type', 'player_id'] as const,
});

export const replayEventsTotal = new Counter({
  name: 'replay_events_total',
  help: 'Total number of replay events recorded',
  labelNames: ['event_type', 'arena_id'] as const,
});

export const aiActionsTotal = new Counter({
  name: 'ai_actions_total',
  help: 'Total number of AI entity actions',
  labelNames: ['ai_type', 'arena_id', 'outcome'] as const,
});

// Performance histograms  
export const tileTickDuration = new Histogram({
  name: 'tile_tick_duration_ms',
  help: 'Duration of tile placement tick processing in milliseconds',
  labelNames: ['arena_id', 'player_count_bucket'] as const,
  buckets: [10, 25, 50, 100, 200, 500, 1000, 2000], // ms buckets for 100ms target
});

export const wsLatency = new Histogram({
  name: 'ws_latency_ms', 
  help: 'WebSocket message latency from server to client acknowledgment',
  labelNames: ['message_type', 'arena_tier'] as const,
  buckets: [10, 25, 50, 100, 200, 500, 1000], // p95 target <200ms
});

export const arenaJoinDuration = new Histogram({
  name: 'arena_join_duration_ms',
  help: 'Time from join request to arena ready state',
  labelNames: ['arena_tier', 'queue_position'] as const,
  buckets: [100, 250, 500, 1000, 2000, 5000], // <1s target
});

export const conflictResolutionDuration = new Histogram({
  name: 'conflict_resolution_duration_ms',
  help: 'Duration of tile placement conflict resolution',
  labelNames: ['arena_id', 'conflict_count'] as const,
  buckets: [5, 10, 25, 50, 100, 200, 500], // ≤100ms target
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_ms',
  help: 'Database query execution time',
  labelNames: ['operation', 'table'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
});

export const redisOperationDuration = new Histogram({
  name: 'redis_operation_duration_ms',
  help: 'Redis operation execution time',
  labelNames: ['operation', 'key_type'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250],
});

// Current state gauges
export const currentPlayersConnected = new Gauge({
  name: 'current_players_connected',
  help: 'Current number of connected players',
  labelNames: ['arena_id', 'arena_tier'] as const,
});

export const currentAiEntities = new Gauge({
  name: 'current_ai_entities',
  help: 'Current number of active AI entities',
  labelNames: ['arena_id', 'ai_type'] as const,
});

export const arenaCapacityUtilization = new Gauge({
  name: 'arena_capacity_utilization',
  help: 'Arena capacity utilization percentage',
  labelNames: ['arena_id', 'arena_tier'] as const,
});

export const systemResourceUsage = new Gauge({
  name: 'system_resource_usage',
  help: 'System resource usage percentage',
  labelNames: ['resource_type'] as const, // cpu, memory, disk
});

// Quorum and soft-fail monitoring
export const playersQuorumStatus = new Gauge({
  name: 'players_quorum_status',
  help: 'Player quorum status by arena',
  labelNames: ['arena_id', 'status'] as const, // responsive, unresponsive
});

export const arenasQuorumPercent = new Gauge({
  name: 'arenas_quorum_percent',
  help: 'Arena quorum percentage',
  labelNames: ['arena_id'] as const,
});

export const softFailDecisions = new Counter({
  name: 'soft_fail_decisions_total',
  help: 'Total number of soft-fail decisions made',
  labelNames: ['arena_id', 'decision'] as const, // continue, pause, abort, migrate
});

export const replayRetentionSize = new Gauge({
  name: 'replay_retention_size_bytes',
  help: 'Total size of replay data within retention period',
});

export const chatRetentionSize = new Gauge({
  name: 'chat_retention_size_bytes',
  help: 'Total size of chat data within retention period',
  labelNames: ['channel_type'] as const,
});

// Rate limiting metrics
export const rateLimitRemainingQuota = new Gauge({
  name: 'rate_limit_remaining_quota',
  help: 'Remaining quota for rate limited operations',
  labelNames: ['limit_type', 'player_id'] as const,
});

// Helper functions for common metric operations
export function recordPlayerAction(actionType: string, arenaId: string, outcome: 'success' | 'failure' | 'rate_limited'): void {
  actionsTotal.inc({ action_type: actionType, arena_id: arenaId, outcome });
}

export function recordChatMessage(channelType: string, deliveryTier: 'exactly_once' | 'at_least_once'): void {
  chatMessagesTotal.inc({ channel_type: channelType, delivery_tier: deliveryTier });
}

export function recordTileTickDuration(durationMs: number, arenaId: string, playerCount: number): void {
  const bucket = playerCount <= 10 ? 'small' : playerCount <= 50 ? 'medium' : 'large';
  tileTickDuration.observe({ arena_id: arenaId, player_count_bucket: bucket }, durationMs);
}

export function recordWsLatency(latencyMs: number, messageType: string, arenaTier: string): void {
  wsLatency.observe({ message_type: messageType, arena_tier: arenaTier }, latencyMs);
}

export function recordArenaJoin(durationMs: number, arenaTier: string, queuePosition: number): void {
  const positionBucket = queuePosition === 0 ? 'immediate' : queuePosition <= 5 ? 'short' : 'long';
  arenaJoinDuration.observe({ arena_tier: arenaTier, queue_position: positionBucket }, durationMs);
}

export function recordConflictResolution(durationMs: number, arenaId: string, conflictCount: number): void {
  const conflictBucket = conflictCount <= 1 ? 'single' : conflictCount <= 5 ? 'few' : 'many';
  conflictResolutionDuration.observe({ arena_id: arenaId, conflict_count: conflictBucket }, durationMs);
}

export function recordDbQuery(durationMs: number, operation: string, table: string): void {
  dbQueryDuration.observe({ operation, table }, durationMs);
}

export function recordRedisOperation(durationMs: number, operation: string, keyType: string): void {
  redisOperationDuration.observe({ operation, key_type: keyType }, durationMs);
}

export function updatePlayerCount(arenaId: string, arenaTier: string, count: number): void {
  currentPlayersConnected.set({ arena_id: arenaId, arena_tier: arenaTier }, count);
}

export function updateAiEntityCount(arenaId: string, aiType: string, count: number): void {
  currentAiEntities.set({ arena_id: arenaId, ai_type: aiType }, count);
}

export function updateArenaCapacityUtilization(arenaId: string, arenaTier: string, utilizationPercent: number): void {
  arenaCapacityUtilization.set({ arena_id: arenaId, arena_tier: arenaTier }, utilizationPercent);
}

export function updateSystemResourceUsage(resourceType: 'cpu' | 'memory' | 'disk', usagePercent: number): void {
  systemResourceUsage.set({ resource_type: resourceType }, usagePercent);
}

export function recordRateLimitHit(limitType: 'chat' | 'action', playerId: string): void {
  rateLimitHitsTotal.inc({ limit_type: limitType, player_id: playerId });
}

export function updateRateLimitQuota(limitType: 'chat' | 'action', playerId: string, remainingQuota: number): void {
  rateLimitRemainingQuota.set({ limit_type: limitType, player_id: playerId }, remainingQuota);
}

// Soft-fail monitoring helpers
export function updatePlayerQuorumStatus(arenaId: string, responsiveCount: number, unresponsiveCount: number): void {
  playersQuorumStatus.set({ arena_id: arenaId, status: 'responsive' }, responsiveCount);
  playersQuorumStatus.set({ arena_id: arenaId, status: 'unresponsive' }, unresponsiveCount);
}

export function updateArenaQuorumPercent(arenaId: string, quorumPercent: number): void {
  arenasQuorumPercent.set({ arena_id: arenaId }, quorumPercent);
}

export function recordSoftFailDecision(arenaId: string, decision: 'continue' | 'pause' | 'abort' | 'migrate'): void {
  softFailDecisions.inc({ arena_id: arenaId, decision });
}

// Export the registry for /metrics endpoint
export const metricsRegistry = register;

// Health check helper
export function getMetricsText(): Promise<string> {
  return register.metrics();
}