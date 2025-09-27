import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason, DisconnectReason } from '../../src/domain/connection';

describe('Integration: Replacement Accept Transfers Session', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should transfer session when replacement is accepted', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User opens second tab, confirms replacement, original session terminates, new session starts
    
    const instanceId = 'test-instance-001';
    
    // Step 1: Establish initial session (or detect existing one)
    const firstResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token-user1'
      },
      payload: {
        characterId: 'char-replacement-accept',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 409]).toContain(firstResponse.statusCode);
    
    let originalSessionId: string | undefined;
    if (firstResponse.statusCode === 200) {
      const firstBody = JSON.parse(firstResponse.body);
      originalSessionId = firstBody.sessionId;
    } else if (firstResponse.statusCode === 409) {
      const firstBody = JSON.parse(firstResponse.body);
      expect(firstBody).toHaveProperty('reason', FailureReason.ALREADY_IN_SESSION);
      originalSessionId = firstBody.existingSession.sessionId;
    }
    
    // Step 2: Request replacement with confirmation
    const replacementResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token-user1'
      },
      payload: {
        characterId: 'char-replacement-accept',
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'replacement-confirm-token-123'
      }
    });

    // Replacement should succeed or provide proper confirmation flow
    expect([200, 202, 400, 409]).toContain(replacementResponse.statusCode);
    
    if (replacementResponse.statusCode === 200) {
      const replacementBody = JSON.parse(replacementResponse.body);
      expect(replacementBody).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
      expect(replacementBody).toHaveProperty('sessionId');
      expect(replacementBody).toHaveProperty('replacedSession', true);
      
      // New session should be different from original
      const newSessionId = replacementBody.sessionId;
      if (originalSessionId) {
        expect(newSessionId).not.toBe(originalSessionId);
        
        // Should include information about replaced session
        expect(replacementBody).toHaveProperty('previousSessionId', originalSessionId);
        expect(replacementBody).toHaveProperty('replacementReason', DisconnectReason.REPLACE);
      }
    }
  });

  it('should handle atomic session transfer', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that session transfer is atomic (no gaps or overlaps)
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-atomic-transfer',
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'atomic-transfer-token'
      }
    });

    expect([200, 400, 409, 410]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('transferTime');
      expect(typeof body.transferTime).toBe('number');
      
      // Transfer should be fast (atomic operation)
      expect(body.transferTime).toBeLessThan(100); // Under 100ms
      
      // Should validate no session overlap occurred
      expect(body).toHaveProperty('sessionOverlapDetected', false);
      expect(body).toHaveProperty('atomicTransfer', true);
    }
  });

  it('should notify original session of replacement', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that original session receives proper disconnect notification
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-notification-test',
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'notification-test-token'
      }
    });

    expect([200, 400, 409, 410]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      if (body.replacedSession) {
        expect(body).toHaveProperty('originalSessionNotified', true);
        expect(body).toHaveProperty('disconnectReason', DisconnectReason.REPLACE);
        
        // Should include graceful disconnect timing
        expect(body).toHaveProperty('gracefulDisconnectTime');
        expect(typeof body.gracefulDisconnectTime).toBe('number');
        expect(body.gracefulDisconnectTime).toBeLessThan(5000); // Under 5 seconds
      }
    }
  });

  it('should preserve character state during replacement', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that character data is preserved across session replacement
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-state-preservation',
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'state-preservation-token'
      }
    });

    expect([200, 400, 409, 410]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      if (body.replacedSession) {
        // Should confirm character state preservation
        expect(body).toHaveProperty('characterStatePreserved', true);
        expect(body).toHaveProperty('stateTransferTime');
        expect(typeof body.stateTransferTime).toBe('number');
        
        // Should include character context from previous session
        expect(body).toHaveProperty('characterContext');
        expect(body.characterContext).toHaveProperty('lastPosition');
        expect(body.characterContext).toHaveProperty('sessionContinuity', true);
      }
    }
  });

  it('should update metrics for session replacements', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that replacement events are properly tracked in metrics
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-metrics-test',
        clientBuild: '1.0.0',
        replaceExisting: true,
        confirmationToken: 'metrics-test-token'
      }
    });

    expect([200, 400, 409, 410]).toContain(response.statusCode);
    
    // Check metrics endpoint for replacement tracking
    const metricsResponse = await server.inject({
      method: 'GET',
      url: '/metrics'
    });

    expect(metricsResponse.statusCode).toBe(200);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      if (body.replacedSession) {
        // Metrics should be updated
        expect(body).toHaveProperty('metricsUpdated', true);
        expect(body).toHaveProperty('replacementEventLogged', true);
      }
    }
  });
});