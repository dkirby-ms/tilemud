/**
 * Prometheus metrics for connection admission system
 * Tracks admission rates, queue depths, session lifecycle
 */

import { register, Counter, Histogram, Gauge } from 'prom-client';

// Admission flow metrics
export const admissionRequests = new Counter({
  name: 'tilemud_admission_requests_total',
  help: 'Total number of admission requests',
  labelNames: ['instance_id', 'status', 'reason'] as const
});

export const admissionDuration = new Histogram({
  name: 'tilemud_admission_duration_seconds',
  help: 'Duration of admission request processing',
  labelNames: ['instance_id', 'status'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

// Queue metrics
export const queueSize = new Gauge({
  name: 'tilemud_queue_size',
  help: 'Current number of connections in queue',
  labelNames: ['instance_id'] as const
});

export const queueWaitTime = new Histogram({
  name: 'tilemud_queue_wait_seconds',
  help: 'Time connections spend waiting in queue',
  labelNames: ['instance_id'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600]
});

export const queueOperations = new Counter({
  name: 'tilemud_queue_operations_total',
  help: 'Total queue operations performed',
  labelNames: ['instance_id', 'operation', 'result'] as const
});

// Session metrics
export const activeSessions = new Gauge({
  name: 'tilemud_active_sessions',
  help: 'Current number of active sessions',
  labelNames: ['instance_id'] as const
});

export const sessionOperations = new Counter({
  name: 'tilemud_session_operations_total',
  help: 'Total session operations performed',
  labelNames: ['instance_id', 'operation', 'result'] as const
});

export const sessionDuration = new Histogram({
  name: 'tilemud_session_duration_seconds',
  help: 'Duration of sessions from creation to termination',
  labelNames: ['instance_id', 'termination_reason'] as const,
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400, 28800, 86400]
});

// Rate limiting metrics
export const rateLimitHits = new Counter({
  name: 'tilemud_rate_limit_hits_total',
  help: 'Total number of rate limit violations',
  labelNames: ['instance_id', 'limit_type', 'client_id'] as const
});

export const rateLimitChecks = new Counter({
  name: 'tilemud_rate_limit_checks_total',
  help: 'Total number of rate limit checks performed',
  labelNames: ['instance_id', 'limit_type', 'result'] as const
});

// WebSocket metrics
export const websocketConnections = new Counter({
  name: 'tilemud_websocket_connections_total',
  help: 'Total WebSocket connection attempts',
  labelNames: ['instance_id', 'status', 'reconnected'] as const
});

export const websocketMessages = new Counter({
  name: 'tilemud_websocket_messages_total',
  help: 'Total WebSocket messages processed',
  labelNames: ['instance_id', 'direction', 'message_type'] as const
});

export const activeWebsockets = new Gauge({
  name: 'tilemud_active_websockets',
  help: 'Current number of active WebSocket connections',
  labelNames: ['instance_id'] as const
});

// Capacity metrics
export const instanceCapacity = new Gauge({
  name: 'tilemud_instance_capacity',
  help: 'Maximum capacity for instance',
  labelNames: ['instance_id'] as const
});

export const instanceUtilization = new Gauge({
  name: 'tilemud_instance_utilization_percent',
  help: 'Current capacity utilization percentage',
  labelNames: ['instance_id'] as const
});

// Error metrics
export const admissionErrors = new Counter({
  name: 'tilemud_admission_errors_total',
  help: 'Total number of admission system errors',
  labelNames: ['instance_id', 'error_type', 'component'] as const
});

export const reconnectionAttempts = new Counter({
  name: 'tilemud_reconnection_attempts_total',
  help: 'Total number of reconnection attempts',
  labelNames: ['instance_id', 'result', 'attempt_number'] as const
});

// Grace period metrics
export const gracePeriodOperations = new Counter({
  name: 'tilemud_grace_period_operations_total',
  help: 'Grace period lifecycle operations',
  labelNames: ['instance_id', 'operation', 'result'] as const
});

// Background job metrics
export const janitorRuns = new Counter({
  name: 'tilemud_janitor_runs_total',
  help: 'Total number of janitor cleanup runs',
  labelNames: ['result'] as const
});

export const janitorCleanupItems = new Counter({
  name: 'tilemud_janitor_cleanup_items_total',
  help: 'Total items cleaned up by janitor',
  labelNames: ['item_type'] as const
});

export const janitorDuration = new Histogram({
  name: 'tilemud_janitor_duration_seconds',
  help: 'Duration of janitor cleanup runs',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
});

/**
 * Utility functions for common metric operations
 */

export class AdmissionMetrics {
  /**
   * Record admission request with timing
   */
  static recordAdmissionRequest(
    instanceId: string,
    status: 'admitted' | 'queued' | 'rejected',
    reason: string,
    durationMs: number
  ): void {
    admissionRequests.labels(instanceId, status, reason).inc();
    admissionDuration.labels(instanceId, status).observe(durationMs / 1000);
  }

  /**
   * Update queue size for instance
   */
  static setQueueSize(instanceId: string, size: number): void {
    queueSize.labels(instanceId).set(size);
  }

  /**
   * Record queue wait time
   */
  static recordQueueWait(instanceId: string, waitTimeMs: number): void {
    queueWaitTime.labels(instanceId).observe(waitTimeMs / 1000);
  }

  /**
   * Record queue operation
   */
  static recordQueueOperation(
    instanceId: string,
    operation: 'enqueue' | 'dequeue' | 'promote' | 'remove',
    result: 'success' | 'failure'
  ): void {
    queueOperations.labels(instanceId, operation, result).inc();
  }

  /**
   * Update active session count
   */
  static setActiveSessions(instanceId: string, count: number): void {
    activeSessions.labels(instanceId).set(count);
  }

  /**
   * Record session operation
   */
  static recordSessionOperation(
    instanceId: string,
    operation: 'create' | 'admit' | 'replace' | 'terminate' | 'reconnect',
    result: 'success' | 'failure'
  ): void {
    sessionOperations.labels(instanceId, operation, result).inc();
  }

  /**
   * Record session duration when terminated
   */
  static recordSessionDuration(
    instanceId: string,
    durationMs: number,
    reason: 'normal' | 'timeout' | 'error' | 'replacement'
  ): void {
    sessionDuration.labels(instanceId, reason).observe(durationMs / 1000);
  }

  /**
   * Record rate limit hit
   */
  static recordRateLimitHit(
    instanceId: string,
    limitType: 'sliding_window' | 'lockout',
    clientId: string
  ): void {
    rateLimitHits.labels(instanceId, limitType, clientId).inc();
  }

  /**
   * Record rate limit check
   */
  static recordRateLimitCheck(
    instanceId: string,
    limitType: 'sliding_window' | 'lockout',
    result: 'allowed' | 'denied'
  ): void {
    rateLimitChecks.labels(instanceId, limitType, result).inc();
  }

  /**
   * Record WebSocket connection
   */
  static recordWebSocketConnection(
    instanceId: string,
    status: 'established' | 'rejected' | 'disconnected',
    reconnected: boolean = false
  ): void {
    websocketConnections.labels(instanceId, status, reconnected.toString()).inc();
  }

  /**
   * Record WebSocket message
   */
  static recordWebSocketMessage(
    instanceId: string,
    direction: 'inbound' | 'outbound',
    messageType: string
  ): void {
    websocketMessages.labels(instanceId, direction, messageType).inc();
  }

  /**
   * Update active WebSocket count
   */
  static setActiveWebSockets(instanceId: string, count: number): void {
    activeWebsockets.labels(instanceId).set(count);
  }

  /**
   * Update instance capacity and utilization
   */
  static setInstanceMetrics(instanceId: string, capacity: number, currentSessions: number): void {
    instanceCapacity.labels(instanceId).set(capacity);
    const utilizationPercent = capacity > 0 ? (currentSessions / capacity) * 100 : 0;
    instanceUtilization.labels(instanceId).set(utilizationPercent);
  }

  /**
   * Record admission system error
   */
  static recordError(
    instanceId: string,
    errorType: 'timeout' | 'redis_error' | 'validation_error' | 'internal_error',
    component: 'admission' | 'queue' | 'session' | 'websocket' | 'rate_limit'
  ): void {
    admissionErrors.labels(instanceId, errorType, component).inc();
  }

  /**
   * Record reconnection attempt
   */
  static recordReconnectionAttempt(
    instanceId: string,
    result: 'success' | 'failure',
    attemptNumber: number
  ): void {
    reconnectionAttempts.labels(instanceId, result, attemptNumber.toString()).inc();
  }

  /**
   * Record grace period operation
   */
  static recordGracePeriodOperation(
    instanceId: string,
    operation: 'start' | 'extend' | 'complete' | 'timeout',
    result: 'success' | 'failure'
  ): void {
    gracePeriodOperations.labels(instanceId, operation, result).inc();
  }

  /**
   * Record janitor cleanup run
   */
  static recordJanitorRun(result: 'success' | 'failure', durationMs: number): void {
    janitorRuns.labels(result).inc();
    janitorDuration.observe(durationMs / 1000);
  }

  /**
   * Record janitor cleanup items
   */
  static recordJanitorCleanup(
    itemType: 'expired_sessions' | 'orphaned_queue_entries' | 'stale_rate_limits',
    count: number
  ): void {
    janitorCleanupItems.labels(itemType).inc(count);
  }
}

/**
 * Initialize default metrics with zero values for consistent baseline
 */
export function initializeMetrics(instanceId: string): void {
  // Initialize all gauges with zero values
  queueSize.labels(instanceId).set(0);
  activeSessions.labels(instanceId).set(0);
  activeWebsockets.labels(instanceId).set(0);
  instanceCapacity.labels(instanceId).set(0);
  instanceUtilization.labels(instanceId).set(0);

  // Initialize counters don't need explicit initialization as they start at 0
}

/**
 * Clear metrics for a specific instance (useful for cleanup)
 * Note: Prometheus metrics are global, so this clears all instance metrics
 */
export function clearInstanceMetrics(_instanceId?: string): void {
  // Remove instance-specific metrics
  register.removeSingleMetric('tilemud_queue_size');
  register.removeSingleMetric('tilemud_active_sessions');
  register.removeSingleMetric('tilemud_active_websockets');
  register.removeSingleMetric('tilemud_instance_capacity');
  register.removeSingleMetric('tilemud_instance_utilization_percent');
}

/**
 * Get current metric values for debugging/monitoring
 */
export async function getMetricSnapshot(): Promise<string> {
  return register.metrics();
}