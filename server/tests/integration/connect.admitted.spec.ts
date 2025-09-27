import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Basic Connect → Admitted', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should admit user to available instance under 1 second', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: User with active character connects to available game instance
    
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
        characterId: 'char-001',
        clientBuild: '1.0.0'
      }
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Performance requirement: Under 1 second for success path
    expect(responseTime).toBeLessThan(1000);
    
    // Should successfully admit when capacity is available
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
    expect(body).toHaveProperty('sessionId');
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);
    
    // Should include WebSocket connection details
    expect(body).toHaveProperty('websocketUrl');
    expect(body).toHaveProperty('reconnectionToken');
    
    // Should include session metadata
    expect(body).toHaveProperty('instanceId', instanceId);
    expect(body).toHaveProperty('characterId', 'char-001');
    expect(body).toHaveProperty('admittedAt');
    expect(typeof body.admittedAt).toBe('number');
  });

  it('should establish session tracking in Redis', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that successful admission creates proper session state
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-002',
        clientBuild: '1.0.0'
      }
    });

    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body);
    const sessionId = body.sessionId;
    
    // Should be able to query session status immediately after admission
    const statusResponse = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    const statusBody = JSON.parse(statusResponse.body);
    expect(statusBody).toHaveProperty('activeConnections');
    expect(statusBody.activeConnections).toBeGreaterThan(0);
  });

  it('should handle concurrent admission requests gracefully', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates system behavior under concurrent load
    
    const instanceId = 'test-instance-001';
    const concurrentRequests = 5;
    
    const requests = Array.from({ length: concurrentRequests }, (_, index) => 
      server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: `char-concurrent-${index}`,
          clientBuild: '1.0.0'
        }
      })
    );

    const responses = await Promise.all(requests);
    
    // All requests should complete successfully (assuming capacity)
    for (const response of responses) {
      expect([200, 202]).toContain(response.statusCode);
      
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
        expect(body).toHaveProperty('sessionId');
      }
    }

    // Should maintain data consistency
    const uniqueSessionIds = new Set(
      responses
        .filter(r => r.statusCode === 200)
        .map(r => JSON.parse(r.body).sessionId)
    );
    
    // All successful responses should have unique session IDs
    expect(uniqueSessionIds.size).toBe(responses.filter(r => r.statusCode === 200).length);
  });

  it('should log admission events for monitoring', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // Validates that proper audit logging occurs
    
    const instanceId = 'test-instance-001';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token',
        'x-correlation-id': 'integration-test-001'
      },
      payload: {
        characterId: 'char-logging-test',
        clientBuild: '1.0.0'
      }
    });

    expect([200, 202]).toContain(response.statusCode);
    
    // Should include correlation ID in response
    expect(response.headers['x-correlation-id']).toBeDefined();
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toBe('integration-test-001');
    }
  });
});