/**
 * Character Store - Zustand State Management
 * 
 * This module manages all character-related state including:
 * - Current player data (roster, active character)
 * - Archetype catalog
 * - Service health and outage status
 * - Loading states and optimistic updates
 * - Error handling and retry logic
 * 
 * Uses Zustand for predictable state management with TypeScript safety.
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type {
  Player,
  Character,
  ArchetypeCatalog,
  CreateCharacterRequest,
  ServiceHealth
} from '../../../types/domain';
import type {
  GetArchetypeCatalogResponse,
  GetCharacterRosterResponse,
  CreateCharacterSuccessResponse,
  GetServiceHealthResponse
} from '../../../types/api';
import { 
  fetchCatalog,
  fetchRoster,
  createCharacter as apiCreateCharacter,
  selectCharacter as apiSelectCharacter,
  getServiceHealth
} from '../api/characterClient';
import { NetworkErrorClass, BusinessErrorClass, ServiceErrorClass } from '../../../types/errors';

/**
 * Loading states for different operations
 */
export interface LoadingState {
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

/**
 * Optimistic update state for character creation
 */
export interface OptimisticCharacter {
  tempId: string;
  name: string;
  archetypeId: string;
  status: 'creating' | 'failed';
  error?: string;
}

/**
 * Complete character store state
 */
export interface CharacterState {
  // Core Data
  player: Player | null;
  archetypeCatalog: ArchetypeCatalog | null;
  serviceHealth: ServiceHealth | null;
  
  // Loading States
  playerLoading: LoadingState;
  catalogLoading: LoadingState;
  healthLoading: LoadingState;
  createCharacterLoading: LoadingState;
  selectCharacterLoading: LoadingState;
  
  // Optimistic Updates
  optimisticCharacters: OptimisticCharacter[];
  
  // UI State
  isInitialized: boolean;
  lastFullRefresh: string | null;
  
