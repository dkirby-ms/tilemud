// T060: Connection State Machine Unit Tests - Focused Implementation
import { describe, it, expect } from 'vitest';
import { transitionState, isValidTransition, getValidEvents, isConnected, isConnecting, isErrorState, canRetry } from '../../src/features/connection/machine/stateMachine';
import {
  ConnectionState,
  ConnectionEvent,
  ConnectionSideEffectType,
  AdmissionOutcome,
  INITIAL_CONNECTION_CONTEXT,
} from '../../src/features/connection/machine/types';
import type {
  ConnectionEventWithPayload,
  ConnectionContext,
  ConnectionConfig,
} from '../../src/features/connection/machine/types';

describe('Connection State Machine - Core Tests', () => {
  const defaultConfig: ConnectionConfig = {
    connectionTimeoutMs: 5000,
    admissionTimeoutMs: 10000,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
    queuePollIntervalMs: 5000,
    gracePeriodMs: 30000,
    reconnectionWindowMs: 60000,
  };

  const defaultContext: ConnectionContext = {
    ...INITIAL_CONNECTION_CONTEXT,
    characterId: 'test-character-123',
  };

  describe('Basic State Transitions', () => {
    it('should transition from DISCONNECTED to CONNECTING on CONNECT event', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECT,
        payload: { characterId: 'test-character-123' },
      };

      const result = transitionState(
        ConnectionState.DISCONNECTED,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.CONNECTING);
      expect(result.nextContext.retryCount).toBe(0);
      expect(result.nextContext.lastError).toBeNull();
      expect(result.sideEffects).toBeDefined();
      expect(result.sideEffects!.length).toBeGreaterThan(0);
      
      // Check for WebSocket connection side effect
      const connectEffect = result.sideEffects!.find(
        effect => effect.type === ConnectionSideEffectType.CONNECT_WEBSOCKET
      );
      expect(connectEffect).toBeDefined();
    });

    it('should transition from CONNECTING to AUTHENTICATING on AUTHENTICATED event', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.AUTHENTICATED,
        payload: { sessionToken: 'test-session-token' },
      };

      const result = transitionState(
        ConnectionState.CONNECTING,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.AUTHENTICATING);
      expect(result.nextContext.sessionToken).toBe('test-session-token');
      
      // Check for authentication side effect
      const authEffect = result.sideEffects!.find(
        effect => effect.type === ConnectionSideEffectType.AUTHENTICATE
      );
      expect(authEffect).toBeDefined();
    });

    it('should handle admission granted by transitioning to ADMITTED', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.ADMISSION_GRANTED,
        payload: { outcome: AdmissionOutcome.ADMITTED },
      };

      const result = transitionState(
        ConnectionState.REQUESTING_ADMISSION,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.ADMITTED);
    });

    it('should handle disconnect event properly', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.DISCONNECT,
      };

      const result = transitionState(
        ConnectionState.CONNECTING,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.DISCONNECTED);
      
      // Should have disconnect side effect
      const disconnectEffect = result.sideEffects!.find(
        effect => effect.type === ConnectionSideEffectType.DISCONNECT_WEBSOCKET
      );
      expect(disconnectEffect).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection loss with retry logic', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECTION_LOST,
      };

      const context = {
        ...defaultContext,
        retryCount: 1,
      };

      const result = transitionState(
        ConnectionState.CONNECTING,
        event,
        context,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.RECONNECTING);
      expect(result.nextContext.retryCount).toBe(2);
      expect(result.nextContext.lastError).toBeDefined();
      expect(result.nextContext.lastError!.retryable).toBe(true);
    });

    it('should stop retrying after max retries exceeded', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECTION_LOST,
      };

      const context = {
        ...defaultContext,
        retryCount: 3, // At max retries
      };

      const result = transitionState(
        ConnectionState.CONNECTING,
        event,
        context,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.DISCONNECTED);
      expect(result.nextContext.lastError).toBeDefined();
      expect(result.nextContext.lastError!.retryable).toBe(false);
    });

    it('should handle timeout events', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.TIMEOUT,
      };

      const context = {
        ...defaultContext,
        retryCount: 0,
      };

      const result = transitionState(
        ConnectionState.CONNECTING,
        event,
        context,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.RECONNECTING);
      expect(result.nextContext.retryCount).toBe(1);
      expect(result.nextContext.lastError!.code).toBe('CONNECTION_TIMEOUT');
    });
  });

  describe('Queue Management', () => {
    it('should handle queued status', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.QUEUED,
        payload: {
          queuePosition: {
            position: 5,
            depth: 50,
            estimatedWaitTime: 120,
            lastUpdated: new Date(),
          },
        },
      };

      const result = transitionState(
        ConnectionState.REQUESTING_ADMISSION,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.QUEUED);
      expect(result.nextContext.queuePosition).toBe(5);
      expect(result.nextContext.queueDepth).toBe(50);
      expect(result.nextContext.estimatedWaitTime).toBe(120);
    });

    it('should handle queue position updates', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.QUEUE_POSITION_UPDATE,
        payload: {
          queuePosition: {
            position: 3,
            depth: 48,
            estimatedWaitTime: 60,
            lastUpdated: new Date(),
          },
        },
      };

      const context = {
        ...defaultContext,
        queuePosition: 5,
        queueDepth: 50,
        estimatedWaitTime: 120,
      };

      const result = transitionState(
        ConnectionState.QUEUED,
        event,
        context,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.QUEUED);
      expect(result.nextContext.queuePosition).toBe(3);
      expect(result.nextContext.queueDepth).toBe(48);
      expect(result.nextContext.estimatedWaitTime).toBe(60);
    });

    it('should handle queue promotion', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.PROMOTED,
      };

      const result = transitionState(
        ConnectionState.QUEUED,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.nextState).toBe(ConnectionState.ADMITTED);
    });
  });

  describe('State Classification Functions', () => {
    describe('isConnected', () => {
      it('should correctly identify connected states', () => {
        expect(isConnected(ConnectionState.CONNECTED)).toBe(true);
        expect(isConnected(ConnectionState.ADMITTED)).toBe(false);
        expect(isConnected(ConnectionState.DISCONNECTED)).toBe(false);
      });
    });

    describe('isConnecting', () => {
      it('should correctly identify connecting states', () => {
        expect(isConnecting(ConnectionState.CONNECTING)).toBe(true);
        expect(isConnecting(ConnectionState.AUTHENTICATING)).toBe(true);
        expect(isConnecting(ConnectionState.REQUESTING_ADMISSION)).toBe(true);
        expect(isConnecting(ConnectionState.RECONNECTING)).toBe(true);
        expect(isConnecting(ConnectionState.CONNECTED)).toBe(false);
        expect(isConnecting(ConnectionState.DISCONNECTED)).toBe(false);
      });
    });

    describe('isErrorState', () => {
      it('should correctly identify error states', () => {
        expect(isErrorState(ConnectionState.REJECTED)).toBe(true);
        expect(isErrorState(ConnectionState.RATE_LIMITED)).toBe(true);
        expect(isErrorState(ConnectionState.DRAIN_MODE)).toBe(true);
        expect(isErrorState(ConnectionState.MAINTENANCE)).toBe(true);
        expect(isErrorState(ConnectionState.CONNECTED)).toBe(false);
        expect(isErrorState(ConnectionState.DISCONNECTED)).toBe(false);
      });
    });

    describe('canRetry', () => {
      it('should correctly determine retry capability', () => {
        const retryableContext = {
          ...defaultContext,
          retryCount: 1,
          lastError: {
            type: 'network' as const,
            code: 'CONNECTION_LOST',
            message: 'Connection lost',
            retryable: true,
            timestamp: new Date(),
          },
        };

        const nonRetryableContext = {
          ...defaultContext,
          retryCount: 3, // At max retries
          lastError: {
            type: 'network' as const,
            code: 'MAX_RETRIES_EXCEEDED',
            message: 'Max retries exceeded',
            retryable: false,
            timestamp: new Date(),
          },
        };

        expect(canRetry(ConnectionState.RATE_LIMITED, retryableContext)).toBe(true);
        expect(canRetry(ConnectionState.REJECTED, nonRetryableContext)).toBe(false);
        expect(canRetry(ConnectionState.CONNECTED, retryableContext)).toBe(false);
      });
    });
  });

  describe('State Transition Validation', () => {
    describe('isValidTransition', () => {
      it('should validate correct state transitions', () => {
        expect(isValidTransition(ConnectionState.DISCONNECTED, ConnectionEvent.CONNECT)).toBe(true);
        expect(isValidTransition(ConnectionState.CONNECTING, ConnectionEvent.AUTHENTICATED)).toBe(true);
        expect(isValidTransition(ConnectionState.QUEUED, ConnectionEvent.PROMOTED)).toBe(true);
        expect(isValidTransition(ConnectionState.CONNECTED, ConnectionEvent.DISCONNECT)).toBe(true);
      });

      it('should reject invalid state transitions', () => {
        expect(isValidTransition(ConnectionState.DISCONNECTED, ConnectionEvent.PROMOTED)).toBe(false);
        expect(isValidTransition(ConnectionState.CONNECTED, ConnectionEvent.CONNECT)).toBe(false);
        expect(isValidTransition(ConnectionState.QUEUED, ConnectionEvent.AUTHENTICATED)).toBe(false);
      });
    });

    describe('getValidEvents', () => {
      it('should return valid events for disconnected state', () => {
        const events = getValidEvents(ConnectionState.DISCONNECTED);
        expect(events).toContain(ConnectionEvent.CONNECT);
        expect(events.length).toBeGreaterThan(0);
      });

      it('should return valid events for connecting state', () => {
        const events = getValidEvents(ConnectionState.CONNECTING);
        expect(events).toContain(ConnectionEvent.AUTHENTICATED);
        expect(events).toContain(ConnectionEvent.CONNECTION_LOST);
        expect(events).toContain(ConnectionEvent.TIMEOUT);
        expect(events).toContain(ConnectionEvent.DISCONNECT);
      });

      it('should return valid events for queued state', () => {
        const events = getValidEvents(ConnectionState.QUEUED);
        expect(events).toContain(ConnectionEvent.PROMOTED);
        expect(events).toContain(ConnectionEvent.QUEUE_POSITION_UPDATE);
        expect(events).toContain(ConnectionEvent.CANCEL);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle events without payloads', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.RETRY,
      };

      const result = transitionState(
        ConnectionState.RATE_LIMITED,
        event,
        defaultContext,
        defaultConfig
      );

      // Should handle gracefully without errors
      expect(result.nextState).toBeDefined();
      expect(result.nextContext).toBeDefined();
      expect(result.sideEffects).toBeDefined();
    });

    it('should preserve context immutability', () => {
      const originalContext = { ...defaultContext };
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECT,
      };

      const result = transitionState(
        ConnectionState.DISCONNECTED,
        event,
        defaultContext,
        defaultConfig
      );

      // Original context should remain unchanged
      expect(defaultContext).toEqual(originalContext);
      // Result context should be a new object
      expect(result.nextContext).not.toBe(defaultContext);
    });

    it('should handle rapid state transitions', () => {
      let currentState: ConnectionState = ConnectionState.DISCONNECTED;
      let currentContext = { ...defaultContext };

      // Simulate rapid connection sequence
      const events: ConnectionEventWithPayload[] = [
        { type: ConnectionEvent.CONNECT },
        { type: ConnectionEvent.AUTHENTICATED, payload: { sessionToken: 'token' } },
        { type: ConnectionEvent.AUTHENTICATED }, // Re-authentication
        { type: ConnectionEvent.ADMISSION_GRANTED, payload: { outcome: AdmissionOutcome.ADMITTED } },
      ];

      for (const event of events) {
        const result = transitionState(currentState, event, currentContext, defaultConfig);
        currentState = result.nextState;
        currentContext = result.nextContext;
      }

      expect(currentState).toBe(ConnectionState.ADMITTED);
      expect(currentContext.sessionToken).toBe('token');
    });

    it('should always include logging side effect', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECT,
      };

      const result = transitionState(
        ConnectionState.DISCONNECTED,
        event,
        defaultContext,
        defaultConfig
      );

      // Should always have a log event
      const logEffect = result.sideEffects!.find(
        effect => effect.type === ConnectionSideEffectType.LOG_EVENT
      );
      expect(logEffect).toBeDefined();
      expect(logEffect!.payload.type).toBe('state_transition');
      expect(logEffect!.payload.fromState).toBe(ConnectionState.DISCONNECTED);
      expect(logEffect!.payload.event).toBe(ConnectionEvent.CONNECT);
    });
  });
});