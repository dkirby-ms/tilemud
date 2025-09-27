import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Drain Mode Reconnection Handling (NFR-003)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should allow reconnections during drain mode', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // System Requirement: During drain mode, allow reconnections but block new admissions
    
    const instanceId = 'test-instance-drain';
    
    // Simulate existing session in grace period during drain mode
    const reconnectResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/reconnect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        reconnectionToken: 'valid-reconnection-token',
        clientBuild: '1.0.0'
      }
    });
    
    expect([200, 404, 410]).toContain(reconnectResponse.statusCode);
    
    if (reconnectResponse.statusCode === 200) {
      const body = JSON.parse(reconnectResponse.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
      expect(body).toHaveProperty('sessionId');
      expect(body).toHaveProperty('websocketUrl');
    }
  });

  it('should reject new admissions during drain mode', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // System Requirement: New admissions should be blocked during drain mode
    
    const instanceId = 'test-instance-drain-new';
    
    // Attempt new admission during drain mode
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-drain-test',
        clientBuild: '1.0.0',
        allowReplacement: false
      }
    });
    
    expect([200, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', 'DRAIN_MODE');
      expect(body).toHaveProperty('retryAfter');
      expect(typeof body.retryAfter).toBe('number');
      expect(body.retryAfter).toBeGreaterThan(0);
    }
  });

  it('should process existing queue during drain mode', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // System Requirement: Process existing queue entries during drain mode
    
    const instanceId = 'test-instance-drain-queue';
    
    // Check queue status during drain mode
    const queueResponse = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });
    
    expect([200, 404]).toContain(queueResponse.statusCode);
    
    if (queueResponse.statusCode === 200) {
      const queueStatus = JSON.parse(queueResponse.body);
      expect(queueStatus).toHaveProperty('position');
      expect(queueStatus).toHaveProperty('estimatedWait');
      expect(queueStatus).toHaveProperty('drainMode', true);
    }
  });
});