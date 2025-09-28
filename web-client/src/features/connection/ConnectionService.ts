/**
 * WebSocket connection service
 * Implements FR-019 (WebSocket connection state management) and FR-020 (WebSocket reconnection)
 */

import {
  ConnectionState,
  ConnectionEvent,
  ConnectionSideEffectType,
  DEFAULT_CONNECTION_CONFIG,
  INITIAL_CONNECTION_STATE,
  INITIAL_CONNECTION_CONTEXT,
} from './machine/types';
import type {
  ConnectionConfig,
  ConnectionContext,
  ConnectionSideEffect,
  ConnectionEventWithPayload,
  ConnectionError,
  QueuePosition,
  MaintenanceInfo,
} from './machine/types';
import { transitionState, isConnected, isConnecting, canRetry } from './machine/stateMachine';

/**
 * Connection service event handler interface
 */
export interface ConnectionServiceEvents {
  stateChange: (state: ConnectionState, context: ConnectionContext) => void;
  error: (error: ConnectionError) => void;
  queueUpdate: (position: QueuePosition) => void;
  notification: (type: 'info' | 'warning' | 'error' | 'success', message: string) => void;
  connected: () => void;
  disconnected: () => void;
  maintenanceMode: (info: MaintenanceInfo) => void;
}

/**
 * WebSocket connection service
 * Manages WebSocket connection lifecycle with state machine
 */
export class ConnectionService {
  private state: ConnectionState = INITIAL_CONNECTION_STATE;
  private context: ConnectionContext = { ...INITIAL_CONNECTION_CONTEXT };
  private config: ConnectionConfig = { ...DEFAULT_CONNECTION_CONFIG };
  private ws: WebSocket | null = null;
  private eventHandlers: Partial<ConnectionServiceEvents> = {};
  private timers: Map<string, number> = new Map();
  private queuePollInterval: number | null = null;

