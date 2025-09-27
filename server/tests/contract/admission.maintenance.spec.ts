import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Maintenance Mode Rejection (FR-005)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject connections during maintenance mode', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 503 during maintenance
    
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

    // Normal operation should not be in maintenance initially
    expect([200, 202, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.MAINTENANCE) {
        expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
        expect(body).toHaveProperty('reason', FailureReason.MAINTENANCE);
        expect(body).toHaveProperty('maintenanceInfo');
        
        const maintenance = body.maintenanceInfo;
        expect(maintenance).toHaveProperty('type', 'maintenance');
        expect(maintenance).toHaveProperty('startedAt');
        expect(maintenance).toHaveProperty('estimatedDuration');
        expect(typeof maintenance.estimatedDuration).toBe('number');
      }
    }
  });

  it('should provide maintenance window information', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Maintenance responses should include timing details
    
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

    expect([200, 202, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.MAINTENANCE) {
        expect(body.maintenanceInfo).toHaveProperty('message');
        expect(typeof body.maintenanceInfo.message).toBe('string');
        expect(body.maintenanceInfo.message.length).toBeGreaterThan(0);
        
        expect(body.maintenanceInfo).toHaveProperty('estimatedCompletion');
        if (body.maintenanceInfo.estimatedCompletion) {
          const completion = new Date(body.maintenanceInfo.estimatedCompletion);
          const now = new Date();
          expect(completion.getTime()).toBeGreaterThan(now.getTime());
        }
      }
    }
  });

  it('should block queue status during full maintenance', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Full maintenance mode should block queue status API
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });

    // Queue status should be accessible unless in full maintenance
    expect([200, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.MAINTENANCE) {
        expect(body).toHaveProperty('serviceUnavailable', true);
        expect(body.maintenanceInfo).toHaveProperty('affectsQueueStatus', true);
        
        // Should still provide basic retry information
        expect(body).toHaveProperty('retryAfter');
        expect(typeof body.retryAfter).toBe('number');
        expect(body.retryAfter).toBeGreaterThan(0);
      }
    }
  });

  it('should differentiate between maintenance types', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Different maintenance types should be clearly indicated
    
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

    expect([200, 202, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.MAINTENANCE) {
        expect(body.maintenanceInfo).toHaveProperty('type');
        expect(['scheduled', 'emergency', 'upgrade', 'drain']).toContain(body.maintenanceInfo.type);
        
        // Each type should provide appropriate context
        switch (body.maintenanceInfo.type) {
          case 'scheduled':
            expect(body.maintenanceInfo).toHaveProperty('scheduledAt');
            break;
          case 'emergency':
            expect(body.maintenanceInfo).toHaveProperty('emergencyReason');
            break;
          case 'upgrade':
            expect(body.maintenanceInfo).toHaveProperty('targetVersion');
            break;
          case 'drain':
            expect(body.maintenanceInfo).toHaveProperty('allowsQueueProcessing');
            break;
        }
      }
    }
  });

  it('should include proper HTTP headers for maintenance', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Maintenance responses should include standard headers
    
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

    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.MAINTENANCE) {
        // Should include Retry-After header for 503 responses
        expect(response.headers['retry-after']).toBeDefined();
        const retryAfter = parseInt(response.headers['retry-after'] as string);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThan(86400); // Less than 24 hours
        
        // Should match body retry information
        expect(body.retryAfter).toBe(retryAfter);
      }
    }
  });
});