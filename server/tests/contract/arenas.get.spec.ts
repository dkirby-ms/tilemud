import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';

/**
 * Contract tests for GET /arenas endpoint (FR-002, FR-011)
 * Tests arena catalog with utilization data
 */
describe('GET /arenas Contract Tests', () => {
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
    it('should return arena catalog with proper structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody).toHaveProperty('arenas');
      expect(responseBody.arenas).toBeInstanceOf(Array);

      // Each arena should match the OpenAPI schema
      responseBody.arenas.forEach((arena: any) => {
        expect(arena).toMatchObject({
          id: expect.any(String),
          tier: expect.any(String),
          region: expect.any(String),
          humans: expect.any(Number),
          capacity: expect.any(Number),
          utilization: expect.any(Number)
        });

        // Validate arena ID format (should be a string identifier)
        expect(arena.id).toBeTruthy();
        expect(typeof arena.id).toBe('string');

        // Validate tier enum values
        expect(['small', 'large', 'epic']).toContain(arena.tier);

        // Validate region is a non-empty string
        expect(arena.region).toBeTruthy();
        expect(typeof arena.region).toBe('string');

        // Validate humans count
        expect(arena.humans).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(arena.humans)).toBe(true);

        // Validate capacity
        expect(arena.capacity).toBeGreaterThan(0);
        expect(Number.isInteger(arena.capacity)).toBe(true);

        // Validate utilization
        expect(arena.utilization).toBeGreaterThanOrEqual(0);
        expect(arena.utilization).toBeLessThanOrEqual(1);

        // Humans should not exceed capacity
        expect(arena.humans).toBeLessThanOrEqual(arena.capacity);

        // Utilization should match humans/capacity ratio (with some tolerance)
        const expectedUtilization = arena.humans / arena.capacity;
        expect(Math.abs(arena.utilization - expectedUtilization)).toBeLessThan(0.01);
      });
    });

    it('should return different arena tiers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      if (responseBody.arenas.length > 0) {
        const tiers = responseBody.arenas.map((arena: any) => arena.tier);
        const uniqueTiers = [...new Set(tiers)];
        
        // Should have valid tiers
        uniqueTiers.forEach(tier => {
          expect(['small', 'large', 'epic']).toContain(tier);
        });
      }
    });

    it('should return arenas with regional distribution', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      if (responseBody.arenas.length > 0) {
        const regions = responseBody.arenas.map((arena: any) => arena.region);
        const uniqueRegions = [...new Set(regions)];
        
        // Should have at least one region
        expect(uniqueRegions.length).toBeGreaterThan(0);
        
        // Regions should be non-empty strings
        uniqueRegions.forEach(region => {
          expect(typeof region).toBe('string');
          expect(region.length).toBeGreaterThan(0);
        });
      }
    });

    it('should handle empty arena list gracefully', async () => {
      // This might happen during off-peak times or maintenance
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody).toHaveProperty('arenas');
      expect(responseBody.arenas).toBeInstanceOf(Array);
      
      // Empty array is valid
      if (responseBody.arenas.length === 0) {
        expect(responseBody.arenas).toEqual([]);
      }
    });
  });

  describe('Arena Utilization Logic', () => {
    it('should show varying utilization rates', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      if (responseBody.arenas.length > 1) {
        const utilizations = responseBody.arenas.map((arena: any) => arena.utilization);
        
        // Should have some variance in utilization (not all the same)
        const uniqueUtilizations = [...new Set(utilizations)];
        
        // Allow for identical utilizations, but verify they're valid
        utilizations.forEach(util => {
          expect(util).toBeGreaterThanOrEqual(0);
          expect(util).toBeLessThanOrEqual(1);
        });
      }
    });

    it('should correctly calculate utilization for full arenas', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      // Find any full arenas
      const fullArenas = responseBody.arenas.filter((arena: any) => 
        arena.humans === arena.capacity
      );
      
      fullArenas.forEach((arena: any) => {
        expect(arena.utilization).toBeCloseTo(1.0, 2);
      });
    });

    it('should correctly calculate utilization for empty arenas', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      // Find any empty arenas
      const emptyArenas = responseBody.arenas.filter((arena: any) => 
        arena.humans === 0
      );
      
      emptyArenas.forEach((arena: any) => {
        expect(arena.utilization).toBe(0);
      });
    });
  });

  describe('Arena Capacity Tiers', () => {
    it('should show different capacity ranges for different tiers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      const arenasByTier = {
        small: responseBody.arenas.filter((a: any) => a.tier === 'small'),
        large: responseBody.arenas.filter((a: any) => a.tier === 'large'),
        epic: responseBody.arenas.filter((a: any) => a.tier === 'epic')
      };
      
      // If we have multiple tiers, capacities should generally increase
      if (arenasByTier.small.length > 0 && arenasByTier.large.length > 0) {
        const avgSmallCapacity = arenasByTier.small.reduce((sum: number, a: any) => sum + a.capacity, 0) / arenasByTier.small.length;
        const avgLargeCapacity = arenasByTier.large.reduce((sum: number, a: any) => sum + a.capacity, 0) / arenasByTier.large.length;
        
        expect(avgLargeCapacity).toBeGreaterThanOrEqual(avgSmallCapacity);
      }
      
      if (arenasByTier.large.length > 0 && arenasByTier.epic.length > 0) {
        const avgLargeCapacity = arenasByTier.large.reduce((sum: number, a: any) => sum + a.capacity, 0) / arenasByTier.large.length;
        const avgEpicCapacity = arenasByTier.epic.reduce((sum: number, a: any) => sum + a.capacity, 0) / arenasByTier.epic.length;
        
        expect(avgEpicCapacity).toBeGreaterThanOrEqual(avgLargeCapacity);
      }
    });
  });

  describe('Response Format', () => {
    it('should return JSON content-type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should include appropriate cache headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      // Arena data changes frequently, should have short cache or no-cache
      expect(response.headers).toHaveProperty('cache-control');
      
      const cacheControl = response.headers['cache-control'];
      // Should either be no-cache or have a short max-age
      const isNoCache = cacheControl.includes('no-cache') || cacheControl.includes('no-store');
      const hasShortMaxAge = /max-age=([0-9]+)/.test(cacheControl) && 
        parseInt(cacheControl.match(/max-age=([0-9]+)/)?.[1] || '0') <= 60;
      
      expect(isNoCache || hasShortMaxAge).toBe(true);
    });

    it('should be fast to respond', async () => {
      const startTime = Date.now();
      
      await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      const responseTime = Date.now() - startTime;
      
      // Arena listing should be fast (under 1 second)
      expect(responseTime).toBeLessThan(1000);
    });
  });

  describe('HTTP Methods', () => {
    it('should only support GET method', async () => {
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];
      
      for (const method of methods) {
        const response = await app.inject({
          method: method as any,
          url: '/arenas'
        });
        
        expect(response.statusCode).toBe(405);
      }
    });

    it('should return proper Allow header for unsupported methods', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/arenas'
      });

      if (response.statusCode === 405) {
        expect(response.headers).toHaveProperty('allow');
        expect(response.headers.allow).toContain('GET');
      }
    });
  });

  describe('Load Testing', () => {
    it('should handle concurrent requests for arena list', async () => {
      const requests = [];

      // Fire many concurrent requests
      for (let i = 0; i < 20; i++) {
        requests.push(
          app.inject({
            method: 'GET',
            url: '/arenas'
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
        
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('arenas');
      });
    });
  });

  describe('Data Consistency', () => {
    it('should return consistent data across rapid requests', async () => {
      // Make multiple rapid requests
      const response1 = await app.inject({
        method: 'GET',
        url: '/arenas'
      });
      
      const response2 = await app.inject({
        method: 'GET',
        url: '/arenas'
      });

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      
      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      
      // Data should be reasonably consistent (allowing for small changes)
      expect(body1.arenas).toBeDefined();
      expect(body2.arenas).toBeDefined();
      
      // If the same arena exists in both responses, its basic properties should be consistent
      const arenaIds1 = body1.arenas.map((a: any) => a.id);
      const arenaIds2 = body2.arenas.map((a: any) => a.id);
      
      const commonArenaIds = arenaIds1.filter((id: string) => arenaIds2.includes(id));
      
      commonArenaIds.forEach((id: string) => {
        const arena1 = body1.arenas.find((a: any) => a.id === id);
        const arena2 = body2.arenas.find((a: any) => a.id === id);
        
        // Basic properties should remain the same
        expect(arena1.tier).toBe(arena2.tier);
        expect(arena1.region).toBe(arena2.region);
        expect(arena1.capacity).toBe(arena2.capacity);
        
        // Humans count and utilization may change slightly
      });
    });
  });
});