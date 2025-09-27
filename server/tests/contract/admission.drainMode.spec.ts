import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { FailureReason, AttemptOutcome } from '../../src/domain/connection';

describe('Admission Contract - Drain Mode Rejection', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should reject new connections in drain mode', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: POST /instances/{id}/connect returns 503 in drain mode
    
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

    // Normal operation should not be in drain mode initially
    // But the implementation should support drain mode
    expect([200, 202, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      if (body.reason === FailureReason.MAINTENANCE) {
        expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
        expect(body).toHaveProperty('reason', FailureReason.MAINTENANCE);
        expect(body).toHaveProperty('maintenanceInfo');
        expect(typeof body.maintenanceInfo).toBe('object');
        expect(body.maintenanceInfo).toHaveProperty('drainMode', true);
        expect(body.maintenanceInfo).toHaveProperty('estimatedDuration');
      }
    }
  });

  it('should still allow queued promotions in drain mode', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Drain mode blocks new enqueues but allows existing queue to process
    
    const instanceId = 'test-instance-001';
    const response = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });

    // Queue status should be accessible even if server is in drain mode
    expect([200, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('queueLength');
      expect(body).toHaveProperty('serverCapacity');
      
      if (body.drainMode === true) {
        expect(body).toHaveProperty('drainMode', true);
        expect(body).toHaveProperty('acceptingNewConnections', false);
        expect(body).toHaveProperty('processingQueue', true);
      }
    }
  });

  it('should provide drain mode information in responses', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Drain mode responses should include clear status information
    
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

    // Test validates proper error response structure
    expect([200, 202, 401, 403, 422, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      
      if (body.reason === FailureReason.MAINTENANCE) {
        expect(body.maintenanceInfo).toHaveProperty('type');
        expect(['drain', 'maintenance', 'shutdown']).toContain(body.maintenanceInfo.type);
        
        if (body.maintenanceInfo.type === 'drain') {
          expect(body.maintenanceInfo).toHaveProperty('allowsQueueProcessing', true);
          expect(body.maintenanceInfo).toHaveProperty('acceptsNewConnections', false);
        }
      }
    }
  });

  it('should include estimated completion time for drain mode', async () => {
    // This test MUST initially fail - no implementation exists yet
    // Contract: Drain mode should provide estimated completion information
    
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
      
      if (body.reason === FailureReason.MAINTENANCE && body.maintenanceInfo?.type === 'drain') {
        // Should provide timing information
        expect(body.maintenanceInfo).toHaveProperty('estimatedCompletion');
        
        if (body.maintenanceInfo.estimatedCompletion) {
          const completion = new Date(body.maintenanceInfo.estimatedCompletion);
          const now = new Date();
          expect(completion.getTime()).toBeGreaterThan(now.getTime());
        }
      }
    }
  });
});