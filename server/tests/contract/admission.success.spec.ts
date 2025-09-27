import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Success Path', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should admit authenticated user with active character when capacity available', async () => {
    // This test MUST initially fail - no implementation exists yet
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-token' // Mock auth
      },
      payload: {
        characterId: 'char-123e4567-e89b-12d3-a456-426614174000',
        clientBuild: 'dev-build'
      }
    });

    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.payload);
    expect(body).toMatchObject({
      outcome: AttemptOutcome.SUCCESS,
      sessionId: expect.any(String)
    });
    
    // Should not have failure reason or queue position for success
    expect(body.reason).toBeUndefined();
    expect(body.position).toBeUndefined();
  });

  it('should provide reconnection token for successful admission', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-token'
      },
      payload: {
        characterId: 'char-123e4567-e89b-12d3-a456-426614174000',
        clientBuild: 'dev-build'
      }
    });

    const body = JSON.parse(response.payload);
    expect(body.reconnectionToken).toBeDefined();
    expect(typeof body.reconnectionToken).toBe('string');
  });

  it('should complete admission within performance SLA (<1s)', async () => {
    const startTime = Date.now();
    
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-token'
      },
      payload: {
        characterId: 'char-123e4567-e89b-12d3-a456-426614174000',
        clientBuild: 'dev-build'
      }
    });

    const elapsedMs = Date.now() - startTime;
    expect(elapsedMs).toBeLessThan(1000); // <1s SLA for non-queued admission
    expect(response.statusCode).toBe(200);
  });
});