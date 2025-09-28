// T060: Connection State Machine Unit Tests
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

describe('Connection State Machine', () => {
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

  describe('transitionState - Core State Transitions', () => {
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

      expect(result.state).toBe(ConnectionState.CONNECTING);
      expect(result.context.retryCount).toBe(0);
      expect(result.context.lastError).toBeNull();
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.CONNECT_WEBSOCKET,
        payload: { characterId: 'test-character-123' },
      });
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.LOG_EVENT,
        payload: {
          type: 'state_transition',
          fromState: ConnectionState.DISCONNECTED,
          event: ConnectionEvent.CONNECT,
          timestamp: expect.any(Date),
        },
      });
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

      expect(result.state).toBe(ConnectionState.AUTHENTICATING);
      expect(result.context.sessionToken).toBe('test-session-token');
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.AUTHENTICATE,
        payload: { sessionToken: 'test-session-token' },
      });
    });

    it('should transition from AUTHENTICATING to REQUESTING_ADMISSION on AUTHENTICATED', () => {
      const context = {
        ...defaultContext,
        sessionToken: 'existing-token',
      };

      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.AUTHENTICATED,
      };

      const result = transitionState(
        ConnectionState.AUTHENTICATING,
        event,
        context,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.REQUESTING_ADMISSION);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.REQUEST_ADMISSION,
        payload: {
          characterId: context.characterId,
          sessionToken: context.sessionToken,
        },
      });
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

      expect(result.state).toBe(ConnectionState.ADMITTED);
    });

    it('should handle queued admission by transitioning to QUEUED', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.QUEUED,
        payload: {
          queuePosition: 5,
          estimatedWaitTimeMs: 120000,
        },
      };

      const result = transitionState(
        ConnectionState.REQUESTING_ADMISSION,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.QUEUED);
      expect(result.context.queuePosition).toBe(5);
      expect(result.context.estimatedWaitTimeMs).toBe(120000);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.START_QUEUE_MONITORING,
        payload: { intervalMs: defaultConfig.queuePositionUpdateIntervalMs },
      });
    });

    it('should transition from ADMITTED to CONNECTED', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.ADMISSION_GRANTED,
      };

      const result = transitionState(
        ConnectionState.ADMITTED,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.CONNECTED);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.START_HEARTBEAT,
        payload: { intervalMs: defaultConfig.heartbeatIntervalMs },
      });
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.NOTIFY_USER,
        payload: { type: 'success', message: 'Connected successfully' },
      });
    });
  });

  describe('Error State Transitions', () => {
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

      expect(result.state).toBe(ConnectionState.RECONNECTING);
      expect(result.context.retryCount).toBe(2);
      expect(result.context.lastError).toMatchObject({
        type: 'network',
        code: 'CONNECTION_LOST',
        message: 'Connection lost',
        retryable: true,
      });
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.START_RETRY_TIMER,
        payload: { delay: expect.any(Number) },
      });
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

      expect(result.state).toBe(ConnectionState.DISCONNECTED);
      expect(result.context.lastError).toMatchObject({
        type: 'network',
        code: 'MAX_RETRIES_EXCEEDED',
        message: 'Maximum connection retries exceeded',
        retryable: false,
      });
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.NOTIFY_USER,
        payload: { type: 'error', message: 'Connection failed after multiple attempts' },
      });
    });

    it('should handle rate limiting', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.RATE_LIMITED,
        payload: { retryAfterMs: 60000 },
      };

      const result = transitionState(
        ConnectionState.REQUESTING_ADMISSION,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.RATE_LIMITED);
      expect(result.context.retryAfterMs).toBe(60000);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.START_RETRY_TIMER,
        payload: { delay: 60000 },
      });
    });

    it('should handle drain mode', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.DRAIN_MODE,
      };

      const result = transitionState(
        ConnectionState.REQUESTING_ADMISSION,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.DRAIN_MODE);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.NOTIFY_USER,
        payload: { type: 'warning', message: 'Server is in drain mode, please try again later' },
      });
    });
  });

  describe('Queue Management', () => {
    it('should update queue position', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.QUEUE_POSITION_UPDATE,
        payload: {
          queuePosition: 3,
          estimatedWaitTimeMs: 60000,
        },
      };

      const context = {
        ...defaultContext,
        queuePosition: 5,
        estimatedWaitTimeMs: 120000,
      };

      const result = transitionState(
        ConnectionState.QUEUED,
        event,
        context,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.QUEUED);
      expect(result.context.queuePosition).toBe(3);
      expect(result.context.estimatedWaitTimeMs).toBe(60000);
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

      expect(result.state).toBe(ConnectionState.ADMITTED);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.STOP_QUEUE_MONITORING,
      });
    });
  });

  describe('Disconnection Flow', () => {
    it('should handle graceful disconnect from CONNECTED', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.DISCONNECT,
      };

      const result = transitionState(
        ConnectionState.CONNECTED,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.DISCONNECTING);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.STOP_HEARTBEAT,
      });
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.DISCONNECT_WEBSOCKET,
      });
    });

    it('should transition to DISCONNECTED after disconnecting', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECTION_LOST,
      };

      const result = transitionState(
        ConnectionState.DISCONNECTING,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Grace Period and Reconnection', () => {
    it('should enter grace period on connection loss from CONNECTED', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.CONNECTION_LOST,
      };

      const context = {
        ...defaultContext,
        sessionToken: 'active-session',
      };

      const result = transitionState(
        ConnectionState.CONNECTED,
        event,
        context,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.GRACE_PERIOD);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.STOP_HEARTBEAT,
      });
    });

    it('should handle reconnection from grace period', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.RECONNECTION_AVAILABLE,
        payload: { reconnectionToken: 'reconnect-token-123' },
      };

      const result = transitionState(
        ConnectionState.GRACE_PERIOD,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.RECONNECTING);
      expect(result.context.reconnectionToken).toBe('reconnect-token-123');
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.RECONNECT_WITH_TOKEN,
        payload: { token: 'reconnect-token-123' },
      });
    });

    it('should handle grace period expiration', () => {
      const event: ConnectionEventWithPayload = {
        type: ConnectionEvent.GRACE_EXPIRED,
      };

      const result = transitionState(
        ConnectionState.GRACE_PERIOD,
        event,
        defaultContext,
        defaultConfig
      );

      expect(result.state).toBe(ConnectionState.DISCONNECTED);
      expect(result.context.sessionToken).toBeNull();
      expect(result.context.reconnectionToken).toBeNull();
    });
  });

  describe('State Validation Functions', () => {
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
      it('should return valid events for each state', () => {
        const disconnectedEvents = getValidEvents(ConnectionState.DISCONNECTED);
        expect(disconnectedEvents).toContain(ConnectionEvent.CONNECT);

        const connectingEvents = getValidEvents(ConnectionState.CONNECTING);
        expect(connectingEvents).toContain(ConnectionEvent.AUTHENTICATED);
        expect(connectingEvents).toContain(ConnectionEvent.CONNECTION_LOST);
        expect(connectingEvents).toContain(ConnectionEvent.TIMEOUT);
        expect(connectingEvents).toContain(ConnectionEvent.DISCONNECT);

        const queuedEvents = getValidEvents(ConnectionState.QUEUED);
        expect(queuedEvents).toContain(ConnectionEvent.PROMOTED);
        expect(queuedEvents).toContain(ConnectionEvent.QUEUE_POSITION_UPDATE);
        expect(queuedEvents).toContain(ConnectionEvent.CANCEL);
      });
    });

    describe('state classification functions', () => {
      it('should correctly identify connected states', () => {
        expect(isConnected(ConnectionState.CONNECTED)).toBe(true);
        expect(isConnected(ConnectionState.ADMITTED)).toBe(false);
        expect(isConnected(ConnectionState.DISCONNECTED)).toBe(false);
      });

      it('should correctly identify connecting states', () => {
        expect(isConnecting(ConnectionState.CONNECTING)).toBe(true);
        expect(isConnecting(ConnectionState.AUTHENTICATING)).toBe(true);
        expect(isConnecting(ConnectionState.REQUESTING_ADMISSION)).toBe(true);
        expect(isConnecting(ConnectionState.RECONNECTING)).toBe(true);
        expect(isConnecting(ConnectionState.CONNECTED)).toBe(false);
        expect(isConnecting(ConnectionState.DISCONNECTED)).toBe(false);
      });

      it('should correctly identify error states', () => {
        expect(isErrorState(ConnectionState.REJECTED)).toBe(true);
        expect(isErrorState(ConnectionState.RATE_LIMITED)).toBe(true);
        expect(isErrorState(ConnectionState.DRAIN_MODE)).toBe(true);
        expect(isErrorState(ConnectionState.MAINTENANCE)).toBe(true);
        expect(isErrorState(ConnectionState.CONNECTED)).toBe(false);
        expect(isErrorState(ConnectionState.DISCONNECTED)).toBe(false);
      });

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

  describe('Edge Cases and Error Handling', () => {
    it('should handle unknown events gracefully', () => {
      const event = {
        type: 'UNKNOWN_EVENT' as ConnectionEvent,
      };

      const result = transitionState(
        ConnectionState.DISCONNECTED,
        event,
        defaultContext,
        defaultConfig
      );

      // Should remain in current state with logging side effect
      expect(result.state).toBe(ConnectionState.DISCONNECTED);
      expect(result.sideEffects).toContainEqual({
        type: ConnectionSideEffectType.LOG_EVENT,
        payload: {
          type: 'state_transition',
          fromState: ConnectionState.DISCONNECTED,
          event: 'UNKNOWN_EVENT',
          timestamp: expect.any(Date),
        },
      });
    });

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
      expect(result.state).toBeDefined();
      expect(result.context).toBeDefined();
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
      expect(result.context).not.toBe(defaultContext);
    });

    it('should handle rapid state transitions', () => {
      let currentState = ConnectionState.DISCONNECTED;
      let currentContext = { ...defaultContext };

      // Simulate rapid connection sequence
      const events: ConnectionEventWithPayload[] = [
        { type: ConnectionEvent.CONNECT },
        { type: ConnectionEvent.AUTHENTICATED, payload: { sessionToken: 'token' } },
        { type: ConnectionEvent.AUTHENTICATED }, // Re-authentication
        { type: ConnectionEvent.ADMISSION_GRANTED, payload: { outcome: AdmissionOutcome.ADMITTED } },
        { type: ConnectionEvent.ADMISSION_GRANTED }, // Final connection
      ];

      for (const event of events) {
        const result = transitionState(currentState, event, currentContext, defaultConfig);
        currentState = result.state;
        currentContext = result.context;
      }

      expect(currentState).toBe(ConnectionState.CONNECTED);
      expect(currentContext.sessionToken).toBe('token');
    });
  });

  describe('Exponential Backoff', () => {
    it('should calculate correct retry delays', () => {
      const config = {
        ...defaultConfig,
        baseRetryDelayMs: 1000,
        maxRetryDelayMs: 10000,
      };

      // Test multiple retry attempts to verify exponential backoff
      const retrySequence = [1, 2, 3, 4, 5];
      const expectedDelays = [1000, 2000, 4000, 8000, 10000]; // Capped at max

      retrySequence.forEach((retryCount, index) => {
        const context = {
          ...defaultContext,
          retryCount: retryCount - 1, // Will be incremented
        };

        const event: ConnectionEventWithPayload = {
          type: ConnectionEvent.CONNECTION_LOST,
        };

        const result = transitionState(
          ConnectionState.CONNECTING,
          event,
          context,
          config
        );

        const retryEffect = result.sideEffects.find(
          effect => effect.type === ConnectionSideEffectType.START_RETRY_TIMER
        );

        expect(retryEffect?.payload?.delay).toBe(expectedDelays[index]);
      });
    });
  });
});