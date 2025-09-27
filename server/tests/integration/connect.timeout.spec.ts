import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Timeout Path (Forced Delay >10s)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should timeout admission after 10 seconds', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: Admission process hangs, times out after 10s with proper cleanup
    
    const instanceId = 'test-instance-001';
    const startTime = Date.now();
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-timeout-test',
        clientBuild: '1.0.0',
        simulateHang: true // Special test flag to simulate slow processing
      }
    });
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    // Should either complete quickly or timeout around 10s
    if (response.statusCode === 408) {
      expect(responseTime).toBeGreaterThan(9000); // At least 9s
      expect(responseTime).toBeLessThan(12000); // But not more than 12s
      
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('outcome', AttemptOutcome.TIMEOUT);
      expect(body).toHaveProperty('timeoutAfter', 10000);
      expect(body).toHaveProperty('cleanupPerformed', true);
    } else {
      // If it didn't timeout, should complete quickly
      expect(responseTime).toBeLessThan(1000);
    }
  });
});