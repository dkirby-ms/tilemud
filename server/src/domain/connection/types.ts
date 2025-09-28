/**
 * Connection admission and queue management types
 * Shared across server components and tests
 */

// Admission response status
export enum AdmissionStatus {
  ADMITTED = 'admitted',
  REPLACED = 'replaced', 
  QUEUED = 'queued',
  REJECTED = 'rejected',
  RATE_LIMITED = 'rate_limited',
  TIMEOUT = 'timeout',
  ERROR = 'error'
}

// Specific admission outcomes for detailed response handling
export enum AdmissionOutcome {
  ADMITTED = 'admitted',
  REPLACED = 'replaced',
  QUEUED = 'queued',
  ALREADY_IN_SESSION = 'already_in_session',
  INVALID_REPLACE_TOKEN = 'invalid_replace_token',
  SUSPENDED = 'suspended',
  INVALID_INSTANCE = 'invalid_instance',
  DRAIN_MODE = 'drain_mode',
  RATE_LIMITED = 'rate_limited',
  TIMEOUT = 'timeout',
  INVALID_REQUEST = 'invalid_request',
  SERVER_ERROR = 'server_error'
}

// Queue position information
export interface QueuePosition {
  position: number;
  depth: number;
  estimatedWaitSeconds: number;
}

// Session lifecycle states
export enum SessionState {
  PENDING = 'pending',      // Admission logic executing
  ACTIVE = 'active',        // Participant inside instance
  GRACE = 'grace',          // Temporary disconnect; slot reserved
  TERMINATING = 'terminating' // Cleanup underway
}

// Connection attempt outcomes
export enum AttemptOutcome {
  SUCCESS = 'success',      // Successfully admitted
  QUEUED = 'queued',        // Placed in queue
  FAILED = 'failed',        // Rejected with reason
  TIMEOUT = 'timeout'       // Timed out after 10s
}

// Detailed failure reasons for unsuccessful attempts
export enum FailureReason {
  NOT_AUTHENTICATED = 'NOT_AUTHENTICATED',
  NO_ACTIVE_CHARACTER = 'NO_ACTIVE_CHARACTER',
  CHARACTER_NOT_FOUND = 'CHARACTER_NOT_FOUND',
  CHARACTER_NOT_OWNED = 'CHARACTER_NOT_OWNED',
  ALREADY_IN_SESSION = 'ALREADY_IN_SESSION',
  CAPACITY_FULL = 'CAPACITY_FULL',
  QUEUE_FULL = 'QUEUE_FULL',
  VERSION_MISMATCH = 'VERSION_MISMATCH',
  MAINTENANCE = 'MAINTENANCE',
  DRAIN_MODE = 'DRAIN_MODE',
  INVALID_INSTANCE = 'INVALID_INSTANCE',
  CHARACTER_SUSPENDED = 'CHARACTER_SUSPENDED',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

// Disconnect reasons for session termination
export enum DisconnectReason {
  USER = 'user',              // Deliberate user disconnect
  NETWORK = 'network',        // Network interruption
  REPLACE = 'replace',        // Replaced by new session
  GRACE_EXPIRED = 'grace_expired' // Grace period timeout
}

// Character session data structure
export interface CharacterSession {
  sessionId: string;          // UUID generated on admission
  characterId: string;        // Character foreign key
  userId: string;             // User for rate limit/ownership
  instanceId: string;         // Target server instance
  state: SessionState;
  admittedAt: number;         // Epoch ms
  lastHeartbeatAt: number;    // Server-updated for cleanup
  replacementOf?: string;     // Prior session UUID (audit)
  reconnectionToken?: string; // Single-use token for grace
  graceExpiresAt?: number;    // Present only in grace state
}

// Transient connection attempt tracking
export interface ConnectionAttempt {
  attemptId: string;          // UUID for tracing
  characterId: string;        // From client selection
  userId: string;             // Auth context
  instanceId: string;         // Instance target
  startedAt: number;          // Epoch ms for timeout
  outcome: AttemptOutcome;
  failureReason?: FailureReason;
  queuedRank?: number;        // Position at enqueue (0-based)
}

// Queue entry (Redis sorted set logical view)
export interface QueueEntry {
  characterId: string;        // Uniqueness enforced
  userId: string;             // For rate limiting
  instanceId: string;         // Partition key
  enqueuedAt: number;         // Score in sorted set
  attemptId: string;          // Correlation
}

// Rate limiting record
export interface RateLimitRecord {
  userId: string;             // Scope
  windowStart: number;        // Rolling calculation anchor
  failures: number;           // Count in window
  lockedUntil?: number;       // Lockout expiry
}

// Metrics snapshot for observability
export interface MetricsSnapshot {
  activeSessions: number;     // Current active for instance
  queueDepth: number;         // Current queue size
  peakQueueDepth: number;     // Historical max
  avgQueueWait: number;       // Derived from histogram
  p95QueueWait: number;       // Derived (TBD)
}

// Admission response structure
export interface AdmissionResponse {
  outcome: AttemptOutcome;
  reason?: FailureReason;
  position?: number;          // Queue position if queued
  retryAfterSeconds?: number; // For rate limited
  sessionId?: string;         // If successful
  reconnectionToken?: string; // For grace handling
}

// Queue status response
export interface QueueStatusResponse {
  position: number;           // Current position (0-based)
  depth: number;              // Total queue size
  estimatedWaitSeconds?: number; // Optional estimate
}