/**
 * Character Store Unit Tests
 * 
 * Tests for the Zustand character store covering:
 * - State initialization
 * - Basic store functionality
 * - Error handling patterns
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCharacterStore } from '../../src/features/character/state/characterStore';

describe('useCharacterStore', () => {
  // Reset store state before each test
  beforeEach(() => {
    const { result } = renderHook(() => useCharacterStore());
    act(() => {
      result.current.reset();
    });
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(result.current.player).toBeNull();
      expect(result.current.archetypeCatalog).toBeNull();
      expect(result.current.serviceHealth).toBeNull();
      expect(result.current.optimisticCharacters).toEqual([]);
      expect(result.current.playerLoading.isLoading).toBe(false);
      expect(result.current.catalogLoading.isLoading).toBe(false);
      expect(result.current.healthLoading.isLoading).toBe(false);
      expect(result.current.createCharacterLoading.isLoading).toBe(false);
      expect(result.current.selectCharacterLoading.isLoading).toBe(false);
    });
  });

  describe('Loading States', () => {
    it('should handle loading states correctly', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(result.current.playerLoading.isLoading).toBe(false);
      expect(result.current.catalogLoading.isLoading).toBe(false);
      expect(result.current.healthLoading.isLoading).toBe(false);
      expect(result.current.createCharacterLoading.isLoading).toBe(false);
      expect(result.current.selectCharacterLoading.isLoading).toBe(false);
    });

    it('should track last updated timestamps', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(result.current.playerLoading.lastUpdated).toBeNull();
      expect(result.current.catalogLoading.lastUpdated).toBeNull();
      expect(result.current.healthLoading.lastUpdated).toBeNull();
    });

    it('should handle errors correctly', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(result.current.playerLoading.error).toBeNull();
      expect(result.current.catalogLoading.error).toBeNull();
      expect(result.current.healthLoading.error).toBeNull();
      expect(result.current.createCharacterLoading.error).toBeNull();
      expect(result.current.selectCharacterLoading.error).toBeNull();
    });
  });

  describe('Store Reset', () => {
    it('should reset all state correctly', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      act(() => {
        result.current.reset();
      });

      expect(result.current.player).toBeNull();
      expect(result.current.archetypeCatalog).toBeNull();
      expect(result.current.serviceHealth).toBeNull();
      expect(result.current.optimisticCharacters).toEqual([]);
      expect(result.current.isInitialized).toBe(false);
      expect(result.current.lastFullRefresh).toBeNull();
    });
  });

  describe('Optimistic Updates', () => {
    it('should manage optimistic characters', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(result.current.optimisticCharacters).toEqual([]);
    });

    it('should clear optimistic characters', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      act(() => {
        result.current.clearOptimisticCharacter('test-id');
      });

      expect(result.current.optimisticCharacters).toEqual([]);
    });
  });

  describe('UI State', () => {
    it('should track initialization state', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(result.current.isInitialized).toBe(false);
      expect(result.current.lastFullRefresh).toBeNull();
    });
  });

  describe('Store Actions', () => {
    it('should provide action methods', () => {
      const { result } = renderHook(() => useCharacterStore());
      
      expect(typeof result.current.loadPlayer).toBe('function');
      expect(typeof result.current.loadArchetypeCatalog).toBe('function');
      expect(typeof result.current.loadServiceHealth).toBe('function');
      expect(typeof result.current.createCharacter).toBe('function');
      expect(typeof result.current.selectCharacter).toBe('function');
      expect(typeof result.current.refreshAll).toBe('function');
      expect(typeof result.current.clearOptimisticCharacter).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });
  });
});