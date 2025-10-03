import { describe, it, expect } from 'vitest';
import type { CreateCharacterRequest } from '@/types/domain';

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

/**
 * Contract test for POST /api/players/me/characters
 * 
 * This test validates that the API endpoint conforms to the OpenAPI schema
 * defined in character-service.yaml. It should fail initially (TDD) until
 * the API client and MSW handlers are implemented.
 * 
 * Request schema: CreateCharacterRequest
 * - name: string (pattern: ^[A-Z][a-z]+$)
 * - archetypeId: string
 * 
 * Response schema: Character (on 201)
 * Error responses: 400 (validation), 409 (collision/limit), 423 (locked), 503 (outage)
 */

describe('Contract: POST /api/players/me/characters', () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

  const createCharacterPayload = (overrides: Partial<CreateCharacterRequest> = {}): CreateCharacterRequest => ({
    name: 'Gandalf',
    archetypeId: 'wizard-001',
    ...overrides
  });

  it('should return valid Character schema on successful creation (201)', async () => {
    const payload = createCharacterPayload();
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);

  const data: unknown = await response.json();
  const character = asRecord(data);

  const id = expectStringProperty(character, 'id');
  expect(id).toMatch(/^[0-9a-f-]{36}$/i); // UUID format

  const name = expectStringProperty(character, 'name');
  expect(name).toBe(payload.name);
  expect(name).toMatch(/^[A-Z][a-z]+$/); // Name pattern

  const archetypeId = expectStringProperty(character, 'archetypeId');
  expect(archetypeId).toBe(payload.archetypeId);

  const createdAt = expectStringProperty(character, 'createdAt');
  expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/);

  const status = expectStringProperty(character, 'status');
  expect(status).toBe('active');
  });

  it('should return 400 for invalid name pattern', async () => {
    const invalidNames = [
      'gandalf', // lowercase start
      'GANDALF', // all uppercase  
      'Gan-dalf', // hyphen
      'Gan123', // numbers
      'G', // too short
      '', // empty
      '   ', // whitespace only
      'Gandalf the Grey' // spaces
    ];

    for (const invalidName of invalidNames) {
      const payload = createCharacterPayload({ name: invalidName });
      
      const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mock-jwt-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      expect(response.status).toBe(400);
    }
  });

  it('should return 400 for invalid archetype ID', async () => {
    const payload = createCharacterPayload({ archetypeId: 'non-existent-archetype' });
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json',
        'X-Mock-Scenario': 'invalid-archetype'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(400);
  });

  it('should return 400 for missing required fields', async () => {
    const invalidPayloads = [
      {}, // no fields
      { name: 'Gandalf' }, // missing archetypeId
      { archetypeId: 'wizard-001' }, // missing name
      { name: '', archetypeId: 'wizard-001' }, // empty name
      { name: 'Gandalf', archetypeId: '' } // empty archetypeId
    ];

    for (const invalidPayload of invalidPayloads) {
      const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mock-jwt-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(invalidPayload)
      });
      
      expect(response.status).toBe(400);
    }
  });

  it('should return 409 for name collision', async () => {
    const payload = createCharacterPayload({ name: 'Gandalf' });
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json',
        'X-Mock-Scenario': 'name-collision'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(409);
  });

  it('should return 409 when character limit is reached', async () => {
    const payload = createCharacterPayload();
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json',
        'X-Mock-Scenario': 'character-limit-reached'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(409);
  });

  it('should return 423 when character creation is locked', async () => {
    const payload = createCharacterPayload();
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json',
        'X-Mock-Scenario': 'creation-locked'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(423);
  });

  it('should return 503 with OutageNotice on service unavailable', async () => {
    const payload = createCharacterPayload();
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json',
        'X-Mock-Scenario': 'service-unavailable'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(503);
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
  });

  it('should return 401 when authentication is missing', async () => {
    const payload = createCharacterPayload();
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(401);
  });

  it('should handle malformed JSON request body', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json'
      },
      body: '{ invalid json'
    });
    
    expect(response.status).toBe(400);
  });

  it('should require JSON content-type header', async () => {
    const payload = createCharacterPayload();
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        // Missing Content-Type header
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(400);
  });

  it('should validate archetype availability before creation', async () => {
    const payload = createCharacterPayload({ archetypeId: 'unavailable-archetype' });
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'Content-Type': 'application/json',
        'X-Mock-Scenario': 'archetype-unavailable'
      },
      body: JSON.stringify(payload)
    });
    
    expect(response.status).toBe(400);
  });
});