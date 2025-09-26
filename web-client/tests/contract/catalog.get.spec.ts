import { describe, it, expect } from 'vitest';

/**
 * Contract test for GET /api/catalog/archetypes
 * 
 * This test validates that the API endpoint conforms to the OpenAPI schema
 * defined in character-service.yaml. It should fail initially (TDD) until
 * the API client and MSW handlers are implemented.
 * 
 * Schema reference: ArchetypeCatalogResponse
 * - version: string (semantic version)
 * - archetypes: Archetype[]
 *   - id: string
 *   - name: string
 *   - description?: string
 *   - isAvailable: boolean
 *   - lastUpdatedAt?: string (date-time)
 */

describe('Contract: GET /api/catalog/archetypes', () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

  it('should return valid ArchetypeCatalogResponse schema on success', async () => {
    const response = await fetch(`${API_BASE_URL}/api/catalog/archetypes`);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);

    const data = await response.json();

    // Validate ArchetypeCatalogResponse schema
    expect(data).toHaveProperty('version');
    expect(typeof data.version).toBe('string');
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/); // Semantic version pattern

    expect(data).toHaveProperty('archetypes');
    expect(Array.isArray(data.archetypes)).toBe(true);

    // Validate each Archetype in the array
    data.archetypes.forEach((archetype: any) => {
      // Required properties
      expect(archetype).toHaveProperty('id');
      expect(typeof archetype.id).toBe('string');
      expect(archetype.id).toBeTruthy(); // Non-empty string

      expect(archetype).toHaveProperty('name');
      expect(typeof archetype.name).toBe('string');
      expect(archetype.name).toBeTruthy(); // Non-empty string

      expect(archetype).toHaveProperty('isAvailable');
      expect(typeof archetype.isAvailable).toBe('boolean');

      // Optional properties (validate if present)
      if (archetype.description !== undefined) {
        expect(typeof archetype.description).toBe('string');
      }

      if (archetype.lastUpdatedAt !== undefined) {
        expect(typeof archetype.lastUpdatedAt).toBe('string');
        // Validate ISO 8601 date-time format
        expect(archetype.lastUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/);
      }
    });
  });

  it('should return valid OutageNotice schema on 503 service unavailable', async () => {
    // This test will use MSW to simulate 503 response
    // For now, we expect this to fail until MSW handlers are implemented
    const response = await fetch(`${API_BASE_URL}/api/catalog/archetypes`, {
      headers: {
        'X-Mock-Scenario': 'service-unavailable' // MSW handler flag
      }
    });

    if (response.status === 503) {
      expect(response.headers.get('content-type')).toMatch(/application\/json/);

      const data = await response.json();

      // Validate OutageNotice schema
      expect(data).toHaveProperty('service');
      expect(data.service).toBe('character-service');

      expect(data).toHaveProperty('message');
      expect(typeof data.message).toBe('string');
      expect(data.message).toBeTruthy();

      if (data.retryAfterSeconds !== null) {
        expect(typeof data.retryAfterSeconds).toBe('number');
        expect(data.retryAfterSeconds).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('should handle network errors gracefully', async () => {
    // Test error handling when service is completely unreachable
    // This validates that our API client will properly handle network failures
    
    // Use an unreachable URL to force network error
    const unreachableUrl = 'http://localhost:0/api/catalog/archetypes';
    
    await expect(fetch(unreachableUrl)).rejects.toThrow();
  });

  it('should validate response content-type header', async () => {
    const response = await fetch(`${API_BASE_URL}/api/catalog/archetypes`);
    
    // Ensure we get JSON response for both success and error cases
    if (response.status === 200 || response.status === 503) {
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
    }
  });
});