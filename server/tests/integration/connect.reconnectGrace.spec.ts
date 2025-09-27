import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, SessionState } from '../../src/domain/connection';

describe('Integration: Reconnection Within 60s Grace', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should allow reconnection within grace period', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User's connection drops, they reconnect within 60s, session restored seamlessly
    
    const instanceId = 'test-instance-001';
    
    // Step 1: Establish initial session (or simulate existing one)
    const initialResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token-reconnect'
      },
      payload: {
        characterId: 'char-grace-reconnect',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 409]).toContain(initialResponse.statusCode);
    
    let reconnectionToken: string | undefined;
    if (initialResponse.statusCode === 200) {
      const body = JSON.parse(initialResponse.body);
      reconnectionToken = body.reconnectionToken;
    } else if (initialResponse.statusCode === 409) {
      // Session exists, check if in grace period
      const body = JSON.parse(initialResponse.body);
      if (body.existingSession?.state === SessionState.GRACE) {
        reconnectionToken = body.existingSession.reconnectionToken;
      }
    }
    
    // Step 2: Simulate reconnection within grace period
    if (reconnectionToken) {
      const reconnectResponse = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token-reconnect'
        },
        payload: {
          characterId: 'char-grace-reconnect',
          clientBuild: '1.0.0',
          reconnectionToken: reconnectionToken
        }
      });

      expect([200, 410]).toContain(reconnectResponse.statusCode);
      
      if (reconnectResponse.statusCode === 200) {
        const body = JSON.parse(reconnectResponse.body);
        expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
        expect(body).toHaveProperty('reconnected', true);
        expect(body).toHaveProperty('sessionRestored', true);
        expect(body).toHaveProperty('gracePeriodUsed', true);
        
        // Should include grace period timing
        expect(body).toHaveProperty('graceTimeRemaining');
        expect(typeof body.graceTimeRemaining).toBe('number');
        expect(body.graceTimeRemaining).toBeGreaterThan(0);
        expect(body.graceTimeRemaining).toBeLessThanOrEqual(60000); // 60s grace period
      }
    }
  });

  it('should preserve session state during grace reconnection', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that user's session state is preserved during reconnection
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-state-preservation',
        clientBuild: '1.0.0',
        reconnectionToken: 'valid-grace-token-123'
      }
    });

    expect([200, 410]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      if (body.reconnected && body.sessionRestored) {
        expect(body).toHaveProperty('sessionContinuity', true);
        expect(body).toHaveProperty('statePreserved', true);
        
        // Should include preserved session context
        expect(body).toHaveProperty('restoredContext');
        expect(body.restoredContext).toHaveProperty('lastActivity');
        expect(body.restoredContext).toHaveProperty('characterPosition');
        
        // Should validate grace period was active
        expect(body).toHaveProperty('wasInGracePeriod', true);
        expect(body).toHaveProperty('graceStartedAt');
        expect(typeof body.graceStartedAt).toBe('number');
      }
    }
  });

  it('should handle grace period timing accurately', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates precise timing of 60-second grace period
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-grace-timing',
        clientBuild: '1.0.0',
        reconnectionToken: 'timing-test-token'
      }
    });

    expect([200, 410]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      if (body.gracePeriodUsed) {
        expect(body).toHaveProperty('graceTimeRemaining');
        expect(body).toHaveProperty('gracePeriodDuration', 60000); // 60 seconds
        
        const timeRemaining = body.graceTimeRemaining;
        const totalGracePeriod = body.gracePeriodDuration;
        const timeUsed = totalGracePeriod - timeRemaining;
        
        // Validate timing calculations
        expect(timeUsed).toBeGreaterThanOrEqual(0);
        expect(timeUsed).toBeLessThan(totalGracePeriod);
        expect(timeRemaining).toBeGreaterThan(0);
      }
    } else if (response.statusCode === 410) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('gracePeriodExpired', true);
      expect(body).toHaveProperty('gracePeriodDuration', 60000);
    }
  });

  it('should log grace reconnection events', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that reconnection events are properly logged for monitoring
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-correlation-id': 'grace-reconnect-test'
      },
      payload: {
        characterId: 'char-logging-test',
        clientBuild: '1.0.0',
        reconnectionToken: 'logging-test-token'
      }
    });

    expect([200, 410]).toContain(response.statusCode);
    
    // Should include correlation ID in response
    expect(response.headers['x-correlation-id']).toBeDefined();
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      if (body.reconnected) {
        expect(body).toHaveProperty('eventLogged', true);
        expect(body).toHaveProperty('correlationId');
        expect(body.correlationId).toBe('grace-reconnect-test');
        
        // Should include reconnection metrics
        expect(body).toHaveProperty('reconnectionLatency');
        expect(typeof body.reconnectionLatency).toBe('number');
        expect(body.reconnectionLatency).toBeGreaterThan(0);
        expect(body.reconnectionLatency).toBeLessThan(1000); // Should be fast
      }
    }
  });

  it('should handle concurrent reconnection attempts', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates behavior when multiple reconnection attempts occur simultaneously
    
    const instanceId = 'test-instance-001';
    const reconnectionToken = 'concurrent-test-token';
    
    // Simulate multiple concurrent reconnection attempts
    const concurrentRequests = [
      server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-concurrent-reconnect',
          clientBuild: '1.0.0',
          reconnectionToken: reconnectionToken
        }
      }),
      server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-concurrent-reconnect',
          clientBuild: '1.0.0',
          reconnectionToken: reconnectionToken
        }
      })
    ];

    const responses = await Promise.all(concurrentRequests);
    
    // Only one should succeed, others should be rejected
    const successCount = responses.filter(r => r.statusCode === 200).length;
    expect(successCount).toBeLessThanOrEqual(1);
    
    // Should handle race condition gracefully
    for (const response of responses) {
      expect([200, 400, 409, 410]).toContain(response.statusCode);
      
      if (response.statusCode === 409) {
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('concurrentReconnectionDetected', true);
      }
    }
  });
});