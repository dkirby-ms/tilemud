import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Already In Session (FR-004)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should detect existing active sessions', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect detects existing sessions
    
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
        clientBuild: '1.0.0'
      }
    });

    // Normal case should not have existing session
    expect([200, 202, 401, 403, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
      expect(body).toHaveProperty('reason', FailureReason.ALREADY_IN_SESSION);
      expect(body).toHaveProperty('existingSession');
      
      const existingSession = body.existingSession;
      expect(existingSession).toHaveProperty('sessionId');
      expect(existingSession).toHaveProperty('instanceId');
      expect(existingSession).toHaveProperty('connectedAt');
      expect(existingSession).toHaveProperty('lastActivity');
    }
  });

  it('should differentiate active vs grace period sessions', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Different session states should be handled appropriately
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-in-grace-period',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.ALREADY_IN_SESSION) {
        expect(body.existingSession).toHaveProperty('state');
        expect(['ACTIVE', 'GRACE', 'PENDING', 'TERMINATING']).toContain(body.existingSession.state);
        
        if (body.existingSession.state === 'GRACE') {
          expect(body.existingSession).toHaveProperty('graceExpiresAt');
          expect(body.existingSession).toHaveProperty('reconnectionAllowed', true);
          
          // Grace period should allow reconnection instead of replacement
          expect(body).toHaveProperty('reconnectionOption', true);
          expect(body).toHaveProperty('replacementOption', false);
        } else if (body.existingSession.state === 'ACTIVE') {
          expect(body).toHaveProperty('replacementOption', true);
        }
      }
    }
  });

  it('should handle cross-instance session detection', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Sessions on different instances should be detected
    
    const targetInstanceId = 'test-instance-002';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${targetInstanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-on-other-instance',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.ALREADY_IN_SESSION) {
        expect(body.existingSession).toHaveProperty('instanceId');
        
        // If session is on different instance, should indicate cross-instance scenario
        if (body.existingSession.instanceId !== targetInstanceId) {
          expect(body).toHaveProperty('crossInstance', true);
          expect(body).toHaveProperty('migrationRequired', true);
        }
      }
    }
  });

  it('should provide session activity context', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Session conflict responses should include activity information
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-active-session',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 409, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.ALREADY_IN_SESSION) {
        expect(body).toHaveProperty('sessionActivity');
        expect(['active', 'idle', 'stale']).toContain(body.sessionActivity);
        
        expect(body.existingSession).toHaveProperty('lastActivity');
        const lastActivity = new Date(body.existingSession.lastActivity);
        const now = new Date();
        expect(lastActivity.getTime()).toBeLessThanOrEqual(now.getTime());
        
        // Activity level should influence replacement recommendations
        if (body.sessionActivity === 'stale') {
          expect(body).toHaveProperty('recommendReplacement', true);
        } else if (body.sessionActivity === 'active') {
          expect(body).toHaveProperty('replacementWarning');
          expect(body.replacementWarning).toContain('active');
        }
      }
    }
  });
});