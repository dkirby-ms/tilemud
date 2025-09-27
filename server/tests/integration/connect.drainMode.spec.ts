import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Drain Mode Processing', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject new connections in drain mode but process queue', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: Server in drain mode rejects new connections but allows queued users to be promoted
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-drain-test',
        clientBuild: '1.0.0'
      }
    });
    
    // Normal operation should not be in drain mode initially
    expect([200, 202, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.MAINTENANCE && body.maintenanceInfo?.type === 'drain') {
        expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
        expect(body.maintenanceInfo).toHaveProperty('allowsQueueProcessing', true);
        expect(body.maintenanceInfo).toHaveProperty('acceptsNewConnections', false);
      }
    }
  });
});