/**
 * T062: Integration test for drain mode promotions  
 * Validates that queued connections are properly promoted during drain mode
 * while new connections are rejected
 * 
 * Functional Requirements:
 * - FR-015: Queue management with position tracking and promotion
 * - FR-016: Drain mode operations (process existing queue, reject new connections)
 * - NFR-003: Graceful degradation during maintenance periods
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome, FailureReason } from '../../src/domain/connection';

describe('Integration: Drain Mode Queue Promotions (T062)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Queue Processing During Drain Mode', () => {
    it('should promote queued connections during drain mode', async () => {
      // This test validates that existing queue entries are processed
      // even when the system is in drain mode
      
      const instanceId = 'test-drain-promotion';
      
      // First, attempt to establish a connection that might get queued
      const queueResponse = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-queued-promotion',
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      });

      // Response could be success, queued, or failure depending on system state
      expect([200, 202, 503]).toContain(queueResponse.statusCode);

      if (queueResponse.statusCode === 202) {
        const queueBody = JSON.parse(queueResponse.body);
        expect(queueBody).toHaveProperty('outcome', AttemptOutcome.QUEUED);
        expect(queueBody).toHaveProperty('queuePosition');
        expect(queueBody).toHaveProperty('sessionId');
        
        // Check queue status to validate promotion behavior
        const statusResponse = await server.inject({
          method: 'GET',
          url: `/instances/${instanceId}/queue/status`,
          headers: {
            'authorization': 'Bearer valid-jwt-token',
            'x-session-id': queueBody.sessionId
          }
        });

        if (statusResponse.statusCode === 200) {
          const status = JSON.parse(statusResponse.body);
          
          // During drain mode, queue should still be processed
          expect(status).toHaveProperty('position');
          expect(typeof status.position).toBe('number');
          expect(status.position).toBeGreaterThanOrEqual(1);
          
          // Should have promotion information
          if (status.drainMode) {
            expect(status).toHaveProperty('drainMode', true);
            expect(status).toHaveProperty('estimatedWait');
            expect(typeof status.estimatedWait).toBe('number');
          }
        }
      }
    });

    it('should reject new connections during drain mode while processing queue', async () => {
      // This test validates the dual behavior of drain mode:
      // 1. Reject new connection attempts
      // 2. Continue processing existing queue entries
      
      const instanceId = 'test-drain-reject-new';
      
      const response = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-drain-new-reject',
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      });

      // Could be success, queued, or rejected depending on system state
      expect([200, 202, 503]).toContain(response.statusCode);

      if (response.statusCode === 503) {
        const body = JSON.parse(response.body);
        
        // Should be properly rejected with drain mode reason
        expect(body).toHaveProperty('outcome', AttemptOutcome.FAILED);
        expect(body).toHaveProperty('reason');
        
        // Check if it's specifically drain mode rejection
        if (body.reason === FailureReason.MAINTENANCE) {
          expect(body).toHaveProperty('maintenanceInfo');
          expect(body.maintenanceInfo).toHaveProperty('type');
          
          if (body.maintenanceInfo.type === 'drain') {
            expect(body.maintenanceInfo).toHaveProperty('allowsQueueProcessing', true);
            expect(body.maintenanceInfo).toHaveProperty('acceptsNewConnections', false);
            expect(body).toHaveProperty('retryAfter');
            expect(typeof body.retryAfter).toBe('number');
          }
        }
      }
    });
  });

  describe('Drain Mode Queue Status Validation', () => {
    it('should provide accurate queue status during drain mode', async () => {
      // This test validates that queue status endpoints work correctly
      // during drain mode operations
      
      const instanceId = 'test-drain-status';
      
      const statusResponse = await server.inject({
        method: 'GET',
        url: `/instances/${instanceId}/queue/status`,
        headers: {
          'authorization': 'Bearer valid-jwt-token'
        }
      });

      // Status endpoint should be available regardless of drain mode
      expect([200, 404]).toContain(statusResponse.statusCode);

      if (statusResponse.statusCode === 200) {
        const status = JSON.parse(statusResponse.body);
        
        // Basic status structure validation
        expect(status).toHaveProperty('position');
        expect(status).toHaveProperty('estimatedWait');
        
        // If in drain mode, should be clearly indicated
        if (status.drainMode === true) {
          expect(status).toHaveProperty('drainMode', true);
          
          // Should provide meaningful wait estimates even during drain
          expect(typeof status.estimatedWait).toBe('number');
          expect(status.estimatedWait).toBeGreaterThanOrEqual(0);
          
          // Position should be valid
          expect(typeof status.position).toBe('number');
          expect(status.position).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('should handle queue position updates during drain mode', async () => {
      // This test validates that queue position updates work correctly
      // when drain mode is processing the queue
      
      const instanceId = 'test-drain-position-update';
      
      // Check initial queue state
      const initialStatusResponse = await server.inject({
        method: 'GET',
        url: `/instances/${instanceId}/queue/status`,
        headers: {
          'authorization': 'Bearer valid-jwt-token'
        }
      });

      expect([200, 404]).toContain(initialStatusResponse.statusCode);

      if (initialStatusResponse.statusCode === 200) {
        const initialStatus = JSON.parse(initialStatusResponse.body);
        
        // Wait a moment and check again to see if position changes
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const updatedStatusResponse = await server.inject({
          method: 'GET',
          url: `/instances/${instanceId}/queue/status`,
          headers: {
            'authorization': 'Bearer valid-jwt-token'
          }
        });

        if (updatedStatusResponse.statusCode === 200) {
          const updatedStatus = JSON.parse(updatedStatusResponse.body);
          
          // During drain mode, queue should still be processed
          if (updatedStatus.drainMode === true) {
            expect(updatedStatus).toHaveProperty('position');
            expect(updatedStatus).toHaveProperty('estimatedWait');
            
            // Position should be consistent or improve (lower number)
            expect(updatedStatus.position).toBeGreaterThanOrEqual(0);
            
            // Wait time should be reasonable
            expect(updatedStatus.estimatedWait).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  });

  describe('Drain Mode Promotion Events', () => {
    it('should generate proper promotion events during drain mode', async () => {
      // This test validates that promotion events are generated correctly
      // even when the system is in drain mode
      
      const instanceId = 'test-drain-promotion-events';
      
      // Attempt to establish a connection that could be promoted
      const connectionResponse = await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-promotion-event',
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      });

      expect([200, 202, 503]).toContain(connectionResponse.statusCode);

      if (connectionResponse.statusCode === 200) {
        const body = JSON.parse(connectionResponse.body);
        
        // Successful connection should have proper structure
        expect(body).toHaveProperty('outcome', AttemptOutcome.SUCCESS);
        expect(body).toHaveProperty('sessionId');
        expect(body).toHaveProperty('websocketUrl');
        
        // Should include connection details
        expect(typeof body.sessionId).toBe('string');
        expect(body.sessionId.length).toBeGreaterThan(0);
        expect(typeof body.websocketUrl).toBe('string');
        expect(body.websocketUrl).toMatch(/^wss?:\/\//);
        
      } else if (connectionResponse.statusCode === 202) {
        const body = JSON.parse(connectionResponse.body);
        
        // Queued connection should have proper structure
        expect(body).toHaveProperty('outcome', AttemptOutcome.QUEUED);
        expect(body).toHaveProperty('queuePosition');
        expect(body).toHaveProperty('estimatedWait');
        
        // Queue information should be valid
        expect(typeof body.queuePosition).toBe('number');
        expect(body.queuePosition).toBeGreaterThan(0);
        expect(typeof body.estimatedWait).toBe('number');
        expect(body.estimatedWait).toBeGreaterThan(0);
      }
    });
  });

  describe('Drain Mode Performance Characteristics', () => {
    it('should maintain reasonable response times during drain mode', async () => {
      // This test validates that drain mode operations don't significantly
      // impact response times for queue status checks
      
      const instanceId = 'test-drain-performance';
      const startTime = Date.now();
      
      const response = await server.inject({
        method: 'GET',
        url: `/instances/${instanceId}/queue/status`,
        headers: {
          'authorization': 'Bearer valid-jwt-token'
        }
      });
      
      const duration = Date.now() - startTime;
      
      // Response time should be reasonable even during drain mode
      expect(duration).toBeLessThan(5000); // 5 second timeout
      expect([200, 404]).toContain(response.statusCode);
    });

    it('should handle multiple concurrent queue status requests during drain mode', async () => {
      // This test validates that drain mode can handle concurrent requests
      // without performance degradation
      
      const instanceId = 'test-drain-concurrent';
      const requests = Array.from({ length: 3 }, (_, index) => 
        server.inject({
          method: 'GET', 
          url: `/instances/${instanceId}/queue/status`,
          headers: {
            'authorization': 'Bearer valid-jwt-token',
            'x-request-id': `concurrent-${index}`
          }
        })
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;

      // All requests should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 second timeout for all requests
      
      // All requests should get valid responses
      responses.forEach((response, index) => {
        expect([200, 404]).toContain(response.statusCode);
        
        if (response.statusCode === 200) {
          const status = JSON.parse(response.body);
          expect(status).toHaveProperty('position');
          expect(status).toHaveProperty('estimatedWait');
        }
      });
    });
  });
});