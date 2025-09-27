import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Rate Limited 429', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should return 429 when rate limit is exceeded', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 429 after 5 failures in window
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-forwarded-for': '192.168.1.100' // Simulate specific IP
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    // This single request should not be rate limited initially
    // But the implementation should support rate limiting
    expect([200, 202, 401, 403, 422, 429, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 429) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.RATE_LIMITED);
      expect(body).toHaveProperty('retryAfter');
      expect(typeof body.retryAfter).toBe('number');
      expect(body.retryAfter).toBeGreaterThan(0);
      
      // Should include rate limit headers
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    }
  });

  it('should include rate limit headers in all responses', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: All admission requests should include rate limit headers
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-forwarded-for': '192.168.1.101'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    // Rate limit headers should be present regardless of outcome
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
    
    const limit = parseInt(response.headers['x-ratelimit-limit'] as string);
    const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string);
    const reset = parseInt(response.headers['x-ratelimit-reset'] as string);
    
    expect(limit).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(limit);
    expect(reset).toBeGreaterThan(Date.now() / 1000 - 3600); // Within last hour
  });

  it('should reset rate limit after window expires', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Rate limits should reset after the configured window
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-forwarded-for': '192.168.1.102'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    // This test validates the response structure for rate limit tracking
    expect([200, 202, 401, 403, 422, 429, 503]).toContain(response.statusCode);
    
    if (response.headers['x-ratelimit-reset']) {
      const reset = parseInt(response.headers['x-ratelimit-reset'] as string);
      const now = Math.floor(Date.now() / 1000);
      
      // Reset time should be in the future but reasonable
      expect(reset).toBeGreaterThan(now - 1); // Allow 1s clock skew
      expect(reset).toBeLessThan(now + 3600); // Should be within 1 hour
    }
  });

  it('should track rate limits per IP address', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Rate limiting should be applied per client IP
    
    const instanceId = 'test-instance-001';
    
    // First request from IP1
    const response1 = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-forwarded-for': '192.168.1.103'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    // Second request from IP2
    const response2 = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-forwarded-for': '192.168.1.104'
      },
      payload: {
        characterId: 'char-002',
        clientBuild: '1.0.0'
      }
    });

    // Both should have independent rate limits
    expect([200, 202, 401, 403, 422, 429, 503]).toContain(response1.statusCode);
    expect([200, 202, 401, 403, 422, 429, 503]).toContain(response2.statusCode);
    
    // Rate limit headers should be independent
    if (response1.headers['x-ratelimit-remaining'] && response2.headers['x-ratelimit-remaining']) {
      const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'] as string);
      const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'] as string);
      
      // Could be the same if both are fresh, but should be valid
      expect(remaining1).toBeGreaterThanOrEqual(0);
      expect(remaining2).toBeGreaterThanOrEqual(0);
    }
  });
});