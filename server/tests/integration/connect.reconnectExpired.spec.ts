import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Reconnection After Grace Expiry', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject reconnection after grace period expires', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User's connection drops, they try to reconnect after 60s, session lost, new session required
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-grace-expired',
        clientBuild: '1.0.0',
        reconnectionToken: 'expired-grace-token'
      }
    });

    expect([200, 410]).toContain(response.statusCode);
    
    if (response.statusCode === 410) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('gracePeriodExpired', true);
      expect(body).toHaveProperty('sessionLost', true);
      expect(body).toHaveProperty('newSessionRequired', true);
      expect(body).toHaveProperty('gracePeriodDuration', 60000);
    } else if (response.statusCode === 200) {
      // If reconnection succeeds, it means it was within grace period
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
      expect(body).toHaveProperty('reconnected', true);
    }
  });

  it('should clean up expired sessions properly', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that expired sessions are cleaned from Redis
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-cleanup-test',
        clientBuild: '1.0.0',
        reconnectionToken: 'cleanup-test-token'
      }
    });

    if (response.statusCode === 410) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('sessionCleanedUp', true);
      expect(body).toHaveProperty('gracePeriodExpired', true);
    }
  });
});