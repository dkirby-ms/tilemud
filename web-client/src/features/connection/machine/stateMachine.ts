/**
 * Connection state machine implementation
 * Implements FR-019 (WebSocket connection state management)
 */

import {
  ConnectionState,
  ConnectionEvent,
  ConnectionSideEffectType,
  AdmissionOutcome,
  INITIAL_CONNECTION_CONTEXT,
} from './types';
import type {
  ConnectionEventWithPayload,
  ConnectionContext,
  ConnectionConfig,
  ConnectionSideEffect,
  StateTransitionFn,
  ConnectionError,
} from './types';

/**
 * Calculate retry delay with exponential backoff
 */
function calculateRetryDelay(retryCount: number, config: ConnectionConfig): number {
  const delay = config.baseRetryDelayMs * Math.pow(2, retryCount - 1);
  return Math.min(delay, config.maxRetryDelayMs);
}

/**
 * Create a connection error
 */
function createError(
  type: ConnectionError['type'],
  code: string,
  message: string,
  retryable: boolean = true,
  details?: any
): ConnectionError {
  return {
    type,
    code,
    message,
    details,
    timestamp: new Date(),
    retryable,
  };
}

/**
 * State transition function - main state machine logic
 */
export const transitionState: StateTransitionFn = (
  currentState: ConnectionState,
  event: ConnectionEventWithPayload,
  context: ConnectionContext,
  config: ConnectionConfig
) => {
  const sideEffects: ConnectionSideEffect[] = [];
  let nextState = currentState;
  let nextContext = { ...context };

  // Log all state transitions
  sideEffects.push({
    type: ConnectionSideEffectType.LOG_EVENT,
    payload: {
      type: 'state_transition',
      fromState: currentState,
      event: event.type,
      timestamp: new Date(),
    },
  });

  switch (currentState) {
    case ConnectionState.DISCONNECTED:
      switch (event.type) {
        case ConnectionEvent.CONNECT:
          nextState = ConnectionState.CONNECTING;
          nextContext.retryCount = 0;
          nextContext.lastError = null;
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { characterId: context.characterId },
          });
          break;
      }
      break;

    case ConnectionState.CONNECTING:
      switch (event.type) {
        case ConnectionEvent.AUTHENTICATED:
          nextState = ConnectionState.AUTHENTICATING;
          nextContext.sessionToken = event.payload?.sessionToken || null;
          sideEffects.push({
            type: ConnectionSideEffectType.AUTHENTICATE,
            payload: { sessionToken: nextContext.sessionToken },
          });
          break;

        case ConnectionEvent.CONNECTION_LOST:
        case ConnectionEvent.TIMEOUT:
          if (context.retryCount < config.maxRetries) {
            nextState = ConnectionState.RECONNECTING;
            nextContext.retryCount = context.retryCount + 1;
            nextContext.lastError = createError(
              'network',
              event.type === ConnectionEvent.TIMEOUT ? 'CONNECTION_TIMEOUT' : 'CONNECTION_LOST',
              event.type === ConnectionEvent.TIMEOUT ? 'Connection timed out' : 'Connection lost',
              true
            );
            
            const delay = calculateRetryDelay(nextContext.retryCount, config);
            sideEffects.push({
              type: ConnectionSideEffectType.START_RETRY_TIMER,
              payload: { delay },
            });
          } else {
            nextState = ConnectionState.DISCONNECTED;
            nextContext.lastError = createError(
              'network',
              'MAX_RETRIES_EXCEEDED',
              'Maximum connection retries exceeded',
              false
            );
            sideEffects.push({
              type: ConnectionSideEffectType.NOTIFY_USER,
              payload: { type: 'error', message: 'Connection failed after multiple attempts' },
            });
          }
          break;

        case ConnectionEvent.DISCONNECT:
        case ConnectionEvent.CANCEL:
          nextState = ConnectionState.DISCONNECTED;
          sideEffects.push({
            type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
          });
          break;
      }
      break;

    case ConnectionState.AUTHENTICATING:
      switch (event.type) {
        case ConnectionEvent.AUTHENTICATED:
          nextState = ConnectionState.REQUESTING_ADMISSION;
          sideEffects.push({
            type: ConnectionSideEffectType.REQUEST_ADMISSION,
            payload: {
              characterId: context.characterId,
              sessionToken: context.sessionToken,
              reconnectionToken: context.reconnectionToken,
            },
          });
          break;

        case ConnectionEvent.AUTHENTICATION_FAILED:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.lastError = createError(
            'authentication',
            'AUTH_FAILED',
            event.payload?.error?.message || 'Authentication failed',
            false
          );
          sideEffects.push({
            type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: { type: 'error', message: 'Authentication failed. Please log in again.' },
          });
          break;

        case ConnectionEvent.CONNECTION_LOST:
          nextState = ConnectionState.GRACE_PERIOD;
          nextContext.graceExpiresAt = new Date(Date.now() + config.gracePeriodMs);
          sideEffects.push({
            type: ConnectionSideEffectType.START_GRACE_TIMER,
            payload: { duration: config.gracePeriodMs },
          });
          break;
      }
      break;

    case ConnectionState.REQUESTING_ADMISSION:
      switch (event.type) {
        case ConnectionEvent.ADMISSION_GRANTED:
          nextState = ConnectionState.CONNECTED;
          nextContext.connectedAt = new Date();
          nextContext.instanceId = event.payload?.instanceId || null;
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: { type: 'success', message: 'Connected successfully!' },
          });
          break;

        case ConnectionEvent.QUEUED:
          nextState = ConnectionState.QUEUED;
          nextContext.queuePosition = event.payload?.queuePosition?.position || null;
          nextContext.queueDepth = event.payload?.queuePosition?.depth || null;
          nextContext.estimatedWaitTime = event.payload?.queuePosition?.estimatedWaitTime || null;
          
          sideEffects.push({
            type: ConnectionSideEffectType.POLL_QUEUE,
            payload: { interval: config.queuePollIntervalMs },
          });
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: {
              type: 'info',
              message: `Queued for connection. Position: ${nextContext.queuePosition}`,
            },
          });
          break;

        case ConnectionEvent.ADMISSION_DENIED:
          const outcome = event.payload?.outcome as AdmissionOutcome;
          switch (outcome) {
            case AdmissionOutcome.RATE_LIMITED:
              nextState = ConnectionState.RATE_LIMITED;
              nextContext.rateLimitReset = event.payload?.rateLimitInfo?.resetTime || null;
              nextContext.rateLimitRemaining = event.payload?.rateLimitInfo?.remaining || null;
              sideEffects.push({
                type: ConnectionSideEffectType.NOTIFY_USER,
                payload: { type: 'warning', message: 'Rate limited. Please wait before retrying.' },
              });
              break;

            case AdmissionOutcome.DRAIN_MODE:
              nextState = ConnectionState.DRAIN_MODE;
              nextContext.drainModeActive = true;
              nextContext.maintenanceInfo = event.payload?.maintenanceInfo || null;
              sideEffects.push({
                type: ConnectionSideEffectType.NOTIFY_USER,
                payload: { type: 'info', message: 'Server is in maintenance mode.' },
              });
              break;

            case AdmissionOutcome.MAINTENANCE:
              nextState = ConnectionState.MAINTENANCE;
              nextContext.maintenanceInfo = event.payload?.maintenanceInfo || null;
              sideEffects.push({
                type: ConnectionSideEffectType.NOTIFY_USER,
                payload: { type: 'info', message: 'Server is under maintenance.' },
              });
              break;

            default:
              nextState = ConnectionState.REJECTED;
              nextContext.lastError = createError(
                'admission',
                outcome || 'REJECTED',
                event.payload?.error?.message || 'Admission denied',
                false
              );
              sideEffects.push({
                type: ConnectionSideEffectType.NOTIFY_USER,
                payload: { type: 'error', message: 'Connection rejected by server.' },
              });
              break;
          }
          break;

        case ConnectionEvent.CONNECTION_LOST:
          nextState = ConnectionState.GRACE_PERIOD;
          nextContext.graceExpiresAt = new Date(Date.now() + config.gracePeriodMs);
          sideEffects.push({
            type: ConnectionSideEffectType.START_GRACE_TIMER,
            payload: { duration: config.gracePeriodMs },
          });
          break;

        case ConnectionEvent.TIMEOUT:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.lastError = createError(
            'timeout',
            'ADMISSION_TIMEOUT',
            'Admission request timed out',
            true
          );
          sideEffects.push({
            type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
          });
          break;
      }
      break;

    case ConnectionState.QUEUED:
      switch (event.type) {
        case ConnectionEvent.PROMOTED:
        case ConnectionEvent.ADMISSION_GRANTED:
          nextState = ConnectionState.CONNECTED;
          nextContext.connectedAt = new Date();
          nextContext.queuePosition = null;
          nextContext.queueDepth = null;
          nextContext.estimatedWaitTime = null;
          sideEffects.push({
            type: ConnectionSideEffectType.STOP_QUEUE_POLLING,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: { type: 'success', message: 'Connected successfully!' },
          });
          break;

        case ConnectionEvent.QUEUE_POSITION_UPDATE:
          nextContext.queuePosition = event.payload?.queuePosition?.position || context.queuePosition;
          nextContext.queueDepth = event.payload?.queuePosition?.depth || context.queueDepth;
          nextContext.estimatedWaitTime = event.payload?.queuePosition?.estimatedWaitTime || context.estimatedWaitTime;
          break;

        case ConnectionEvent.CONNECTION_LOST:
          nextState = ConnectionState.GRACE_PERIOD;
          nextContext.graceExpiresAt = new Date(Date.now() + config.gracePeriodMs);
          sideEffects.push({
            type: ConnectionSideEffectType.STOP_QUEUE_POLLING,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.START_GRACE_TIMER,
            payload: { duration: config.gracePeriodMs },
          });
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          sideEffects.push({
            type: ConnectionSideEffectType.STOP_QUEUE_POLLING,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
          });
          break;
      }
      break;

    case ConnectionState.CONNECTED:
      switch (event.type) {
        case ConnectionEvent.CONNECTION_LOST:
          nextState = ConnectionState.GRACE_PERIOD;
          nextContext.graceExpiresAt = new Date(Date.now() + config.gracePeriodMs);
          nextContext.lastReconnectAt = new Date();
          sideEffects.push({
            type: ConnectionSideEffectType.START_GRACE_TIMER,
            payload: { duration: config.gracePeriodMs },
          });
          break;

        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTING;
          sideEffects.push({
            type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
          });
          break;

        case ConnectionEvent.DRAIN_MODE:
          nextState = ConnectionState.DRAIN_MODE;
          nextContext.drainModeActive = true;
          nextContext.maintenanceInfo = event.payload?.maintenanceInfo || null;
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: { type: 'warning', message: 'Server entering maintenance mode. You will be disconnected soon.' },
          });
          break;

        case ConnectionEvent.MAINTENANCE:
          nextState = ConnectionState.MAINTENANCE;
          nextContext.maintenanceInfo = event.payload?.maintenanceInfo || null;
          sideEffects.push({
            type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: { type: 'info', message: 'Server maintenance started. Disconnecting...' },
          });
          break;
      }
      break;

    case ConnectionState.GRACE_PERIOD:
      switch (event.type) {
        case ConnectionEvent.RECONNECTION_AVAILABLE:
          nextState = ConnectionState.CONNECTING;
          nextContext.graceExpiresAt = null;
          sideEffects.push({
            type: ConnectionSideEffectType.CLEAR_GRACE_TIMER,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { 
              characterId: context.characterId,
              reconnectionToken: context.reconnectionToken,
            },
          });
          break;

        case ConnectionEvent.GRACE_EXPIRED:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.graceExpiresAt = null;
          nextContext.reconnectionToken = null;
          nextContext.sessionToken = null;
          sideEffects.push({
            type: ConnectionSideEffectType.NOTIFY_USER,
            payload: { type: 'info', message: 'Reconnection window expired. Please connect again.' },
          });
          break;

        case ConnectionEvent.CONNECT:
        case ConnectionEvent.RETRY:
          nextState = ConnectionState.CONNECTING;
          nextContext.graceExpiresAt = null;
          sideEffects.push({
            type: ConnectionSideEffectType.CLEAR_GRACE_TIMER,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { characterId: context.characterId },
          });
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.graceExpiresAt = null;
          nextContext.reconnectionToken = null;
          nextContext.sessionToken = null;
          sideEffects.push({
            type: ConnectionSideEffectType.CLEAR_GRACE_TIMER,
          });
          break;
      }
      break;

    case ConnectionState.RECONNECTING:
      switch (event.type) {
        case ConnectionEvent.RETRY:
          nextState = ConnectionState.CONNECTING;
          sideEffects.push({
            type: ConnectionSideEffectType.CLEAR_RETRY_TIMER,
          });
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { characterId: context.characterId },
          });
          break;

        case ConnectionEvent.TIMEOUT:
          // Retry timer expired, attempt reconnection
          nextState = ConnectionState.CONNECTING;
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { characterId: context.characterId },
          });
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          sideEffects.push({
            type: ConnectionSideEffectType.CLEAR_RETRY_TIMER,
          });
          break;
      }
      break;

    case ConnectionState.DISCONNECTING:
      switch (event.type) {
        case ConnectionEvent.DISCONNECT:
          // Websocket disconnected
          nextState = ConnectionState.DISCONNECTED;
          nextContext.connectedAt = null;
          nextContext.sessionToken = null;
          nextContext.reconnectionToken = null;
          break;
      }
      break;

    case ConnectionState.RATE_LIMITED:
      switch (event.type) {
        case ConnectionEvent.RETRY:
          if (context.rateLimitReset && new Date() > context.rateLimitReset) {
            nextState = ConnectionState.CONNECTING;
            nextContext.rateLimitReset = null;
            nextContext.rateLimitRemaining = null;
            sideEffects.push({
              type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
              payload: { characterId: context.characterId },
            });
          } else {
            sideEffects.push({
              type: ConnectionSideEffectType.NOTIFY_USER,
              payload: { type: 'warning', message: 'Still rate limited. Please wait.' },
            });
          }
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          break;
      }
      break;

    case ConnectionState.DRAIN_MODE:
      switch (event.type) {
        case ConnectionEvent.RETRY:
          nextState = ConnectionState.CONNECTING;
          nextContext.drainModeActive = false;
          nextContext.maintenanceInfo = null;
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { characterId: context.characterId },
          });
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.drainModeActive = false;
          nextContext.maintenanceInfo = null;
          break;
      }
      break;

    case ConnectionState.MAINTENANCE:
      switch (event.type) {
        case ConnectionEvent.RETRY:
          nextState = ConnectionState.CONNECTING;
          nextContext.maintenanceInfo = null;
          sideEffects.push({
            type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
            payload: { characterId: context.characterId },
          });
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.maintenanceInfo = null;
          break;
      }
      break;

    case ConnectionState.REJECTED:
      switch (event.type) {
        case ConnectionEvent.RETRY:
          if (context.lastError?.retryable !== false) {
            nextState = ConnectionState.CONNECTING;
            nextContext.lastError = null;
            sideEffects.push({
              type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
              payload: { characterId: context.characterId },
            });
          } else {
            sideEffects.push({
              type: ConnectionSideEffectType.NOTIFY_USER,
              payload: { type: 'error', message: 'Connection cannot be retried. Please check your credentials.' },
            });
          }
          break;

        case ConnectionEvent.CANCEL:
        case ConnectionEvent.DISCONNECT:
          nextState = ConnectionState.DISCONNECTED;
          nextContext.lastError = null;
          break;
      }
      break;
  }

  return {
    nextState,
    nextContext,
    sideEffects,
  };
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(
  fromState: ConnectionState,
  event: ConnectionEvent
): boolean {
  // Use the state machine to check if transition produces a different state
  const result = transitionState(
    fromState,
    { type: event },
    INITIAL_CONNECTION_CONTEXT,
    {} as ConnectionConfig
  );
  
  return result.nextState !== fromState || (result.sideEffects?.length || 0) > 0;
}

