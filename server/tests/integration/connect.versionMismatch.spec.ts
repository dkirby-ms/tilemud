import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Version Mismatch Scenario', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should guide user through version upgrade process', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User with outdated client attempts connection, gets upgrade guidance
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-version-test',
        clientBuild: '0.5.0' // Outdated version
      }
    });

    expect(response.statusCode).toBe(400);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('reason', FailureReason.VERSION_MISMATCH);
    expect(body).toHaveProperty('upgradeRequired', true);
    expect(body).toHaveProperty('upgradeUrl');
    expect(body).toHaveProperty('requiredVersion');
  });
});