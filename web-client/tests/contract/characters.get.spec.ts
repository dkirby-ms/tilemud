import { describe, it, expect } from 'vitest';

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

    const data = await response.json();

    // Validate CharacterRosterResponse schema
    expect(data).toHaveProperty('playerId');
    expect(typeof data.playerId).toBe('string');
    expect(data.playerId).toBeTruthy();

    expect(data).toHaveProperty('activeCharacterId');
    if (data.activeCharacterId !== null) {
      expect(typeof data.activeCharacterId).toBe('string');
    }

    expect(data).toHaveProperty('characters');
    expect(Array.isArray(data.characters)).toBe(true);

    // Validate each Character in the roster
    data.characters.forEach((character: any) => {
      // Required properties
      expect(character).toHaveProperty('id');
      expect(typeof character.id).toBe('string');
      // UUID format validation (loose check)
      expect(character.id).toMatch(/^[0-9a-f-]{36}$/i);

      expect(character).toHaveProperty('name');
      expect(typeof character.name).toBe('string');
      // Name pattern: ^[A-Z][a-z]+$
      expect(character.name).toMatch(/^[A-Z][a-z]+$/);

      expect(character).toHaveProperty('archetypeId');
      expect(typeof character.archetypeId).toBe('string');
      expect(character.archetypeId).toBeTruthy();

      expect(character).toHaveProperty('createdAt');
      expect(typeof character.createdAt).toBe('string');
      // ISO 8601 date-time format
      expect(character.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/);

      expect(character).toHaveProperty('status');
      expect(['active', 'retired']).toContain(character.status);
    });

    // Validate optional outage property
    if (data.outage !== undefined && data.outage !== null) {
      expect(data.outage).toHaveProperty('service');
      expect(data.outage.service).toBe('character-service');
      expect(data.outage).toHaveProperty('message');
      expect(typeof data.outage.message).toBe('string');
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

  it('should handle empty character roster', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'empty-roster'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.characters).toEqual([]);
    expect(data.activeCharacterId).toBeNull();
    expect(data.playerId).toBeTruthy();
  });

  it('should handle roster with outage notice payload', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'degraded-service'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    
    // Should include outage notice in successful response
    expect(data).toHaveProperty('outage');
    expect(data.outage).not.toBeNull();
    expect(data.outage.service).toBe('character-service');
    expect(typeof data.outage.message).toBe('string');
  });

  it('should validate activeCharacterId references existing character', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters`, {
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'with-active-character'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    
    if (data.activeCharacterId !== null) {
      // Active character ID should exist in the characters array
      const activeCharacter = data.characters.find(
        (char: any) => char.id === data.activeCharacterId
      );
      expect(activeCharacter).toBeDefined();
      expect(activeCharacter.status).toBe('active');
    }
  });
});