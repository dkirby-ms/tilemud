/**
 * Connection state machine types for frontend
 * Implements FR-019 (WebSocket connection state management)
 */

/**
 * Connection states for the finite state machine
 */
export const ConnectionState = {
  // Initial states
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  
  // Authentication states
  AUTHENTICATING: 'authenticating',
  
  // Admission states
  REQUESTING_ADMISSION: 'requesting_admission',
  QUEUED: 'queued',
  ADMITTED: 'admitted',
  
  // Connected states
  CONNECTED: 'connected',
  
  // Error states
  REJECTED: 'rejected',
  RATE_LIMITED: 'rate_limited',
  DRAIN_MODE: 'drain_mode',
  MAINTENANCE: 'maintenance',
  
  // Disconnection states
  DISCONNECTING: 'disconnecting',
  
  // Reconnection states
  RECONNECTING: 'reconnecting',
  GRACE_PERIOD: 'grace_period',
} as const;

export type ConnectionState = typeof ConnectionState[keyof typeof ConnectionState];

/**
 * Connection events that trigger state transitions
 */
export const ConnectionEvent = {
  // User actions
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  RETRY: 'retry',
  CANCEL: 'cancel',
  
  // System events
  AUTHENTICATED: 'authenticated',
  ADMISSION_GRANTED: 'admission_granted',
  ADMISSION_DENIED: 'admission_denied',
  QUEUED: 'queued',
  PROMOTED: 'promoted',
  
  // Error events
  AUTHENTICATION_FAILED: 'authentication_failed',
  CONNECTION_LOST: 'connection_lost',
  RATE_LIMITED: 'rate_limited',
  DRAIN_MODE: 'drain_mode',
  MAINTENANCE: 'maintenance',
  
  // Timeout events
  TIMEOUT: 'timeout',
  GRACE_EXPIRED: 'grace_expired',
  
  // Queue events
  QUEUE_POSITION_UPDATE: 'queue_position_update',
  
  // Reconnection events
  RECONNECTION_AVAILABLE: 'reconnection_available',
  RECONNECTION_EXPIRED: 'reconnection_expired',
} as const;

export type ConnectionEvent = typeof ConnectionEvent[keyof typeof ConnectionEvent];

/**
 * Admission outcomes from server responses
 */
export const AdmissionOutcome = {
  ADMITTED: 'ADMITTED',
  QUEUED: 'QUEUED', 
  REJECTED: 'REJECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  DRAIN_MODE: 'DRAIN_MODE',
  MAINTENANCE: 'MAINTENANCE',
  SERVER_ERROR: 'SERVER_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const;

export type AdmissionOutcome = typeof AdmissionOutcome[keyof typeof AdmissionOutcome];

/**
 * Connection context data maintained throughout the session
 */
export interface ConnectionContext {
  // Character and session info
  characterId: string | null;
  sessionToken: string | null;
  reconnectionToken: string | null;
  instanceId: string | null;
  
  // Queue information
  queuePosition: number | null;
  queueDepth: number | null;
  estimatedWaitTime: number | null;
  
  // Error information
  lastError: ConnectionError | null;
  retryCount: number;
  
  // Timing information
  connectedAt: Date | null;
  lastReconnectAt: Date | null;
  graceExpiresAt: Date | null;
  
  // Rate limiting
  rateLimitReset: Date | null;
  rateLimitRemaining: number | null;
  
  // Drain mode info
  drainModeActive: boolean;
  maintenanceInfo: MaintenanceInfo | null;
}

/**
 * Error information for connection failures
 */
export interface ConnectionError {
  type: 'network' | 'authentication' | 'admission' | 'server' | 'timeout';
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  retryable: boolean;
}

/**
 * Maintenance/drain mode information
 */
export interface MaintenanceInfo {
  type: 'drain' | 'maintenance';
  drainMode: boolean;
  estimatedDuration?: number;
  estimatedCompletion?: Date;
  reason?: string;
}

/**
 * Queue position information
 */
export interface QueuePosition {
  position: number;
  depth: number;
  estimatedWaitTime?: number;
  lastUpdated: Date;
}

/**
 * State machine event with payload
 */
export interface ConnectionEventWithPayload {
  type: ConnectionEvent;
  payload?: {
    error?: ConnectionError;
    sessionToken?: string;
    reconnectionToken?: string;
    queuePosition?: QueuePosition;
    maintenanceInfo?: MaintenanceInfo;
    rateLimitInfo?: {
      remaining: number;
      resetTime: Date;
    };
    [key: string]: any;
  };
}

/**
 * State machine configuration
 */
export interface ConnectionConfig {
  // Connection timeouts
  connectionTimeoutMs: number;
  admissionTimeoutMs: number;
  
  // Retry configuration
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  
  // Queue polling
  queuePollIntervalMs: number;
  
  // Grace period
  gracePeriodMs: number;
  
  // Reconnection
  reconnectionWindowMs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  connectionTimeoutMs: 10000,      // 10 seconds
  admissionTimeoutMs: 10000,       // 10 seconds (matches server timeout)
  maxRetries: 3,
  baseRetryDelayMs: 1000,          // 1 second
  maxRetryDelayMs: 30000,          // 30 seconds
  queuePollIntervalMs: 5000,       // 5 seconds (as specified in tasks)
  gracePeriodMs: 60000,            // 60 seconds (matches server)
  reconnectionWindowMs: 60000,     // 60 seconds
};

/**
 * State transition function signature
 */
export type StateTransitionFn = (
  currentState: ConnectionState,
  event: ConnectionEventWithPayload,
  context: ConnectionContext,
  config: ConnectionConfig
) => {
  nextState: ConnectionState;
  nextContext: ConnectionContext;
  sideEffects?: ConnectionSideEffect[];
};

/**
 * Side effects that can be triggered by state transitions
 */
export const ConnectionSideEffectType = {
  CONNECT_WEBSOCKET: 'connect_websocket',
  DISCONNECT_WEBSOCKET: 'disconnect_websocket',
  AUTHENTICATE: 'authenticate',
  REQUEST_ADMISSION: 'request_admission',
  POLL_QUEUE: 'poll_queue',
  STOP_QUEUE_POLLING: 'stop_queue_polling',
  START_RETRY_TIMER: 'start_retry_timer',
  CLEAR_RETRY_TIMER: 'clear_retry_timer',
  START_GRACE_TIMER: 'start_grace_timer',
  CLEAR_GRACE_TIMER: 'clear_grace_timer',
  NOTIFY_USER: 'notify_user',
  LOG_EVENT: 'log_event',
} as const;

export type ConnectionSideEffectType = typeof ConnectionSideEffectType[keyof typeof ConnectionSideEffectType];

/**
 * Side effect definition
 */
export interface ConnectionSideEffect {
  type: ConnectionSideEffectType;
  payload?: any;
}

/**
 * Initial state and context
 */
export const INITIAL_CONNECTION_STATE: ConnectionState = ConnectionState.DISCONNECTED;

export const INITIAL_CONNECTION_CONTEXT: ConnectionContext = {
  characterId: null,
  sessionToken: null,
  reconnectionToken: null,
  instanceId: null,
  queuePosition: null,
  queueDepth: null,
  estimatedWaitTime: null,
  lastError: null,
  retryCount: 0,
  connectedAt: null,
  lastReconnectAt: null,
  graceExpiresAt: null,
  rateLimitReset: null,
  rateLimitRemaining: null,
  drainModeActive: false,
  maintenanceInfo: null,
};