/**
 * Get all valid events for a given state
 */
export function getValidEvents(state: ConnectionState): ConnectionEvent[] {
  const allEvents = Object.values(ConnectionEvent) as ConnectionEvent[];
  return allEvents.filter(event => isValidTransition(state, event));
}

/**
 * Check if state machine is in a connected state
 */
export function isConnected(state: ConnectionState): boolean {
  return state === ConnectionState.CONNECTED;
}

/**
 * Check if state machine is in a connecting state
 */
export function isConnecting(state: ConnectionState): boolean {
  const connectingStates = [
    ConnectionState.CONNECTING,
    ConnectionState.AUTHENTICATING,
    ConnectionState.REQUESTING_ADMISSION,
    ConnectionState.QUEUED,
    ConnectionState.RECONNECTING,
  ] as const;
  
  return connectingStates.includes(state as typeof connectingStates[number]);
}

/**
 * Check if state machine is in an error state
 */
export function isErrorState(state: ConnectionState): boolean {
  const errorStates = [
    ConnectionState.REJECTED,
    ConnectionState.RATE_LIMITED,
    ConnectionState.DRAIN_MODE,
    ConnectionState.MAINTENANCE,
  ] as const;
  
  return errorStates.includes(state as typeof errorStates[number]);
}

/**
 * Check if state machine can retry connection
 */
export function canRetry(state: ConnectionState, context: ConnectionContext): boolean {
  switch (state) {
    case ConnectionState.DISCONNECTED:
    case ConnectionState.RECONNECTING:
    case ConnectionState.GRACE_PERIOD:
    case ConnectionState.DRAIN_MODE:
    case ConnectionState.MAINTENANCE:
      return true;
    
    case ConnectionState.RATE_LIMITED:
      return !context.rateLimitReset || new Date() > context.rateLimitReset;
    
    case ConnectionState.REJECTED:
      return context.lastError?.retryable !== false;
    
    default:
      return false;
  }
}