  // Actions
  loadPlayer: () => Promise<void>;
  loadArchetypeCatalog: () => Promise<void>;
  loadServiceHealth: () => Promise<void>;
  createCharacter: (request: CreateCharacterRequest) => Promise<Character | null>;
  selectCharacter: (characterId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  clearOptimisticCharacter: (tempId: string) => void;
  clearPlayerError: () => void;
  reset: () => void;
}

/**
 * Initial loading state
 */
const createLoadingState = (): LoadingState => ({
  isLoading: false,
  error: null,
  lastUpdated: null,
});

/**
 * Helper to format error messages
 */
const formatError = (error: unknown): string => {
  if (error instanceof NetworkErrorClass) {
    return 'Network error: ' + error.message;
  } else if (error instanceof BusinessErrorClass) {
    return 'Validation error: ' + error.message;
  } else if (error instanceof ServiceErrorClass) {
    return 'Service unavailable: ' + error.message;
  } else if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
};

/**
 * Generate a temporary ID for optimistic updates
 */
const generateTempId = () => `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Create the character store
 */
export const useCharacterStore = create<CharacterState>()(
  devtools(
    subscribeWithSelector(
      (set, get) => ({
        // Initial State
        player: null,
        archetypeCatalog: null,
        serviceHealth: null,
        
        playerLoading: createLoadingState(),
        catalogLoading: createLoadingState(),
        healthLoading: createLoadingState(),
        createCharacterLoading: createLoadingState(),
        selectCharacterLoading: createLoadingState(),
        
        optimisticCharacters: [],
        
        isInitialized: false,
        lastFullRefresh: null,

        // Actions
        loadPlayer: async () => {
          set((state) => ({
            ...state,
            playerLoading: { ...state.playerLoading, isLoading: true, error: null }
          }));

          try {
            const response: GetCharacterRosterResponse = await fetchRoster();
            set((state) => ({
              ...state,
              player: response.data,
              isInitialized: !state.isInitialized ? true : state.isInitialized,
              playerLoading: {
                isLoading: false,
                error: null,
                lastUpdated: new Date().toISOString()
              }
            }));
          } catch (error) {
            set((state) => ({
              ...state,
              playerLoading: {
                isLoading: false,
                error: formatError(error),
                lastUpdated: state.playerLoading.lastUpdated
              }
            }));
          }
        },

        loadArchetypeCatalog: async () => {
          set((state) => ({
            ...state,
            catalogLoading: { ...state.catalogLoading, isLoading: true, error: null }
          }));

          try {
            const response: GetArchetypeCatalogResponse = await fetchCatalog();
            set((state) => ({
              ...state,
              archetypeCatalog: response.data,
              catalogLoading: {
                isLoading: false,
                error: null,
                lastUpdated: new Date().toISOString()
              }
            }));
          } catch (error) {
            set((state) => ({
              ...state,
              catalogLoading: {
                isLoading: false,
                error: formatError(error),
                lastUpdated: state.catalogLoading.lastUpdated
              }
            }));
          }
        },

        loadServiceHealth: async () => {
          set((state) => ({
            ...state,
            healthLoading: { ...state.healthLoading, isLoading: true, error: null }
          }));

          try {
            const response: GetServiceHealthResponse = await getServiceHealth();
            set((state) => ({
              ...state,
              serviceHealth: response.data,
              healthLoading: {
                isLoading: false,
                error: null,
                lastUpdated: new Date().toISOString()
              }
            }));
          } catch (error) {
            set((state) => ({
              ...state,
              healthLoading: {
                isLoading: false,
                error: formatError(error),
                lastUpdated: state.healthLoading.lastUpdated
              }
            }));
          }
        },

        createCharacter: async (request: CreateCharacterRequest): Promise<Character | null> => {
          // Add optimistic character
          const tempId = generateTempId();
          
          set((state) => ({
            ...state,
            optimisticCharacters: [
              ...state.optimisticCharacters,
              {
                tempId,
                name: request.name,
                archetypeId: request.archetypeId,
                status: 'creating' as const
              }
            ],
            createCharacterLoading: { ...state.createCharacterLoading, isLoading: true, error: null }
          }));

          try {
            const response: CreateCharacterSuccessResponse = await apiCreateCharacter(request);
            
            // Success: add real character and remove optimistic one
            set((state) => ({
              ...state,
              player: state.player ? {
                ...state.player,
                characters: [
                  ...state.player.characters,
                  {
                    id: response.data.id,
                    name: response.data.name,
                    archetypeId: response.data.archetypeId,
                    createdAt: response.data.createdAt,
                    status: response.data.status
                  }
                ]
              } : state.player,
              optimisticCharacters: state.optimisticCharacters.filter((c: OptimisticCharacter) => c.tempId !== tempId),
              createCharacterLoading: {
                isLoading: false,
                error: null,
                lastUpdated: new Date().toISOString()
              }
            }));

            return {
              id: response.data.id,
              name: response.data.name,
              archetypeId: response.data.archetypeId,
              createdAt: response.data.createdAt,
              status: response.data.status
            };
          } catch (error) {
            const errorMessage = formatError(error);
            
            // Failure: mark optimistic character as failed
            set((state) => ({
              ...state,
              optimisticCharacters: state.optimisticCharacters.map((c: OptimisticCharacter) => 
                c.tempId === tempId 
                  ? { ...c, status: 'failed' as const, error: errorMessage }
                  : c
              ),
              createCharacterLoading: {
                isLoading: false,
                error: errorMessage,
                lastUpdated: state.createCharacterLoading.lastUpdated
              }
            }));
            return null;
          }
        },

        selectCharacter: async (characterId: string): Promise<void> => {
          // Optimistic update
          const previousActiveId = get().player?.activeCharacterId || null;
          
          set((state) => ({
            ...state,
            player: state.player ? {
              ...state.player,
              activeCharacterId: characterId
            } : state.player,
            selectCharacterLoading: { ...state.selectCharacterLoading, isLoading: true, error: null }
          }));

          try {
            await apiSelectCharacter(characterId);
            
            set((state) => ({
              ...state,
              selectCharacterLoading: {
                isLoading: false,
                error: null,
                lastUpdated: new Date().toISOString()
              }
            }));
          } catch (error) {
            // Revert optimistic update on failure
            set((state) => ({
              ...state,
              player: state.player ? {
                ...state.player,
                activeCharacterId: previousActiveId
              } : state.player,
              selectCharacterLoading: {
                isLoading: false,
                error: formatError(error),
                lastUpdated: state.selectCharacterLoading.lastUpdated
              }
            }));
          }
        },

        refreshAll: async () => {
          const actions = get();
          
          // Load all data in parallel
          await Promise.allSettled([
            actions.loadPlayer(),
            actions.loadArchetypeCatalog(),
            actions.loadServiceHealth()
          ]);

          set((state) => ({
            ...state,
            lastFullRefresh: new Date().toISOString()
          }));
        },

        clearOptimisticCharacter: (tempId: string) => {
          set((state) => ({
            ...state,
            optimisticCharacters: state.optimisticCharacters.filter((c: OptimisticCharacter) => c.tempId !== tempId)
          }));
        },

        clearPlayerError: () => {
          set((state) => ({
            ...state,
            playerLoading: {
              ...state.playerLoading,
              error: null
            }
          }));
        },

        reset: () => {
          set({
            player: null,
            archetypeCatalog: null,
            serviceHealth: null,
            playerLoading: createLoadingState(),
            catalogLoading: createLoadingState(),
            healthLoading: createLoadingState(),
            createCharacterLoading: createLoadingState(),
            selectCharacterLoading: createLoadingState(),
            optimisticCharacters: [],
            isInitialized: false,
            lastFullRefresh: null,
            // Include all actions to maintain complete state structure
            loadPlayer: get().loadPlayer,
            loadArchetypeCatalog: get().loadArchetypeCatalog,
            loadServiceHealth: get().loadServiceHealth,
            createCharacter: get().createCharacter,
            selectCharacter: get().selectCharacter,
            refreshAll: get().refreshAll,
            clearOptimisticCharacter: get().clearOptimisticCharacter,
            clearPlayerError: get().clearPlayerError,
            reset: get().reset
          });
        }
      })
    ),
    {
      name: 'character-store',
      enabled: import.meta.env.DEV
    }
  )
);

/**
 * Selector hooks for common data access patterns
 */

/**
 * Get the current player data
 */
export const usePlayer = () => useCharacterStore((state) => state.player);

/**
 * Get the current active character
 */
export const useActiveCharacter = () => useCharacterStore((state) => {
  const player = state.player;
  if (!player || !player.activeCharacterId) {
    return null;
  }
  return player.characters.find(c => c.id === player.activeCharacterId) || null;
});

/**
 * Get all characters (real + optimistic)
 */
export const useAllCharacters = () => useCharacterStore((state) => {
  const realCharacters = state.player?.characters || [];
  const optimisticCharacters = state.optimisticCharacters.map(opt => ({
    id: opt.tempId,
    name: opt.name,
    archetypeId: opt.archetypeId,
    createdAt: new Date().toISOString(),
    status: 'active' as const,
    isOptimistic: true,
    optimisticStatus: opt.status,
    optimisticError: opt.error
  }));
  
  return [...realCharacters, ...optimisticCharacters];
});

/**
 * Get available archetypes
 */
export const useArchetypes = () => useCharacterStore((state) => 
  state.archetypeCatalog?.archetypes?.filter(a => a.isAvailable) || []
);

/**
 * Get service health status
 */
export const useServiceHealth = () => useCharacterStore((state) => state.serviceHealth);

/**
 * Get current outage information
 */
export const useOutage = () => useCharacterStore((state) => {
  // Check service health first
  const serviceOutage = state.serviceHealth?.outage;
  if (serviceOutage) {
    return serviceOutage;
  }
  
  // Check player outage
  return state.player?.outage || null;
});

/**
 * Get overall loading state
 */
export const useIsLoading = () => useCharacterStore((state) => 
  state.playerLoading.isLoading || 
  state.catalogLoading.isLoading || 
  state.createCharacterLoading.isLoading ||
  state.selectCharacterLoading.isLoading
);

/**
 * Get any current errors
 */
export const useErrors = () => useCharacterStore((state) => ({
  playerError: state.playerLoading.error,
  catalogError: state.catalogLoading.error,
  healthError: state.healthLoading.error,
  createError: state.createCharacterLoading.error,
  selectError: state.selectCharacterLoading.error,
  hasAnyError: !!(
    state.playerLoading.error ||
    state.catalogLoading.error ||
    state.healthLoading.error ||
    state.createCharacterLoading.error ||
    state.selectCharacterLoading.error
  )
}));

/**
 * Get initialization state
 */
export const useIsInitialized = () => useCharacterStore((state) => state.isInitialized);

/**
 * Hook for character creation status
 */
export const useCharacterCreationStatus = () => useCharacterStore((state) => ({
  isCreating: state.createCharacterLoading.isLoading,
  error: state.createCharacterLoading.error,
  optimisticCharacters: state.optimisticCharacters
}));

/**
 * Hook for character selection status
 */
export const useCharacterSelectionStatus = () => useCharacterStore((state) => ({
  isSelecting: state.selectCharacterLoading.isLoading,
  error: state.selectCharacterLoading.error
}));