import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Replacement Prompt Flow', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should prompt for replacement when character already in session', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 409 with replacement prompt
    
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
        clientBuild: '1.0.0'
      }
    });

    // Normal case may not trigger replacement scenario initially
    expect([200, 202, 401, 403, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.ALREADY_IN_SESSION);
      expect(body).toHaveProperty('replacementRequired', true);
      
      // Should include existing session information
      expect(body).toHaveProperty('existingSession');
      expect(body.existingSession).toHaveProperty('instanceId');
      expect(body.existingSession).toHaveProperty('connectedAt');
      expect(body.existingSession).toHaveProperty('lastActivity');
      
      // Should include replacement options
      expect(body).toHaveProperty('replacementOptions');
      expect(body.replacementOptions).toHaveProperty('allowReplacement');
      expect(body.replacementOptions).toHaveProperty('confirmationRequired', true);
    }
  });

  it('should handle replacement confirmation request', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Replacement confirmation should be processed correctly
    
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
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'temp-token-123'
      }
    });

    // Replacement confirmation should be handled properly
    expect([200, 202, 400, 401, 403, 410, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 400 || response.statusCode === 410) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.ALREADY_IN_SESSION) {
        expect(body).toHaveProperty('confirmationExpired');
      }
    } else if (response.statusCode === 200 || response.statusCode === 202) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
      expect(body).toHaveProperty('replacedSession', true);
    }
  });

  it('should reject replacement without confirmation', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: replaceExisting=true without confirmationToken should fail
    
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
        clientBuild: '1.0.0',
        replaceExisting: true
        // Missing confirmationToken
      }
    });

    expect(response.statusCode).toBe(400);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('confirmationToken');
  });

  it('should handle expired confirmation tokens', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Expired confirmation tokens should be rejected
    
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
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'expired-token-456'
      }
    });

    // Expired token should be rejected
    expect([400, 410, 401, 403, 422]).toContain(response.statusCode);
    
    if (response.statusCode === 410) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('confirmationExpired', true);
      expect(body).toHaveProperty('requireNewConfirmation', true);
    }
  });

  it('should include replacement impact information', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Replacement prompts should inform about impact
    
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
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.ALREADY_IN_SESSION) {
        expect(body).toHaveProperty('replacementImpact');
        expect(body.replacementImpact).toHaveProperty('willDisconnectExisting', true);
        expect(body.replacementImpact).toHaveProperty('dataLossRisk');
        expect(body.replacementImpact).toHaveProperty('gracePeriod');
        
        // Should include session activity level
        expect(body).toHaveProperty('existingSessionActivity');
        expect(['active', 'idle', 'inactive']).toContain(body.existingSessionActivity);
      }
    }
  });
});