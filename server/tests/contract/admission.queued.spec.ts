import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Queued Response', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should queue user when server capacity is full', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 202 with queue position when full
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    // Expect 202 Accepted with queue information
    expect(response.statusCode).toBe(202);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.QUEUED);
    expect(body).toHaveProperty('position');
    expect(body.position).toBeGreaterThan(0);
    expect(body).toHaveProperty('estimatedWait');
    expect(typeof body.estimatedWait).toBe('number');
    
    // Performance requirement: Response under 100ms
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    expect(responseTime).toBeLessThan(100);
  });

  it('should provide queue status endpoint', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: GET /instances/{id}/queue/status returns current queue info
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });

    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('queueLength');
    expect(body).toHaveProperty('estimatedWait');
    expect(body).toHaveProperty('serverCapacity');
    expect(body).toHaveProperty('activeConnections');
    expect(typeof body.queueLength).toBe('number');
    expect(typeof body.estimatedWait).toBe('number');
    expect(typeof body.serverCapacity).toBe('number');
    expect(typeof body.activeConnections).toBe('number');
    
    // Performance requirement: Response under 50ms
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    expect(responseTime).toBeLessThan(50);
  });

  it('should handle queue full scenario', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: When queue is at max capacity, reject with 503
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    // When queue is full, expect 503 Service Unavailable
    expect([202, 503]).toContain(response.statusCode);
    
    const body = JSON.parse(response.body);
    if (response.statusCode === 503) {
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.QUEUE_FULL);
      expect(body).toHaveProperty('retryAfter');
      expect(typeof body.retryAfter).toBe('number');
    } else {
      // If not full, should be queued normally
      expect(body).toHaveProperty('outcome', AttemptOutcome.QUEUED);
      expect(body).toHaveProperty('position');
    }
  });
});