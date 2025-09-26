import { describe, it, expect } from 'vitest';
import {
  isArchetype,
  isCharacter,
  isServiceHealth,
  isCharacterStatus,
  createAsyncState,
  createSuccessState,
  createErrorState,
  CHARACTER_STATUS,
  SERVICE_STATUS,
  LOADING_STATE,
  API_ENDPOINTS,
  type Archetype,
  type Character,
  type ServiceHealth,
  type AsyncState,
  type ApiError
} from '../../src/types';

/**
 * Unit tests for domain model types and type utilities.
 * 
 * These tests verify that our TypeScript types, type guards, and utility functions
 * work correctly. This ensures type safety across the application.
 */

describe('Domain Types', () => {
  describe('Type Guards', () => {
    it('should correctly identify valid Archetype objects', () => {
      const validArchetype: Archetype = {
        id: 'warrior-001',
        name: 'Warrior',
        description: 'Strong melee fighter',
        isAvailable: true,
        lastUpdatedAt: '2025-01-01T00:00:00Z'
      };

      expect(isArchetype(validArchetype)).toBe(true);
      expect(isArchetype({})).toBe(false);
      expect(isArchetype(null)).toBe(false);
      expect(isArchetype('not an object')).toBe(false);
      expect(isArchetype({ id: 'test', name: 'Test' })).toBe(false); // Missing required fields
    });

    it('should correctly identify valid Character objects', () => {
      const validCharacter: Character = {
        id: 'char-123',
        name: 'TestChar',
        archetypeId: 'warrior-001',
        createdAt: '2025-01-01T00:00:00Z',
        status: 'active'
      };

      expect(isCharacter(validCharacter)).toBe(true);
      expect(isCharacter({})).toBe(false);
      expect(isCharacter({ id: 'test', name: 'Test', status: 'invalid' })).toBe(false);
    });

    it('should correctly identify valid ServiceHealth objects', () => {
      const validServiceHealth: ServiceHealth = {
        service: 'character-service',
        status: 'healthy',
        outage: null
      };

      const degradedServiceHealth: ServiceHealth = {
        service: 'character-service',
        status: 'degraded',
        outage: {
          service: 'character-service',
          message: 'Service is running slowly',
          retryAfterSeconds: 30
        }
      };

      expect(isServiceHealth(validServiceHealth)).toBe(true);
      expect(isServiceHealth(degradedServiceHealth)).toBe(true);
      expect(isServiceHealth({})).toBe(false);
    });

    it('should correctly validate character status values', () => {
      expect(isCharacterStatus('active')).toBe(true);
      expect(isCharacterStatus('retired')).toBe(true);
      expect(isCharacterStatus('suspended')).toBe(true);
      expect(isCharacterStatus('invalid')).toBe(false);
      expect(isCharacterStatus(null)).toBe(false);
      expect(isCharacterStatus(123)).toBe(false);
    });
  });

  describe('AsyncState Utilities', () => {
    it('should create empty async state correctly', () => {
      const state: AsyncState<string> = createAsyncState();
      
      expect(state.state).toBe(LOADING_STATE.IDLE);
      expect(state.data).toBe(null);
      expect(state.error).toBe(null);
      expect(state.lastUpdated).toBe(null);
    });

    it('should create success state with data', () => {
      const testData = { test: 'value' };
      const state = createSuccessState(testData);
      
      expect(state.state).toBe(LOADING_STATE.SUCCESS);
      expect(state.data).toBe(testData);
      expect(state.error).toBe(null);
      expect(state.lastUpdated).toBeTruthy();
    });

    it('should create error state with error info', () => {
      const testError: ApiError = {
        service: 'character-service',
        message: 'Something went wrong',
        retryAfterSeconds: 60
      };
      
      const state = createErrorState(testError);
      
      expect(state.state).toBe(LOADING_STATE.ERROR);
      expect(state.data).toBe(null);
      expect(state.error).toBe(testError);
      expect(state.lastUpdated).toBeTruthy();
    });
  });

  describe('Constants', () => {
    it('should define all required character status constants', () => {
      expect(CHARACTER_STATUS.ACTIVE).toBe('active');
      expect(CHARACTER_STATUS.RETIRED).toBe('retired');
      expect(CHARACTER_STATUS.SUSPENDED).toBe('suspended');
    });

    it('should define all required service status constants', () => {
      expect(SERVICE_STATUS.HEALTHY).toBe('healthy');
      expect(SERVICE_STATUS.DEGRADED).toBe('degraded');
      expect(SERVICE_STATUS.UNAVAILABLE).toBe('unavailable');
    });

    it('should define all required loading state constants', () => {
      expect(LOADING_STATE.IDLE).toBe('idle');
      expect(LOADING_STATE.LOADING).toBe('loading');
      expect(LOADING_STATE.SUCCESS).toBe('success');
      expect(LOADING_STATE.ERROR).toBe('error');
    });

    it('should define all API endpoint constants', () => {
      expect(API_ENDPOINTS.ARCHETYPE_CATALOG).toBe('/api/catalog/archetypes');
      expect(API_ENDPOINTS.CHARACTER_ROSTER).toBe('/api/players/me/characters');
      expect(API_ENDPOINTS.CHARACTER_CREATE).toBe('/api/players/me/characters');
      expect(API_ENDPOINTS.CHARACTER_SELECT('test-id')).toBe('/api/players/me/characters/test-id/select');
      expect(API_ENDPOINTS.SERVICE_HEALTH).toBe('/api/service-health/character');
    });
  });

  describe('Type Safety', () => {
    it('should enforce type constraints on domain objects', () => {
      // This test mainly verifies compile-time type safety
      // If it compiles, the types are working correctly
      
      const archetype: Archetype = {
        id: 'test-id',
        name: 'Test Archetype',
        description: 'A test archetype',
        isAvailable: true,
        lastUpdatedAt: '2025-01-01T00:00:00Z'
      };
      
      const character: Character = {
        id: 'char-id',
        name: 'Test Character',
        archetypeId: archetype.id,
        createdAt: '2025-01-01T00:00:00Z',
        status: CHARACTER_STATUS.ACTIVE
      };
      
      // TypeScript should enforce these relationships
      expect(character.archetypeId).toBe(archetype.id);
      expect(character.status).toBe('active');
    });
  });
});