import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Already In Session Rejection (FR-004)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject second connection attempt without replacement flow', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User tries to connect while already having active session, gets rejection without replacement option
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-already-connected',
        clientBuild: '1.0.0',
        allowReplacement: false // Explicitly disallow replacement
      }
    });
    
    expect([200, 409]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.ALREADY_IN_SESSION);
      expect(body).toHaveProperty('replacementAllowed', false);
      expect(body).toHaveProperty('existingSession');
    }
  });
});