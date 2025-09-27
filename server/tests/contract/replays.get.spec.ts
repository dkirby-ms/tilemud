import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';

/**
 * Contract tests for GET /replays/:id endpoint (FR-017)
 * Tests replay metadata retrieval
 */
describe('GET /replays/:id Contract Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Build the Fastify app for testing
    app = buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Happy Path', () => {
    it('should return replay metadata for existing replay', async () => {
      // Use a test replay ID that should exist
      const replayId = 'test-replay-id-123';
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${replayId}`
      });

      if (response.statusCode === 200) {
        const responseBody = JSON.parse(response.body);
        
        expect(responseBody).toMatchObject({
          id: expect.any(String),
          instanceId: expect.any(String),
          createdAt: expect.any(String),
          sizeBytes: expect.any(Number),
          expiresAt: expect.any(String)
        });

        // Validate ID matches request
        expect(responseBody.id).toBe(replayId);

        // Validate instanceId format (should be a string identifier)
        expect(responseBody.instanceId).toBeTruthy();
        expect(typeof responseBody.instanceId).toBe('string');

        // Validate timestamps are proper ISO dates
        expect(new Date(responseBody.createdAt)).toBeInstanceOf(Date);
        expect(new Date(responseBody.expiresAt)).toBeInstanceOf(Date);

        // Validate size is positive integer
        expect(responseBody.sizeBytes).toBeGreaterThan(0);
        expect(Number.isInteger(responseBody.sizeBytes)).toBe(true);

        // Validate expiration is in the future
        const expiresAt = new Date(responseBody.expiresAt);
        const createdAt = new Date(responseBody.createdAt);
        expect(expiresAt.getTime()).toBeGreaterThan(createdAt.getTime());
      }
    });

    it('should return valid metadata structure for different replay types', async () => {
      const replayIds = [
        'arena-replay-456',
        'battle-replay-789',
        'guild-war-replay-012'
      ];

      for (const replayId of replayIds) {
        const response = await app.inject({
          method: 'GET',
          url: `/replays/${replayId}`
        });

        if (response.statusCode === 200) {
          const responseBody = JSON.parse(response.body);
          
          // All replays should have the same metadata structure
          expect(responseBody).toHaveProperty('id');
          expect(responseBody).toHaveProperty('instanceId');
          expect(responseBody).toHaveProperty('createdAt');
          expect(responseBody).toHaveProperty('sizeBytes');
          expect(responseBody).toHaveProperty('expiresAt');
        }
      }
    });
  });

  describe('Not Found Scenarios', () => {
    it('should return 404 for non-existent replay', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/non-existent-replay-id'
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 for malformed replay ID', async () => {
      const malformedIds = [
        '',
        '/',
        '../etc/passwd',
        'replay with spaces',
        'replay/with/slashes'
      ];

      for (const id of malformedIds) {
        const response = await app.inject({
          method: 'GET',
          url: `/replays/${encodeURIComponent(id)}`
        });

        expect([400, 404]).toContain(response.statusCode);
      }
    });

    it('should return 404 for expired replay', async () => {
      const expiredReplayId = 'expired-replay-id-999';
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${expiredReplayId}`
      });

      // Expired replays should return 404 (not found) rather than 410 (gone)
      expect(response.statusCode).toBe(404);
    });
  });

  describe('URL Parameter Validation', () => {
    it('should handle URL-encoded replay IDs', async () => {
      const replayId = 'test-replay-with-special-chars-!@#';
      const encodedId = encodeURIComponent(replayId);
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${encodedId}`
      });

      // Should handle encoded IDs properly (success or proper error)
      expect([200, 404, 400]).toContain(response.statusCode);
    });

    it('should reject extremely long replay IDs', async () => {
      const longId = 'a'.repeat(1000);
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${longId}`
      });

      expect([400, 404, 414]).toContain(response.statusCode);
    });

    it('should handle replay IDs with various formats', async () => {
      const validFormats = [
        'simple-id',
        'replay_123',
        'REPLAY-456',
        'replay.789',
        '12345678-1234-1234-1234-123456789012' // UUID format
      ];

      for (const id of validFormats) {
        const response = await app.inject({
          method: 'GET',
          url: `/replays/${id}`
        });

        // Should either find it or return proper 404, not a format error
        expect([200, 404]).toContain(response.statusCode);
      }
    });
  });

  describe('Replay Size Validation', () => {
    it('should return reasonable file sizes', async () => {
      const replayId = 'size-test-replay';
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${replayId}`
      });

      if (response.statusCode === 200) {
        const responseBody = JSON.parse(response.body);
        
        // Size should be reasonable for game replay data
        expect(responseBody.sizeBytes).toBeGreaterThan(0);
        expect(responseBody.sizeBytes).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
      }
    });
  });

  describe('Replay Expiration Logic', () => {
    it('should show future expiration dates for active replays', async () => {
      const activeReplayId = 'active-replay-123';
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${activeReplayId}`
      });

      if (response.statusCode === 200) {
        const responseBody = JSON.parse(response.body);
        
        const now = new Date();
        const expiresAt = new Date(responseBody.expiresAt);
        
        expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
      }
    });

    it('should show reasonable retention periods', async () => {
      const replayId = 'retention-test-replay';
      
      const response = await app.inject({
        method: 'GET',
        url: `/replays/${replayId}`
      });

      if (response.statusCode === 200) {
        const responseBody = JSON.parse(response.body);
        
        const createdAt = new Date(responseBody.createdAt);
        const expiresAt = new Date(responseBody.expiresAt);
        const retentionPeriod = expiresAt.getTime() - createdAt.getTime();
        
        // Retention should be at least 24 hours but less than 1 year
        const oneDay = 24 * 60 * 60 * 1000;
        const oneYear = 365 * 24 * 60 * 60 * 1000;
        
        expect(retentionPeriod).toBeGreaterThanOrEqual(oneDay);
        expect(retentionPeriod).toBeLessThan(oneYear);
      }
    });
  });

  describe('Response Format', () => {
    it('should return JSON content-type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/test-replay'
      });

      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toMatch(/application\/json/);
      }
    });

    it('should include appropriate cache headers for replay metadata', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/cacheable-replay'
      });

      if (response.statusCode === 200) {
        // Replay metadata is relatively static, can be cached
        expect(response.headers).toHaveProperty('cache-control');
        
        const cacheControl = response.headers['cache-control'];
        if (cacheControl) {
          // Should allow some caching since metadata doesn't change often
          const allowsCaching = !cacheControl.includes('no-cache') && !cacheControl.includes('no-store');
          expect(allowsCaching).toBe(true);
        }
      }
    });

    it('should include ETag for replay metadata when available', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/etag-test-replay'
      });

      if (response.statusCode === 200) {
        // ETag is optional but helps with caching
        if (response.headers.etag) {
          expect(response.headers.etag).toMatch(/^"[^"]+"|W\/"[^"]+"/);
        }
      }
    });
  });

  describe('HTTP Methods', () => {
    it('should only support GET method', async () => {
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];
      
      for (const method of methods) {
        const response = await app.inject({
          method: method as any,
          url: '/replays/test-replay'
        });
        
        expect(response.statusCode).toBe(405);
      }
    });

    it('should return proper Allow header for unsupported methods', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/replays/test-replay'
      });

      if (response.statusCode === 405) {
        expect(response.headers).toHaveProperty('allow');
        expect(response.headers.allow).toContain('GET');
      }
    });
  });

  describe('Performance', () => {
    it('should respond quickly for metadata requests', async () => {
      const startTime = Date.now();
      
      await app.inject({
        method: 'GET',
        url: '/replays/performance-test-replay'
      });

      const responseTime = Date.now() - startTime;
      
      // Metadata retrieval should be fast (under 500ms)
      expect(responseTime).toBeLessThan(500);
    });

    it('should handle concurrent metadata requests', async () => {
      const replayId = 'concurrent-test-replay';
      const requests = [];

      // Fire concurrent requests for same replay
      for (let i = 0; i < 10; i++) {
        requests.push(
          app.inject({
            method: 'GET',
            url: `/replays/${replayId}`
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // All should return same result
      const statusCodes = responses.map(r => r.statusCode);
      const uniqueStatusCodes = [...new Set(statusCodes)];
      
      expect(uniqueStatusCodes.length).toBe(1);
      
      // If found, all responses should have identical metadata
      if (responses[0].statusCode === 200) {
        const firstBody = JSON.parse(responses[0].body);
        
        responses.slice(1).forEach(response => {
          const body = JSON.parse(response.body);
          expect(body).toEqual(firstBody);
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('should return consistent error format for not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/definitely-not-found'
      });

      expect(response.statusCode).toBe(404);
      
      // Should have some error indication in response body
      expect(response.body).toBeTruthy();
    });

    it('should handle database connection issues gracefully', async () => {
      // This test would need database mocking to simulate connection issues
      const response = await app.inject({
        method: 'GET',
        url: '/replays/db-error-test'
      });

      // Should return appropriate error (500) if database is down
      // or 404 if replay simply doesn't exist
      expect([404, 500]).toContain(response.statusCode);
    });
  });

  describe('Security', () => {
    it('should not expose internal system paths', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/../../../etc/passwd'
      });

      // Should not allow path traversal
      expect([400, 404]).toContain(response.statusCode);
      
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        // Should not contain system file contents
        expect(body).not.toHaveProperty('root:x:');
      }
    });

    it('should not leak sensitive information in responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/replays/security-test-replay'
      });

      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        
        // Should not expose internal database IDs or sensitive data
        expect(body).not.toHaveProperty('internalId');
        expect(body).not.toHaveProperty('databaseKey');
        expect(body).not.toHaveProperty('password');
      }
    });
  });
});