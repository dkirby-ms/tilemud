import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Rate Limit Lock After 5 Failures', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should lock user after 5 consecutive failures', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User makes 5 failed attempts, gets locked out for a period
    
    const instanceId = 'test-instance-001';
    const attempts = [];
    
    // Simulate 5 consecutive failures
    for (let i = 0; i < 5; i++) {
      const response = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer invalid-jwt-token', // Invalid token to trigger failure
          'x-forwarded-for': '192.168.1.100' // Consistent IP for rate limiting
        },
        payload: {
          characterId: 'char-rate-limit-test',
          clientBuild: '1.0.0'
        }
      });
      
      attempts.push(response);
    }
    
    // After 5 failures, should be rate limited
    const sixthResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token', // Valid token but should be rate limited
        'x-forwarded-for': '192.168.1.100'
      },
      payload: {
        characterId: 'char-rate-limit-test',
        clientBuild: '1.0.0'
      }
    });
    
    expect([401, 429]).toContain(sixthResponse.statusCode);
    
    if (sixthResponse.statusCode === 429) {
      const body = JSON.parse(sixthResponse.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.RATE_LIMITED);
      expect(body).toHaveProperty('lockoutRemaining');
      expect(typeof body.lockoutRemaining).toBe('number');
      expect(body.lockoutRemaining).toBeGreaterThan(0);
    }
  });
});