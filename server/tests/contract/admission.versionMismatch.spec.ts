import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Version Mismatch', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject outdated client versions', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 400 for version mismatch
    
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
        clientBuild: '0.8.0' // Outdated version
      }
    });

    // Expect 400 Bad Request for version mismatch
    expect(response.statusCode).toBe(400);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('reason', FailureReason.VERSION_MISMATCH);
    expect(body).toHaveProperty('requiredVersion');
    expect(typeof body.requiredVersion).toBe('string');
    expect(body).toHaveProperty('providedVersion', '0.8.0');
    
    // Should include upgrade instructions
    expect(body).toHaveProperty('upgradeUrl');
    expect(typeof body.upgradeUrl).toBe('string');
    
    // Performance requirement: Fast rejection
    expect(response.headers['x-response-time']).toBeDefined();
    const responseTime = parseFloat(response.headers['x-response-time'] as string);
    expect(responseTime).toBeLessThan(50);
  });

  it('should reject missing client build version', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: clientBuild is required field
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-001'
        // Missing clientBuild
      }
    });

    // Expect 400 Bad Request for missing required field
    expect(response.statusCode).toBe(400);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('reason', FailureReason.VERSION_MISMATCH);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('clientBuild');
  });

  it('should accept current client version', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Current version should not be rejected on version grounds
    
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
        clientBuild: '1.0.0' // Current version (from config)
      }
    });

    // Should not reject based on version (may reject for other reasons)
    expect(response.statusCode).not.toBe(400);
    expect([200, 202, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      const body = JSON.parse(response.body);
      expect(body.reason).not.toBe(FailureReason.VERSION_MISMATCH);
    }
  });

  it('should handle pre-release version validation', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Pre-release versions should follow semver rules
    
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
        clientBuild: '1.0.0-beta.1' // Pre-release version
      }
    });

    // Pre-release should follow server's version compatibility rules
    expect([200, 202, 400, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 400) {
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.VERSION_MISMATCH) {
        expect(body).toHaveProperty('requiredVersion');
        expect(body).toHaveProperty('providedVersion', '1.0.0-beta.1');
      }
    }
  });
});