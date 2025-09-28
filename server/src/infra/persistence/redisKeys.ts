/**
 * Redis key building utilities for connection management
 * Provides consistent key naming and prefixing across the application
 */

// Key prefixes for different data types
const PREFIXES = {
  SESSION: 'session',
  QUEUE: 'queue',
  RATE_LIMIT: 'ratelimit',
  METRICS: 'metrics',
  LOCKS: 'lock'
} as const;

// Environment-specific key prefix
const ENV_PREFIX = process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev';

/**
 * Build a Redis key with environment prefix and consistent formatting
 */
function buildKey(...parts: (string | number)[]): string {
  return [ENV_PREFIX, ...parts].join(':');
}

/**
 * Legacy key builders for backward compatibility with existing services
 */
export const sessionKeys = {
  active: (instanceId: string, sessionId: string) => buildKey(PREFIXES.SESSION, 'active', instanceId, sessionId),
  grace: (instanceId: string, sessionId: string) => buildKey(PREFIXES.SESSION, 'grace', instanceId, sessionId),
  byCharacter: (characterId: string) => buildKey(PREFIXES.SESSION, 'char', characterId),
  reconnectionToken: (token: string) => buildKey(PREFIXES.SESSION, 'reconnect', token),
  heartbeat: (instanceId: string, sessionId: string) => buildKey(PREFIXES.SESSION, 'heartbeat', instanceId, sessionId),
  byInstance: (instanceId: string) => buildKey(PREFIXES.SESSION, 'instance', instanceId),
  byId: (sessionId: string) => buildKey(PREFIXES.SESSION, 'data', sessionId)
};

export const queueKeys = {
  byInstance: (instanceId: string) => buildKey(PREFIXES.QUEUE, 'pending', instanceId),
  entry: (characterId: string) => buildKey(PREFIXES.QUEUE, 'entry', characterId),
  positions: (instanceId: string) => buildKey(PREFIXES.QUEUE, 'position', instanceId)
};

export const rateLimitKeys = {
  byUser: (userId: string) => buildKey(PREFIXES.RATE_LIMIT, userId),
  window: (userId: string, windowStart: number) => buildKey(PREFIXES.RATE_LIMIT, 'window', userId, windowStart),
  lockout: (userId: string) => buildKey(PREFIXES.RATE_LIMIT, 'lock', userId)
};

/**
 * Main Redis key structure (new format)
 */
export const redisKeys = {
  // Session management keys
  session: {
    active: (instanceId: string, sessionId: string) => buildKey(PREFIXES.SESSION, 'active', instanceId, sessionId),
    grace: (instanceId: string, sessionId: string) => buildKey(PREFIXES.SESSION, 'grace', instanceId, sessionId),
    byCharacter: (characterId: string) => buildKey(PREFIXES.SESSION, 'char', characterId),
    reconnectionToken: (token: string) => buildKey(PREFIXES.SESSION, 'reconnect', token),
    heartbeat: (instanceId: string, sessionId: string) => buildKey(PREFIXES.SESSION, 'heartbeat', instanceId, sessionId),
    byInstance: (instanceId: string) => buildKey(PREFIXES.SESSION, 'instance', instanceId),
    byId: (sessionId: string) => buildKey(PREFIXES.SESSION, 'data', sessionId),
    instanceDrain: (instanceId: string) => buildKey(PREFIXES.SESSION, 'drain', instanceId)
  },

  // Queue management keys  
  queue: {
    pending: (instanceId: string) => buildKey(PREFIXES.QUEUE, 'pending', instanceId),
    position: (instanceId: string, characterId: string) => buildKey(PREFIXES.QUEUE, 'pos', instanceId, characterId),
    stats: (instanceId: string) => buildKey(PREFIXES.QUEUE, 'stats', instanceId)
  },

  // Rate limiting keys
  rateLimit: {
    sliding: (characterId: string) => buildKey(PREFIXES.RATE_LIMIT, 'sliding', characterId),
    lockout: (characterId: string) => buildKey(PREFIXES.RATE_LIMIT, 'lockout', characterId),
    stats: (characterId: string) => buildKey(PREFIXES.RATE_LIMIT, 'stats', characterId)
  },

  // Instance management keys
  instance: {
    drain: (instanceId: string) => buildKey('instance', 'drain', instanceId),
    capacity: (instanceId: string) => buildKey('instance', 'capacity', instanceId),
    status: (instanceId: string) => buildKey('instance', 'status', instanceId),
    heartbeat: (instanceId: string) => buildKey('instance', 'heartbeat', instanceId)
  },

  // Metrics and monitoring keys
  metrics: {
    admissions: buildKey(PREFIXES.METRICS, 'admissions'),
    queue: buildKey(PREFIXES.METRICS, 'queue'),
    sessions: buildKey(PREFIXES.METRICS, 'sessions'),
    rateLimit: buildKey(PREFIXES.METRICS, 'rate_limit')
  }
};

/**
 * Time-to-live constants
 */
export const TTL = {
  SESSION_ACTIVE: 86400,    // 24 hours
  SESSION_GRACE: 300,       // 5 minutes
  QUEUE_ENTRY: 3600,        // 1 hour
  RATE_LIMIT_WINDOW: 60,    // 1 minute
  RECONNECTION_TOKEN: 900   // 15 minutes
} as const;

/**
 * Generate correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Utility functions for key pattern matching and cleanup
 */
export const keyPatterns = {
  // All session keys for cleanup
  allSessions: () => buildKey(PREFIXES.SESSION, '*'),
  
  // All queue keys for instance
  instanceQueue: (instanceId: string) => buildKey(PREFIXES.QUEUE, instanceId, '*'),
  
  // All rate limit keys for user
  userRateLimit: (userId: string) => buildKey(PREFIXES.RATE_LIMIT, userId, '*'),
  
  // Expired locks for cleanup
  expiredLocks: () => buildKey(PREFIXES.LOCKS, '*')
};

/**
 * Helper to extract instance ID from compound keys
 */
export function extractInstanceId(key: string): string | null {
  const parts = key.split(':');
  const instanceIndex = parts.findIndex(part => part === 'instance');
  if (instanceIndex !== -1 && instanceIndex + 1 < parts.length) {
    return parts[instanceIndex + 1] || null;
  }
  return null;
}