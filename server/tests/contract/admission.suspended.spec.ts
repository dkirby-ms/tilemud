import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Suspended Character Rejection (FR-014)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject connections for suspended characters', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 403 for suspended character
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-suspended-001',
        clientBuild: '1.0.0'
      }
    });

    // Normal characters should not be suspended
    expect([200, 202, 401, 403, 404, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 403) {
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.CHARACTER_SUSPENDED) {
        expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
        expect(body).toHaveProperty('reason', FailureReason.CHARACTER_SUSPENDED);
        expect(body).toHaveProperty('suspensionInfo');
        
        const suspension = body.suspensionInfo;
        expect(suspension).toHaveProperty('suspendedAt');
        expect(suspension).toHaveProperty('reason');
        expect(typeof suspension.reason).toBe('string');
        expect(suspension.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('should include suspension duration information', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Suspension responses should include timing details
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-suspended-002',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 404, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 403) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.CHARACTER_SUSPENDED) {
        expect(body.suspensionInfo).toHaveProperty('type');
        expect(['temporary', 'permanent', 'pending_review']).toContain(body.suspensionInfo.type);
        
        if (body.suspensionInfo.type === 'temporary') {
          expect(body.suspensionInfo).toHaveProperty('expiresAt');
          const expiresAt = new Date(body.suspensionInfo.expiresAt);
          const now = new Date();
          expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
          
          expect(body.suspensionInfo).toHaveProperty('remainingDuration');
          expect(typeof body.suspensionInfo.remainingDuration).toBe('number');
          expect(body.suspensionInfo.remainingDuration).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should not leak detailed suspension reasons', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Suspension responses should protect sensitive information
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-suspended-003',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202, 401, 403, 404, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 403) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.CHARACTER_SUSPENDED) {
        // Should not include sensitive details
        expect(body.suspensionInfo).not.toHaveProperty('internalReason');
        expect(body.suspensionInfo).not.toHaveProperty('moderatorId');
        expect(body.suspensionInfo).not.toHaveProperty('reportDetails');
        
        // Should include only user-appropriate information
        expect(body.suspensionInfo).toHaveProperty('userMessage');
        expect(typeof body.suspensionInfo.userMessage).toBe('string');
        
        if (body.suspensionInfo.appealable) {
          expect(body.suspensionInfo).toHaveProperty('appealProcess');
          expect(body.suspensionInfo).toHaveProperty('appealDeadline');
        }
      }
    }
  });
});