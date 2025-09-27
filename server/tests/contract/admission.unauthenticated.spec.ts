import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Admission Contract - Unauthenticated Rejection (FR-001)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject connection attempt without authentication', async () => {
    // This test MUST initially fail - no implementation exists yet
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json'
        // No authorization header
      },
      payload: {
        characterId: 'char-123e4567-e89b-12d3-a456-426614174000',
        clientBuild: 'dev-build'
      }
    });

    expect(response.statusCode).toBe(200); // Structured response, not HTTP 401
    
    const body = JSON.parse(response.payload);
    expect(body).toMatchObject({
      outcome: AttemptOutcome.FAILED,
      reason: FailureReason.NOT_AUTHENTICATED
    });
    
    expect(body.sessionId).toBeUndefined();
    expect(body.position).toBeUndefined();
    expect(body.reconnectionToken).toBeUndefined();
  });

  it('should reject connection attempt with invalid token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer invalid-token'
      },
      payload: {
        characterId: 'char-223e4567-e89b-12d3-a456-426614174000',
        clientBuild: 'dev-build'
      }
    });

    const body = JSON.parse(response.payload);
    expect(body.outcome).toBe(AttemptOutcome.FAILED);
    expect(body.reason).toBe(FailureReason.NOT_AUTHENTICATED);
  });

  it('should reject connection attempt with malformed authorization header', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/instances/test-instance/connect',
      headers: {
        'content-type': 'application/json',
        'authorization': 'InvalidFormat'
      },
      payload: {
        characterId: 'char-323e4567-e89b-12d3-a456-426614174000',
        clientBuild: 'dev-build'
      }
    });

    const body = JSON.parse(response.payload);
    expect(body.outcome).toBe(AttemptOutcome.FAILED);
    expect(body.reason).toBe(FailureReason.NOT_AUTHENTICATED);
  });
});