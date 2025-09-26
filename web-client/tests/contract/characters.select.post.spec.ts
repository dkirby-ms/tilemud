import { describe, it, expect } from 'vitest';

/**
 * Contract test for POST /api/players/me/characters/{characterId}/select
 * 
 * This test validates that the API endpoint conforms to the OpenAPI schema
 * defined in character-service.yaml. It should fail initially (TDD) until
 * the API client and MSW handlers are implemented.
 * 
 * Path parameter: characterId (string)
 * Responses: 204 (success), 400 (invalid), 404 (not found), 503 (outage)
 */

describe('Contract: POST /api/players/me/characters/{characterId}/select', () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
  
  const validCharacterId = '550e8400-e29b-41d4-a716-446655440000';
  const invalidCharacterId = 'invalid-uuid';
  const notFoundCharacterId = '550e8400-e29b-41d4-a716-446655440001';
  const retiredCharacterId = '550e8400-e29b-41d4-a716-446655440002';

  it('should return 204 on successful character selection', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${validCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token'
      }
    });
    
    expect(response.status).toBe(204);
    
    // 204 No Content should not have response body
    const text = await response.text();
    expect(text).toBe('');
  });

  it('should return 400 for invalid character selection (retired character)', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${retiredCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'retired-character'
      }
    });
    
    expect(response.status).toBe(400);
  });

  it('should return 400 for malformed character ID', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${invalidCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token'
      }
    });
    
    expect(response.status).toBe(400);
  });

  it('should return 400 for unavailable character', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${validCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'character-unavailable'
      }
    });
    
    expect(response.status).toBe(400);
  });

  it('should return 404 for character not found', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${notFoundCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'character-not-found'
      }
    });
    
    expect(response.status).toBe(404);
  });

  it('should return 404 for character belonging to different player', async () => {
    const otherPlayerCharacterId = '550e8400-e29b-41d4-a716-446655440099';
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${otherPlayerCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'not-owned-character'
      }
    });
    
    expect(response.status).toBe(404);
  });

  it('should return 503 with OutageNotice on service unavailable', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${validCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'service-unavailable'
      }
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
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${validCharacterId}/select`, {
      method: 'POST'
    });
    
    expect(response.status).toBe(401);
  });

  it('should handle empty character ID path parameter', async () => {
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters//select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token'
      }
    });
    
    // Should return 404 for malformed URL or 400 for empty parameter
    expect([400, 404]).toContain(response.status);
  });

  it('should handle special characters in character ID', async () => {
    const specialCharacterId = 'character%20with%20spaces';
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${specialCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token'
      }
    });
    
    expect(response.status).toBe(400);
  });

  it('should be idempotent for already selected character', async () => {
    // First selection
    const response1 = await fetch(`${API_BASE_URL}/api/players/me/characters/${validCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token'
      }
    });
    
    expect(response1.status).toBe(204);

    // Second selection of same character should also succeed
    const response2 = await fetch(`${API_BASE_URL}/api/players/me/characters/${validCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token',
        'X-Mock-Scenario': 'already-selected'
      }
    });
    
    expect(response2.status).toBe(204);
  });

  it('should handle extremely long character ID gracefully', async () => {
    const longCharacterId = 'a'.repeat(1000);
    
    const response = await fetch(`${API_BASE_URL}/api/players/me/characters/${longCharacterId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-jwt-token'
      }
    });
    
    expect(response.status).toBe(400);
  });
});