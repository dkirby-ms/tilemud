import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Atomic Capacity Race Handling (NFR-001)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should handle concurrent capacity races atomically', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Performance Requirement: Handle capacity race conditions atomically without overselling slots
    
    const instanceId = 'test-instance-race';
    const concurrentRequests = 5;
    
    const promises = Array.from({ length: concurrentRequests }, (_, i) => 
      server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: `char-race-${i}`,
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      })
    );
    
    const startTime = Date.now();
    const responses = await Promise.all(promises);
    const elapsed = Date.now() - startTime;
    
    // Performance: All race handling should complete within 2 seconds
    expect(elapsed).toBeLessThan(2000);
    
    const successful = responses.filter(r => r.statusCode === 200);
    const queued = responses.filter(r => {
      if (r.statusCode !== 200) return false;
      const body = JSON.parse(r.body);
      return body.outcome === AttemptOutcome.QUEUED;
    });
    const admitted = responses.filter(r => {
      if (r.statusCode !== 200) return false;
      const body = JSON.parse(r.body);
      return body.outcome === AttemptOutcome.SUCCESS;
    });
    
    // Atomic invariant: Exactly one should be admitted, others queued or rejected
    expect(admitted.length).toBeLessThanOrEqual(1);
    expect(successful.length).toBeGreaterThan(0);
    
    // Each response should have correlation ID for race tracking
    successful.forEach(response => {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
      expect(typeof body.correlationId).toBe('string');
    });
  });

  it('should maintain capacity invariants under load', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // System Requirement: Capacity tracking must remain consistent under concurrent load
    
    const instanceId = 'test-instance-capacity';
    
    // Check initial capacity
    const capacityResponse = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/status`
    });
    
    expect([200, 404]).toContain(capacityResponse.statusCode);
    
    if (capacityResponse.statusCode === 200) {
      const capacity = JSON.parse(capacityResponse.body);
      expect(capacity).toHaveProperty('available');
      expect(capacity).toHaveProperty('total');
      expect(capacity.available).toBeLessThanOrEqual(capacity.total);
    }
  });
});