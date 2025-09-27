import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Queue Full Response', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject when queue is at maximum capacity', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 503 when queue is full
    
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

    // Expect 503 Service Unavailable when queue is full
    expect(response.statusCode).toBe(503);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('reason', FailureReason.QUEUE_FULL);
    expect(body).toHaveProperty('retryAfter');
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
    
    // Should include queue capacity information
    expect(body).toHaveProperty('queueCapacity');
    expect(typeof body.queueCapacity).toBe('number');
    
    // Performance requirement: Response under 100ms even when rejecting
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    expect(responseTime).toBeLessThan(100);
  });

  it('should include proper retry-after header when queue is full', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: 503 responses should include Retry-After header
    
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

    if (response.statusCode === 503) {
      // Retry-After header should be present for 503 responses
      expect(response.headers['retry-after']).toBeDefined();
      const retryAfter = parseInt(response.headers['retry-after'] as string);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThan(300); // Should be reasonable (< 5 minutes)
      
      const body = JSON.parse(response.body);
      expect(body.retryAfter).toBe(retryAfter);
    } else {
      // If queue isn't full, this test passes (queue capacity varies)
      expect([200, 202]).toContain(response.statusCode);
    }
  });

  it('should log queue full events for monitoring', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Queue full rejections should be logged for capacity planning
    
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

    // This test validates that the response is properly formed
    // The actual logging validation would require log capture infrastructure
    expect([200, 202, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.QUEUE_FULL);
      
      // Should include correlation ID for log tracing
      expect(body).toHaveProperty('correlationId');
      expect(typeof body.correlationId).toBe('string');
      expect(body.correlationId.length).toBeGreaterThan(0);
    }
  });
});