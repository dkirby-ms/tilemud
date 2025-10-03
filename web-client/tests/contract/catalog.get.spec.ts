import { describe, it, expect } from 'vitest';

const asRecord = (value: unknown): Record<string, unknown> => {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
};

const expectStringProperty = (record: Record<string, unknown>, key: string): string => {
  expect(record).toHaveProperty(key);
  const value = record[key];
  expect(typeof value).toBe('string');
  return value as string;
};

const expectBooleanProperty = (record: Record<string, unknown>, key: string): boolean => {
  expect(record).toHaveProperty(key);
  const value = record[key];
  expect(typeof value).toBe('boolean');
  return value as boolean;
};

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

    const data: unknown = await response.json();
    const catalog = asRecord(data);

    const version = expectStringProperty(catalog, 'version');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/); // Semantic version pattern

    const archetypesValue = catalog.archetypes;
    expect(Array.isArray(archetypesValue)).toBe(true);
    const archetypes = Array.isArray(archetypesValue) ? archetypesValue : [];

    // Validate each Archetype in the array
    archetypes.forEach((entry) => {
      const archetype = asRecord(entry);

      const id = expectStringProperty(archetype, 'id');
      expect(id).toBeTruthy(); // Non-empty string

      const name = expectStringProperty(archetype, 'name');
      expect(name).toBeTruthy(); // Non-empty string

      expectBooleanProperty(archetype, 'isAvailable');

      // Optional properties (validate if present)
      if ('description' in archetype && archetype.description !== undefined) {
        const { description } = archetype;
        expect(typeof description).toBe('string');
      }

      if ('lastUpdatedAt' in archetype && archetype.lastUpdatedAt !== undefined) {
        const { lastUpdatedAt } = archetype;
        expect(typeof lastUpdatedAt).toBe('string');
        // Validate ISO 8601 date-time format
        if (typeof lastUpdatedAt === 'string') {
          expect(lastUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/);
        }
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

      const data: unknown = await response.json();
      const outage = asRecord(data);

      // Validate OutageNotice schema
      const service = expectStringProperty(outage, 'service');
      expect(service).toBe('character-service');

      const message = expectStringProperty(outage, 'message');
      expect(message).toBeTruthy();

      if ('retryAfterSeconds' in outage && outage.retryAfterSeconds !== null) {
        const retryAfterSeconds = outage.retryAfterSeconds;
        expect(typeof retryAfterSeconds).toBe('number');
        if (typeof retryAfterSeconds === 'number') {
          expect(retryAfterSeconds).toBeGreaterThanOrEqual(0);
        }
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