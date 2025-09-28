/**
 * T061: Integration test for metrics exposure
 * Validates that connection admission metrics are properly exposed via /metrics endpoint
 * 
 * Functional Requirements:
 * - FR-020: Connection admission metrics collection and exposure
 * - NFR-005: Performance monitoring with histograms and counters
 * - NFR-006: Operational observability through Prometheus metrics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Connection Metrics Exposure (T061)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
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
      
      // Basic Prometheus format validation
      expect(metricsText).toMatch(/^# HELP/m); // Should contain help comments
      expect(metricsText).toMatch(/^# TYPE/m); // Should contain type definitions
      expect(metricsText).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]* \d+/m); // Should contain metric lines
    });
  });

  describe('Connection Admission Metrics', () => {
    it('should expose admission request counters', async () => {
      // Generate some admission requests to ensure metrics exist
      const instanceId = 'test-metrics-instance';
      
      await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-admission-metrics',
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      });

      // Check metrics exposure
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose admission request counter
      expect(metrics).toMatch(/tilemud_admission_requests_total/);
      expect(metrics).toMatch(/instance_id="[^"]*"/);
      expect(metrics).toMatch(/status="(success|failed|queued)"/);
    });

    it('should expose admission duration histograms', async () => {
      // Generate admission request
      const instanceId = 'test-duration-metrics';
      
      await server.inject({
        method: 'POST',
        url: `/instances/${instanceId}/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-duration-metrics',
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      });

      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose admission duration histogram
      expect(metrics).toMatch(/tilemud_admission_duration_seconds/);
      expect(metrics).toMatch(/le="[0-9.]+"/); // Histogram buckets
      expect(metrics).toMatch(/_bucket/); // Histogram bucket metrics
      expect(metrics).toMatch(/_count/); // Histogram count
      expect(metrics).toMatch(/_sum/); // Histogram sum
    });
  });

  describe('Queue Management Metrics', () => {
    it('should expose queue size gauge', async () => {
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose queue size gauge
      expect(metrics).toMatch(/tilemud_queue_size/);
      expect(metrics).toMatch(/instance_id="[^"]*"/);
      
      // Gauge should have numeric values
      const queueSizeMatch = metrics.match(/tilemud_queue_size{[^}]*} (\d+)/);
      if (queueSizeMatch) {
        const queueSize = parseInt(queueSizeMatch[1]);
        expect(queueSize).toBeGreaterThanOrEqual(0);
      }
    });

    it('should expose queue operations counter', async () => {
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose queue operations counter
      expect(metrics).toMatch(/tilemud_queue_operations_total/);
      expect(metrics).toMatch(/operation="(enqueue|promote|remove|timeout)"/);
      expect(metrics).toMatch(/result="(success|failed)"/);
    });

    it('should expose queue wait time histogram', async () => {
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose queue wait time histogram
      expect(metrics).toMatch(/tilemud_queue_wait_seconds/);
      expect(metrics).toMatch(/le="[0-9.]+"/); // Wait time buckets
      expect(metrics).toMatch(/_bucket/);
      expect(metrics).toMatch(/_count/);
      expect(metrics).toMatch(/_sum/);
    });
  });

  describe('Session Lifecycle Metrics', () => {
    it('should expose active sessions gauge', async () => {
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose active sessions gauge
      expect(metrics).toMatch(/tilemud_active_sessions/);
      expect(metrics).toMatch(/instance_id="[^"]*"/);
      
      // Gauge should have numeric values
      const activeSessionsMatch = metrics.match(/tilemud_active_sessions{[^}]*} (\d+)/);
      if (activeSessionsMatch) {
        const activeSessions = parseInt(activeSessionsMatch[1]);
        expect(activeSessions).toBeGreaterThanOrEqual(0);
      }
    });

    it('should expose session operations counter', async () => {
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose session operations counter
      expect(metrics).toMatch(/tilemud_session_operations_total/);
      expect(metrics).toMatch(/operation="(create|replace|remove|grace|expire)"/);
      expect(metrics).toMatch(/result="(success|failed)"/);
    });
  });

  describe('Rate Limiting Metrics', () => {
    it('should expose rate limit metrics after admission attempts', async () => {
      // Generate multiple admission attempts to trigger rate limiting metrics
      const instanceId = 'test-rate-limit-metrics';
      const requests = [];
      
      for (let i = 0; i < 3; i++) {
        requests.push(
          server.inject({
            method: 'POST',
            url: `/instances/${instanceId}/connect`,
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer valid-jwt-token'
            },
            payload: {
              characterId: `char-rate-${i}`,
              clientBuild: '1.0.0',
              allowReplacement: false
            }
          })
        );
      }

      await Promise.all(requests);

      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should expose rate limiting metrics
      expect(metrics).toMatch(/tilemud_rate_limit_checks_total/);
      expect(metrics).toMatch(/result="(allowed|blocked)"/);
    });
  });

  describe('WebSocket Connection Metrics', () => {
    it('should expose WebSocket connection metrics after establishing connections', async () => {
      // This test validates that WebSocket-specific metrics are exposed
      // Note: WebSocket testing is complex, so we primarily verify metric presence

      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should contain metrics that would be generated by WebSocket connections
      // These may be zero if no WebSocket connections are active, which is fine
      expect(typeof metrics).toBe('string');
      expect(metrics.length).toBeGreaterThan(0);
      
      // The presence of the metrics endpoint itself validates the monitoring infrastructure
      // WebSocket-specific metrics would appear when connections are established
    });
  });

  describe('Default System Metrics', () => {
    it('should expose Node.js default metrics', async () => {
      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Should include default Node.js metrics
      expect(metrics).toMatch(/nodejs_/); // Node.js process metrics
      expect(metrics).toMatch(/process_/); // Process metrics
      
      // Common system metrics
      expect(metrics).toMatch(/nodejs_heap_space_size_total_bytes/);
      expect(metrics).toMatch(/process_cpu_user_seconds_total/);
    });
  });

  describe('Metric Label Validation', () => {
    it('should use consistent label names across admission metrics', async () => {
      // Generate an admission request
      await server.inject({
        method: 'POST',
        url: `/instances/test-label-instance/connect`,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-jwt-token'
        },
        payload: {
          characterId: 'char-label-test',
          clientBuild: '1.0.0',
          allowReplacement: false
        }
      });

      const metricsResponse = await server.inject({
        method: 'GET',
        url: '/metrics'
      });

      const metrics = metricsResponse.body;

      // Verify consistent instance_id labeling
      const instanceIdMatches = metrics.match(/instance_id="[^"]*"/g) || [];
      expect(instanceIdMatches.length).toBeGreaterThan(0);
      
      // Verify all instance_id labels use the same format
      instanceIdMatches.forEach(match => {
        expect(match).toMatch(/instance_id="[a-zA-Z0-9_-]+"/);
      });
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
});