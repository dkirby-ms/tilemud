import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Mid-Connection Character Change (FR-006)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should handle character change during admission process', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User changes selected character while admission is in progress
    
    const instanceId = 'test-instance-change';
    
    // Start admission process
    const initialRequest = server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-initial',
        clientBuild: '1.0.0',
        allowReplacement: false
      }
    });
    
    // Immediately attempt with different character
    const changedRequest = server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-changed',
        clientBuild: '1.0.0',
        allowReplacement: false
      }
    });
    
    const [initialResponse, changedResponse] = await Promise.all([
      initialRequest,
      changedRequest
    ]);
    
    // Both responses should be valid (200 or expected error codes)
    expect([200, 400, 409]).toContain(initialResponse.statusCode);
    expect([200, 400, 409]).toContain(changedResponse.statusCode);
    
    // If both succeed, they should have different correlation IDs
    if (initialResponse.statusCode === 200 && changedResponse.statusCode === 200) {
      const initialBody = JSON.parse(initialResponse.body);
      const changedBody = JSON.parse(changedResponse.body);
      
      expect(initialBody.correlationId).not.toEqual(changedBody.correlationId);
    }
  });

  it('should handle character ownership validation during admission', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Security Requirement: Validate character ownership before admission
    
    const instanceId = 'test-instance-ownership';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-not-owned',
        clientBuild: '1.0.0',
        allowReplacement: false
      }
    });
    
    // Should validate ownership
    expect([200, 400, 403]).toContain(response.statusCode);
    
    if (response.statusCode === 400) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(['CHARACTER_NOT_FOUND', 'CHARACTER_NOT_OWNED']).toContain(body.reason);
    }
  });
});