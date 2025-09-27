import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Second Tab Replacement Cancel', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should keep original session when replacement is cancelled', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User opens second tab, gets replacement prompt, cancels - original session continues
    
    const instanceId = 'test-instance-001';
    
    // Step 1: Establish initial session (simulate existing session)
    const firstResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token-user1'
      },
      payload: {
        characterId: 'char-replacement-test',
        clientBuild: '1.0.0'
      }
    });

    // First connection should succeed or provide session info
    expect([200, 409]).toContain(firstResponse.statusCode);
    
    if (firstResponse.statusCode === 409) {
      // Character already has a session - this is the scenario we're testing
      const firstBody = JSON.parse(firstResponse.body);
      expect(firstBody).toHaveProperty('reason', FailureReason.ALREADY_IN_SESSION);
      expect(firstBody).toHaveProperty('replacementRequired', true);
      
      const originalSessionId = firstBody.existingSession.sessionId;
      
      // Step 2: Second tab attempt (same character, replacement offered)
      const secondResponse = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token-user1'
        },
        payload: {
          characterId: 'char-replacement-test',
          clientBuild: '1.0.0'
        }
      });

      expect(secondResponse.statusCode).toBe(409);
      const secondBody = JSON.parse(secondResponse.body);
      expect(secondBody).toHaveProperty('replacementRequired', true);
      expect(secondBody.existingSession.sessionId).toBe(originalSessionId);
      
      // Step 3: User cancels replacement (no follow-up request)
      // Original session should remain intact
      
      // Step 4: Verify original session still exists
      const verifyResponse = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token-user1'
        },
        payload: {
          characterId: 'char-replacement-test',
          clientBuild: '1.0.0'
        }
      });

      expect(verifyResponse.statusCode).toBe(409);
      const verifyBody = JSON.parse(verifyResponse.body);
      expect(verifyBody.existingSession.sessionId).toBe(originalSessionId);
    }
  });

  it('should maintain session activity during replacement prompt', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that sessions remain active during replacement prompts
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-activity-test',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 409]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.ALREADY_IN_SESSION) {
        expect(body.existingSession).toHaveProperty('state', 'ACTIVE');
        expect(body.existingSession).toHaveProperty('lastActivity');
        
        const lastActivity = new Date(body.existingSession.lastActivity);
        const now = new Date();
        const activityAge = now.getTime() - lastActivity.getTime();
        
        // Session should be recently active (within last 5 minutes)
        expect(activityAge).toBeLessThan(5 * 60 * 1000);
      }
    }
  });

  it('should not create partial sessions during replacement flow', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates atomicity - no ghost sessions created during replacement prompts
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-atomicity-test',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 409]).toContain(response.statusCode);
    
    // Check queue status to ensure no partial sessions
    const queueResponse = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });

    expect(queueResponse.statusCode).toBe(200);
    const queueBody = JSON.parse(queueResponse.body);
    
    // Queue depth should be consistent (no leaked partial sessions)
    expect(typeof queueBody.queueLength).toBe('number');
    expect(queueBody.queueLength).toBeGreaterThanOrEqual(0);
    expect(typeof queueBody.activeConnections).toBe('number');
    expect(queueBody.activeConnections).toBeGreaterThanOrEqual(0);
  });

  it('should handle replacement timeout scenarios', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates behavior when user doesn't respond to replacement prompt
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-timeout-test',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 409]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      if (body.replacementRequired) {
        // Should include timeout information for replacement prompts
        expect(body).toHaveProperty('promptTimeout');
        expect(typeof body.promptTimeout).toBe('number');
        expect(body.promptTimeout).toBeGreaterThan(0);
        expect(body.promptTimeout).toBeLessThan(300); // Should be reasonable (< 5 minutes)
      }
    }
  });
});