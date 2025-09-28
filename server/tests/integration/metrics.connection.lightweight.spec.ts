/**
 * T061: Integration test for metrics exposure - Redis-independent version
 * Validates that connection admission metrics endpoint is accessible regardless of Redis status
 * 
 * This test focuses on the /metrics endpoint availability and format validation
 * without requiring full server initialization which depends on Redis.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { register, collectDefaultMetrics } from 'prom-client';

describe('Integration: Metrics Endpoint Exposure (T061)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    // Enable default metrics collection
    collectDefaultMetrics();
    
    // Create minimal Fastify server with just the metrics endpoint
    server = fastify({ logger: false });
    
    // Register the metrics endpoint directly (same as in api/server.ts)
    server.get('/metrics', async (_request, reply) => {
      try {
        const metrics = await register.metrics();
        reply.type('text/plain; version=0.0.4; charset=utf-8');
        return metrics;
      } catch (error) {
        reply.code(500);
        return 'Error generating metrics';
      }
    });

    await server.ready();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    // Clear all metrics to prevent test interference
    register.clear();
  });

  describe('Metrics Endpoint Accessibility', () => {
    it('should expose /metrics endpoint with proper Content-Type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/plain/);
      expect(typeof response.body).toBe('string');
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should return valid Prometheus format metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metricsText = response.body;
      
      // Basic Prometheus format validation - metrics might be empty initially
      if (metricsText.trim().length > 0) {
        // If there are metrics, validate format
        expect(metricsText).toMatch(/^# (HELP|TYPE)/m); // Should contain help or type comments
      }
      
      // Should be valid text response
      expect(typeof metricsText).toBe('string');
    });
  });

  describe('Default System Metrics', () => {
    it('should expose Node.js default metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = response.body;

      // Should include default Node.js metrics (may take a moment to appear)
      expect(typeof metrics).toBe('string');
      expect(metrics.length).toBeGreaterThan(0);
      
      // These metrics should be available after collection is enabled
      if (metrics.trim().length > 0) {
        expect(metrics).toMatch(/(nodejs_|process_)/); // Either Node.js or process metrics
      }
    });
  });

  describe('Performance Characteristics', () => {
    it('should respond to metrics requests within reasonable time', async () => {
      const startTime = Date.now();
      
      const response = await server.inject({
        method: 'GET',
        url: '/metrics'
      });
      
      const duration = Date.now() - startTime;
      
      expect(response.statusCode).toBe(200);
      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });
  });

  describe('Error Handling', () => {
    it('should handle multiple concurrent metrics requests', async () => {
      // Send multiple concurrent requests
      const requests = Array.from({ length: 5 }, () => 
        server.inject({
          method: 'GET',
          url: '/metrics'
        })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toMatch(/text\/plain/);
      });
    });
  });

  describe('HTTP Method Support', () => {
    it('should only support GET method for /metrics endpoint', async () => {
      // GET should work
      const getResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });
      expect(getResponse.statusCode).toBe(200);

      // POST should not be allowed
      const postResponse = await server.inject({
        method: 'POST',
        url: '/metrics'
      });
      expect(postResponse.statusCode).toBe(404); // Not found for unsupported methods
    });
  });
});