  constructor(config?: Partial<ConnectionConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get current connection context
   */
  getContext(): ConnectionContext {
    return { ...this.context };
  }

  /**
   * Get connection configuration
   */
  getConfig(): ConnectionConfig {
    return { ...this.config };
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return isConnected(this.state);
  }

  /**
   * Check if currently connecting
   */
  isConnecting(): boolean {
    return isConnecting(this.state);
  }

  /**
   * Check if can retry connection
   */
  canRetry(): boolean {
    return canRetry(this.state, this.context);
  }

  /**
   * Register event handler
   */
  on<K extends keyof ConnectionServiceEvents>(
    event: K,
    handler: ConnectionServiceEvents[K]
  ): void {
    this.eventHandlers[event] = handler;
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof ConnectionServiceEvents>(event: K): void {
    delete this.eventHandlers[event];
  }

  /**
   * Connect to the server
   */
  connect(characterId: string): void {
    this.context.characterId = characterId;
    this.dispatchEvent({ type: ConnectionEvent.CONNECT });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.dispatchEvent({ type: ConnectionEvent.DISCONNECT });
  }

  /**
   * Retry connection
   */
  retry(): void {
    this.dispatchEvent({ type: ConnectionEvent.RETRY });
  }

  /**
   * Cancel current connection attempt
   */
  cancel(): void {
    this.dispatchEvent({ type: ConnectionEvent.CANCEL });
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'auth_success':
          this.dispatchEvent({
            type: ConnectionEvent.AUTHENTICATED,
            payload: { sessionToken: message.sessionToken },
          });
          break;

        case 'auth_failure':
          this.dispatchEvent({
            type: ConnectionEvent.AUTHENTICATION_FAILED,
            payload: { error: message.error },
          });
          break;

        case 'admission_response':
          switch (message.outcome) {
            case 'ADMITTED':
              this.dispatchEvent({
                type: ConnectionEvent.ADMISSION_GRANTED,
                payload: { instanceId: message.instanceId },
              });
              break;

            case 'QUEUED':
              this.dispatchEvent({
                type: ConnectionEvent.QUEUED,
                payload: {
                  queuePosition: {
                    position: message.position,
                    depth: message.depth,
                    estimatedWaitTime: message.estimatedWaitTime,
                    lastUpdated: new Date(),
                  },
                },
              });
              break;

            default:
              this.dispatchEvent({
                type: ConnectionEvent.ADMISSION_DENIED,
                payload: {
                  outcome: message.outcome,
                  error: message.error,
                  maintenanceInfo: message.maintenanceInfo,
                  rateLimitInfo: message.rateLimitInfo,
                },
              });
              break;
          }
          break;

        case 'queue_update':
          this.dispatchEvent({
            type: ConnectionEvent.QUEUE_POSITION_UPDATE,
            payload: {
              queuePosition: {
                position: message.position,
                depth: message.depth,
                estimatedWaitTime: message.estimatedWaitTime,
                lastUpdated: new Date(),
              },
            },
          });
          break;

        case 'queue_promoted':
          this.dispatchEvent({
            type: ConnectionEvent.PROMOTED,
          });
          break;

        case 'drain_mode':
          this.dispatchEvent({
            type: ConnectionEvent.DRAIN_MODE,
            payload: { maintenanceInfo: message.maintenanceInfo },
          });
          break;

        case 'maintenance':
          this.dispatchEvent({
            type: ConnectionEvent.MAINTENANCE,
            payload: { maintenanceInfo: message.maintenanceInfo },
          });
          break;
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }

  /**
   * Dispatch an event to the state machine
   */
  private dispatchEvent(event: ConnectionEventWithPayload): void {
    const { nextState, nextContext, sideEffects } = transitionState(
      this.state,
      event,
      this.context,
      this.config
    );

    // Update state and context
    const previousState = this.state;
    this.state = nextState;
    this.context = nextContext;

    // Execute side effects
    sideEffects?.forEach(sideEffect => this.executeSideEffect(sideEffect));

    // Notify state change
    if (previousState !== nextState) {
      this.eventHandlers.stateChange?.(nextState, nextContext);
      
      // Special state notifications
      if (nextState === ConnectionState.CONNECTED && previousState !== ConnectionState.CONNECTED) {
        this.eventHandlers.connected?.();
      }
      
      if (nextState === ConnectionState.DISCONNECTED && previousState === ConnectionState.CONNECTED) {
        this.eventHandlers.disconnected?.();
      }
    }
  }

  /**
   * Execute a side effect
   */
  private executeSideEffect(sideEffect: ConnectionSideEffect): void {
    switch (sideEffect.type) {
      case ConnectionSideEffectType.CONNECT_WEBSOCKET:
        this.connectWebSocket(sideEffect.payload);
        break;

      case ConnectionSideEffectType.DISCONNECT_WEBSOCKET:
        this.disconnectWebSocket();
        break;

      case ConnectionSideEffectType.AUTHENTICATE:
        this.authenticate(sideEffect.payload);
        break;

      case ConnectionSideEffectType.REQUEST_ADMISSION:
        this.requestAdmission(sideEffect.payload);
        break;

      case ConnectionSideEffectType.POLL_QUEUE:
        this.startQueuePolling(sideEffect.payload.interval);
        break;

      case ConnectionSideEffectType.STOP_QUEUE_POLLING:
        this.stopQueuePolling();
        break;

      case ConnectionSideEffectType.START_RETRY_TIMER:
        this.startRetryTimer(sideEffect.payload.delay);
        break;

      case ConnectionSideEffectType.CLEAR_RETRY_TIMER:
        this.clearRetryTimer();
        break;

      case ConnectionSideEffectType.START_GRACE_TIMER:
        this.startGraceTimer(sideEffect.payload.duration);
        break;

      case ConnectionSideEffectType.CLEAR_GRACE_TIMER:
        this.clearGraceTimer();
        break;

      case ConnectionSideEffectType.NOTIFY_USER:
        this.eventHandlers.notification?.(
          sideEffect.payload.type,
          sideEffect.payload.message
        );
        break;

      case ConnectionSideEffectType.LOG_EVENT:
        console.log('Connection event:', sideEffect.payload);
        break;
    }
  }

  /**
   * Connect WebSocket
   */
  private connectWebSocket(_payload: any): void {
    if (this.ws) {
      this.ws.close();
    }

    try {
      // Build WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/ws`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // Start authentication
        this.dispatchEvent({ type: ConnectionEvent.AUTHENTICATED });
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };

      this.ws.onclose = (event) => {
        if (event.code !== 1000) { // Not a normal closure
          this.dispatchEvent({ type: ConnectionEvent.CONNECTION_LOST });
        } else {
          this.dispatchEvent({ type: ConnectionEvent.DISCONNECT });
        }
      };

      this.ws.onerror = () => {
        this.dispatchEvent({ type: ConnectionEvent.CONNECTION_LOST });
      };

      // Set connection timeout
      this.setTimer('connection_timeout', this.config.connectionTimeoutMs, () => {
        this.dispatchEvent({ type: ConnectionEvent.TIMEOUT });
      });

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.dispatchEvent({ type: ConnectionEvent.CONNECTION_LOST });
    }
  }

  /**
   * Disconnect WebSocket
   */
  private disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    this.clearAllTimers();
  }

