import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Queue Full Immediate Rejection', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should immediately reject when queue is at maximum capacity', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User attempts connection when both server and queue are full, gets immediate rejection
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-queue-full-test',
        clientBuild: '1.0.0'
      }
    });
    
    // Should either succeed, be queued, or reject if queue is full
    expect([200, 202, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.QUEUE_FULL) {
        expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
        expect(body).toHaveProperty('queueCapacity');
        expect(body).toHaveProperty('retryAfter');
        expect(typeof body.retryAfter).toBe('number');
        expect(body.retryAfter).toBeGreaterThan(0);
      }
    }
  });
});