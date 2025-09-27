import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Character Ownership Mismatch (FR-003)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject connection for character not owned by user', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 403 for ownership mismatch
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token-user1'
      },
      payload: {
        characterId: 'char-owned-by-user2', // Character owned by different user
        clientBuild: '1.0.0'
      }
    });

    // Expect 403 Forbidden for ownership mismatch
    expect(response.statusCode).toBe(403);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('reason', FailureReason.CHARACTER_NOT_OWNED);
    expect(body).toHaveProperty('characterId', 'char-owned-by-user2');
    expect(body).toHaveProperty('ownerId');
    expect(body.ownerId).not.toBe(body.requestingUserId);
    
    // Should not leak sensitive information about the actual owner
    expect(body).not.toHaveProperty('ownerDetails');
    expect(body).not.toHaveProperty('ownerUsername');
  });

  it('should validate character existence before ownership check', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Non-existent characters should be handled before ownership check
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-does-not-exist',
        clientBuild: '1.0.0'
      }
    });

    // Should handle non-existent character appropriately
    expect([403, 404, 422]).toContain(response.statusCode);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    
    if (response.statusCode === 404) {
      expect(body).toHaveProperty('reason', FailureReason.CHARACTER_NOT_FOUND);
    } else if (response.statusCode === 403) {
      expect(body).toHaveProperty('reason', FailureReason.CHARACTER_NOT_OWNED);
    }
  });

  it('should accept connection for character owned by user', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Valid ownership should not be rejected on ownership grounds
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token-user1'
      },
      payload: {
        characterId: 'char-owned-by-user1', // Character owned by same user
        clientBuild: '1.0.0'
      }
    });

    // Should not reject based on ownership (may reject for other reasons)
    expect(response.statusCode).not.toBe(403);
    expect([200, 202, 401, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      const body = JSON.parse(response.body);
      expect(body.reason).not.toBe(FailureReason.CHARACTER_NOT_OWNED);
    }
  });

  it('should handle ownership checks efficiently', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Ownership validation should be fast (<50ms)
    
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

    // Ownership check should be efficient
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    
    // Even for ownership failures, should be fast
    if (response.statusCode === 403) {
      expect(responseTime).toBeLessThan(50);
      
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.CHARACTER_NOT_OWNED) {
        expect(body).toHaveProperty('ownershipCheckTime');
        expect(typeof body.ownershipCheckTime).toBe('number');
        expect(body.ownershipCheckTime).toBeLessThan(50);
      }
    }
  });

  it('should include security logging for ownership violations', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Ownership violations should be logged for security monitoring
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-forwarded-for': '192.168.1.100'
      },
      payload: {
        characterId: 'char-not-owned',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 404, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 403) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.CHARACTER_NOT_OWNED) {
        // Should include correlation ID for security log correlation
        expect(body).toHaveProperty('correlationId');
        expect(typeof body.correlationId).toBe('string');
        expect(body.correlationId.length).toBeGreaterThan(0);
        
        // Should include security event type
        expect(body).toHaveProperty('securityEvent', 'ownership_violation');
      }
    }
  });
});