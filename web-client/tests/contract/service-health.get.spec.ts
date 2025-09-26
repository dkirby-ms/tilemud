import { describe, it, expect } from 'vitest';

/**
 * Contract test for GET /api/service-health/character
 * 
 * This test validates that the API endpoint conforms to the OpenAPI schema
 * defined in character-service.yaml. It should fail initially (TDD) until
 * the API client and MSW handlers are implemented.
 * 
 * Schema reference: ServiceHealthResponse
 * - service: 'character-service'
 * - status: 'healthy' | 'degraded' | 'unavailable'
 * - outage?: OutageNotice | null
 * 
 * This endpoint is used for proactive UI banner display.
 */

describe('Contract: GET /api/service-health/character', () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

  it('should return valid ServiceHealthResponse schema on success', async () => {
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);

    const data = await response.json();

    // Validate ServiceHealthResponse schema
    expect(data).toHaveProperty('service');
    expect(data.service).toBe('character-service');

    expect(data).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unavailable']).toContain(data.status);

    // Validate optional outage property
    if (data.outage !== undefined && data.outage !== null) {
      expect(data.outage).toHaveProperty('service');
      expect(data.outage.service).toBe('character-service');

      expect(data.outage).toHaveProperty('message');
      expect(typeof data.outage.message).toBe('string');
      expect(data.outage.message).toBeTruthy();

      if (data.outage.retryAfterSeconds !== null) {
        expect(typeof data.outage.retryAfterSeconds).toBe('number');
        expect(data.outage.retryAfterSeconds).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('should return healthy status under normal conditions', async () => {
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`, {
      headers: {
        'X-Mock-Scenario': 'healthy'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.outage).toBeNull();
  });

  it('should return degraded status with outage notice', async () => {
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`, {
      headers: {
        'X-Mock-Scenario': 'degraded'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe('degraded');
    expect(data.outage).not.toBeNull();
    expect(data.outage.service).toBe('character-service');
    expect(typeof data.outage.message).toBe('string');
  });

  it('should return unavailable status with outage notice', async () => {
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`, {
      headers: {
        'X-Mock-Scenario': 'unavailable'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe('unavailable');
    expect(data.outage).not.toBeNull();
    expect(data.outage.service).toBe('character-service');
    expect(typeof data.outage.message).toBe('string');
  });

  it('should be accessible without authentication', async () => {
    // Health check endpoint should not require authentication
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`);
    
    // Should not return 401 Unauthorized
    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
  });

  it('should include retry-after information for unavailable status', async () => {
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`, {
      headers: {
        'X-Mock-Scenario': 'unavailable-with-retry'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe('unavailable');
    expect(data.outage).not.toBeNull();
    expect(data.outage.retryAfterSeconds).toBeGreaterThan(0);
    expect(typeof data.outage.retryAfterSeconds).toBe('number');
  });

  it('should handle fast response times for UI banner updates', async () => {
    const startTime = Date.now();
    
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`);
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    expect(response.status).toBe(200);
    
    // Health check should respond quickly for real-time UI updates
    // Allow some leeway for network/processing time in tests
    expect(responseTime).toBeLessThan(1000); // 1 second max
  });

  it('should return consistent schema regardless of status', async () => {
    const scenarios = ['healthy', 'degraded', 'unavailable'];
    
    for (const scenario of scenarios) {
      const response = await fetch(`${API_BASE_URL}/api/service-health/character`, {
        headers: {
          'X-Mock-Scenario': scenario
        }
      });
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      
      // All responses should have the same base schema
      expect(data).toHaveProperty('service');
      expect(data.service).toBe('character-service');
      expect(data).toHaveProperty('status');
      expect(['healthy', 'degraded', 'unavailable']).toContain(data.status);
      
      // Outage property should be present (null for healthy, object for others)
      expect(data).toHaveProperty('outage');
    }
  });

  it('should handle concurrent requests without degradation', async () => {
    // Simulate multiple concurrent health checks
    const promises = Array.from({ length: 5 }, () =>
      fetch(`${API_BASE_URL}/api/service-health/character`)
    );
    
    const responses = await Promise.all(promises);
    
    // All requests should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
    });
  });

  it('should validate outage message is user-friendly', async () => {
    const response = await fetch(`${API_BASE_URL}/api/service-health/character`, {
      headers: {
        'X-Mock-Scenario': 'degraded'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    
    if (data.outage && data.outage.message) {
      const message = data.outage.message;
      
      // Message should be user-friendly (not empty, not overly technical)
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThan(500); // Reasonable length
      
      // Should not contain technical stack traces or error codes only
      expect(message).not.toMatch(/stacktrace|error code \d+|500 internal/i);
    }
  });
});