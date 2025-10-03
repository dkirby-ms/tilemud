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


/**
 * Contract test for GET /api/players/me/characters
 * 
 * This test validates that the API endpoint conforms to the OpenAPI schema
 * defined in character-service.yaml. It should fail initially (TDD) until
 * the API client and MSW handlers are implemented.
 * 
 * Schema reference: CharacterRosterResponse
 * - playerId: string
 * - activeCharacterId: string | null
 * - characters: Character[]
 * - outage?: OutageNotice | null
 * 
 * Character schema:
 * - id: string (uuid format)
 * - name: string (pattern: ^[A-Z][a-z]+$)
 * - archetypeId: string
 * - createdAt: string (date-time format)
 * - status: 'active' | 'retired'
 */

describe('Contract: GET /api/players/me/characters', () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

  it('should return valid CharacterRosterResponse schema on success', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token', // MSW will handle auth
      }
    });
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);

    const data: unknown = await response.json();
    const roster = asRecord(data);

    const playerId = expectStringProperty(roster, 'playerId');
    expect(playerId).toBeTruthy();

    let activeCharacterId: string | null = null;
    if ('activeCharacterId' in roster) {
      const value = roster.activeCharacterId;
      if (value === null) {
        activeCharacterId = null;
      } else {
        expect(typeof value === 'string' || value === undefined).toBe(true);
        if (typeof value === 'string') {
          activeCharacterId = value;
        }
      }
    }

    const charactersValue = roster.characters;
    expect(Array.isArray(charactersValue)).toBe(true);
  const characters = Array.isArray(charactersValue) ? charactersValue : [];
  const characterIds: string[] = [];

    // Validate each Character in the roster
    characters.forEach((entry) => {
      const character = asRecord(entry);

      const id = expectStringProperty(character, 'id');
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  characterIds.push(id);

      const name = expectStringProperty(character, 'name');
      expect(name).toMatch(/^[A-Z][a-z]+$/);

      const archetypeId = expectStringProperty(character, 'archetypeId');
      expect(archetypeId).toBeTruthy();

      const createdAt = expectStringProperty(character, 'createdAt');
      expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/);

      const status = expectStringProperty(character, 'status');
      expect(['active', 'retired']).toContain(status);
    });

    if (activeCharacterId !== null) {
      expect(characterIds).toContain(activeCharacterId);
    }

    // Validate optional outage property
    if ('outage' in roster && roster.outage !== undefined && roster.outage !== null) {
      const outage = asRecord(roster.outage);
      const service = expectStringProperty(outage, 'service');
      expect(service).toBe('character-service');
      const message = expectStringProperty(outage, 'message');
      expect(message).toBeTruthy();
    }
  });

  it('should return 401 when authentication is missing', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`);
    
    // Should fail without authentication
    expect(response.status).toBe(401);
  });

  it('should return valid OutageNotice schema on 503 service unavailable', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'service-unavailable'
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

  it('should handle empty character roster', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'empty-roster'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data: unknown = await response.json();
  const roster = asRecord(data);

  const charactersValue = roster.characters;
  expect(Array.isArray(charactersValue)).toBe(true);
  expect(Array.isArray(charactersValue) ? charactersValue : []).toEqual([]);

  const activeCharacterValue = 'activeCharacterId' in roster ? roster.activeCharacterId : null;
  expect(activeCharacterValue).toBeNull();
    const playerId = expectStringProperty(roster, 'playerId');
    expect(playerId).toBeTruthy();
  });

  it('should handle roster with outage notice payload', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'degraded-service'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data: unknown = await response.json();
    const roster = asRecord(data);

    // Should include outage notice in successful response
    expect(roster).toHaveProperty('outage');
    const outageValue = roster.outage;
    expect(outageValue).not.toBeNull();
    if (outageValue !== null && outageValue !== undefined) {
      const outage = asRecord(outageValue);
      const service = expectStringProperty(outage, 'service');
      expect(service).toBe('character-service');
      const message = expectStringProperty(outage, 'message');
      expect(message).toBeTruthy();
    }
  });

  it('should validate activeCharacterId references existing character', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'with-active-character'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data: unknown = await response.json();
    const roster = asRecord(data);

    const activeValue = 'activeCharacterId' in roster ? roster.activeCharacterId : null;
    if (activeValue !== null && activeValue !== undefined) {
      expect(typeof activeValue === 'string').toBe(true);
      const activeId = typeof activeValue === 'string' ? activeValue : '';

      const charactersValue = roster.characters;
      expect(Array.isArray(charactersValue)).toBe(true);
      const characters = Array.isArray(charactersValue) ? charactersValue : [];

      let activeCharacter: Record<string, unknown> | null = null;
      for (const entry of characters) {
        const character = asRecord(entry);
        const idValue = character.id;
        if (typeof idValue === 'string' && idValue === activeId) {
          activeCharacter = character;
          break;
        }
      }

      expect(activeCharacter).not.toBeNull();
      if (activeCharacter) {
        const status = expectStringProperty(activeCharacter, 'status');
        expect(status).toBe('active');
      }
    }
  });
});