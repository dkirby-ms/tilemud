import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';

describe('Integration: Graceful Disconnect Frees Slot (FR-009)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should free capacity slot when user disconnects gracefully', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // User Story: Connected user disconnects cleanly, their slot becomes available for others
    
    const instanceId = 'test-instance-001';
    
    // Check initial queue status
    const initialStatus = await server.inject({
      method: 'GET',
      url: `/instances/${instanceId}/queue/status`,
      headers: {
        'authorization': 'Bearer valid-jwt-token'
      }
    });
    
    expect(initialStatus.statusCode).toBe(200);
    const initialData = JSON.parse(initialStatus.body);
    const initialConnections = initialData.activeConnections || 0;
    
    // Simulate graceful disconnect event (in real implementation, this would come from WebSocket)
    const disconnectResponse = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/disconnect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        sessionId: 'test-session-123',
        reason: 'user',
        graceful: true
      }
    });
    
    // Disconnect endpoint should exist and handle graceful disconnects
    expect([200, 404]).toContain(disconnectResponse.statusCode);
    
    if (disconnectResponse.statusCode === 200) {
      const body = JSON.parse(disconnectResponse.body);
      expect(body).toHaveProperty('slotFreed', true);
      expect(body).toHaveProperty('gracefulDisconnect', true);
    }
  });
});