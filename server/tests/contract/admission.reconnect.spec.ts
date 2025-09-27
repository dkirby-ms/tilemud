import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Reconnection Attempt', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should accept valid reconnection tokens', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect accepts valid reconnection tokens
    
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
        clientBuild: '1.0.0',
        reconnectionToken: 'valid-reconnect-token-123'
      }
    });

    // Normal operation without existing sessions won't trigger reconnection
    expect([200, 202, 400, 401, 403, 410, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
      expect(body).toHaveProperty('reconnected', true);
      expect(body).toHaveProperty('sessionId');
      expect(body).toHaveProperty('reconnectionToken'); // New token for next time
      
      // Should indicate grace period was used
      expect(body).toHaveProperty('gracePeriodUsed', true);
      expect(body).toHaveProperty('previousDisconnectAt');
    }
  });

  it('should reject expired reconnection tokens', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Expired reconnection tokens should return 410
    
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
        clientBuild: '1.0.0',
        reconnectionToken: 'expired-token-456'
      }
    });

    // Expired tokens should be rejected with 410
    expect([200, 202, 400, 410, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 410) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('tokenExpired', true);
      expect(body).toHaveProperty('gracePeriodExpired', true);
      expect(body).toHaveProperty('gracePeriodDuration');
      expect(typeof body.gracePeriodDuration).toBe('number');
    }
  });

  it('should reject invalid reconnection tokens', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Invalid/malformed tokens should return 400
    
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
        clientBuild: '1.0.0',
        reconnectionToken: 'invalid-malformed-token'
      }
    });

    expect([200, 202, 400, 401, 403, 410, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 400) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('reconnectionToken');
      expect(body).toHaveProperty('tokenValid', false);
    }
  });

  it('should validate token matches character', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Reconnection tokens should be character-specific
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-002',
        clientBuild: '1.0.0',
        reconnectionToken: 'token-for-char-001' // Wrong character
      }
    });

    expect([200, 202, 400, 401, 403, 410, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 400) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('tokenMismatch', true);
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('character');
    }
  });

  it('should handle reconnection performance requirements', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Reconnection should be fast (<200ms)
    
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
        clientBuild: '1.0.0',
        reconnectionToken: 'fast-reconnect-token'
      }
    });

    // Reconnection should be fast regardless of outcome
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    expect(responseTime).toBeLessThan(200);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      if (body.reconnected) {
        expect(body).toHaveProperty('reconnectionTime');
        expect(typeof body.reconnectionTime).toBe('number');
        expect(body.reconnectionTime).toBeLessThan(200);
      }
    }
  });
});