  /**
   * Authenticate with the server
   */
  private authenticate(payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'authenticate',
        characterId: this.context.characterId,
        sessionToken: payload.sessionToken,
        reconnectionToken: this.context.reconnectionToken,
      };
      
      this.ws.send(JSON.stringify(message));
      
      // Set authentication timeout
      this.setTimer('auth_timeout', this.config.admissionTimeoutMs, () => {
        this.dispatchEvent({ type: ConnectionEvent.AUTHENTICATION_FAILED });
      });
    }
  }

  /**
   * Request admission to game instance
   */
  private requestAdmission(payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'request_admission',
        characterId: payload.characterId,
        sessionToken: payload.sessionToken,
        reconnectionToken: payload.reconnectionToken,
        clientVersion: '1.0.0', // Should be read from config
      };
      
      this.ws.send(JSON.stringify(message));
      
      // Set admission timeout
      this.setTimer('admission_timeout', this.config.admissionTimeoutMs, () => {
        this.dispatchEvent({ type: ConnectionEvent.TIMEOUT });
      });
    }
  }

  /**
   * Start queue polling
   */
  private startQueuePolling(interval: number): void {
    this.stopQueuePolling();
    
    this.queuePollInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const message = {
          type: 'queue_status',
          characterId: this.context.characterId,
        };
        
        this.ws.send(JSON.stringify(message));
      }
    }, interval);
  }

  /**
   * Stop queue polling
   */
  private stopQueuePolling(): void {
    if (this.queuePollInterval) {
      clearInterval(this.queuePollInterval);
      this.queuePollInterval = null;
    }
  }

  /**
   * Start retry timer
   */
  private startRetryTimer(delay: number): void {
    this.setTimer('retry', delay, () => {
      this.dispatchEvent({ type: ConnectionEvent.TIMEOUT });
    });
  }

  /**
   * Clear retry timer
   */
  private clearRetryTimer(): void {
    this.clearTimer('retry');
  }

  /**
   * Start grace period timer
   */
  private startGraceTimer(duration: number): void {
    this.setTimer('grace', duration, () => {
      this.dispatchEvent({ type: ConnectionEvent.GRACE_EXPIRED });
    });
  }

  /**
   * Clear grace timer
   */
  private clearGraceTimer(): void {
    this.clearTimer('grace');
  }

  /**
   * Set a timer
   */
  private setTimer(name: string, delay: number, callback: () => void): void {
    this.clearTimer(name);
    this.timers.set(name, window.setTimeout(callback, delay));
  }

  /**
   * Clear a timer
   */
  private clearTimer(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(name);
    }
  }

  /**
   * Clear all timers
   */
  private clearAllTimers(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.stopQueuePolling();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disconnect();
    this.clearAllTimers();
    this.eventHandlers = {};
  }
}