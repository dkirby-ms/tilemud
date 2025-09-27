import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Admission Contract - No Active Character Rejection (FR-002)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject connection when no active character selected', async () => {
    // This test MUST initially fail - no implementation exists yet
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-token'
      },
      payload: {
        // characterId missing or null
        clientBuild: 'dev-build'
      }
    });

    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.payload);
    expect(body).toMatchObject({
      outcome: AttemptOutcome.FAILED,
      reason: FailureReason.NO_ACTIVE_CHARACTER
    });
    
    expect(body.sessionId).toBeUndefined();
    expect(body.position).toBeUndefined();
  });

  it('should reject connection with empty characterId', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-token'
      },
      payload: {
        characterId: '',
        clientBuild: 'dev-build'
      }
    });

    const body = JSON.parse(response.payload);
    expect(body.outcome).toBe(AttemptOutcome.FAILED);
    expect(body.reason).toBe(FailureReason.NO_ACTIVE_CHARACTER);
  });

  it('should reject connection with null characterId', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-token'
      },
      payload: {
        characterId: null,
        clientBuild: 'dev-build'
      }
    });

    const body = JSON.parse(response.payload);
    expect(body.outcome).toBe(AttemptOutcome.FAILED);
    expect(body.reason).toBe(FailureReason.NO_ACTIVE_CHARACTER);
  });
});