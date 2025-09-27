import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Invalid Instance ID Rejection (FR-018)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject connections to non-existent instances', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 404 for invalid instance
    
    const invalidInstanceId = 'non-existent-instance-999';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${invalidInstanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    expect(response.statusCode).toBe(404);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('reason', FailureReason.INVALID_INSTANCE);
    expect(body).toHaveProperty('instanceId', invalidInstanceId);
    expect(body).toHaveProperty('message');
    expect(body.message).toContain('not found');
  });

  it('should validate instance ID format', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Malformed instance IDs should be rejected
    
    const malformedInstanceId = 'invalid@#$%^&*()';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${encodeURIComponent(malformedInstanceId)}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    expect([400, 404]).toContain(response.statusCode);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    
    if (response.statusCode === 400) {
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('instanceId');
    } else {
      expect(body).toHaveProperty('reason', FailureReason.INVALID_INSTANCE);
    }
  });

  it('should handle instance lookup efficiently', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Instance validation should be fast
    
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

    // Instance lookup should be fast regardless of outcome
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    expect(responseTime).toBeLessThan(100); // Instance lookup under 100ms
    
    if (response.statusCode === 404) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('instanceLookupTime');
      expect(typeof body.instanceLookupTime).toBe('number');
      expect(body.instanceLookupTime).toBeLessThan(50);
    }
  });
});