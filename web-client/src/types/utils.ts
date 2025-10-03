/**
 * Type utilities and constants for the TileMUD web client
 * 
 * This module provides TypeScript utilities, type guards, and constants
 * that support the domain models and ensure type safety across the application.
 */

import type {
  Archetype,
  Character,
  CharacterStatus,
  ServiceStatus,
  ServiceHealth,
  ServiceOutage,
  ApiError,
  ValidationError,
  LoadingState,
  AsyncState
} from './domain';

/**
 * API endpoint constants for type-safe URL construction.
 */
export const API_ENDPOINTS = {
  ARCHETYPE_CATALOG: '/api/catalog/archetypes',
  CHARACTER_ROSTER: '/api/players/me/characters',
  CHARACTER_CREATE: '/api/players/me/characters',
  CHARACTER_SELECT: (characterId: string) => `/api/players/me/characters/${characterId}/select`,
  SERVICE_HEALTH: '/api/service-health/character'
} as const;

/**
 * Character status constants for type-safe comparisons.
 */
export const CHARACTER_STATUS = {
  ACTIVE: 'active',
  RETIRED: 'retired',
  SUSPENDED: 'suspended'
} as const satisfies Record<string, CharacterStatus>;

/**
 * Service status constants for type-safe health checks.
 */
export const SERVICE_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable'
} as const satisfies Record<string, ServiceStatus>;

/**
 * Loading state constants for async operations.
 */
export const LOADING_STATE = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
} as const satisfies Record<string, LoadingState>;

/**
 * Performance thresholds from constitutional requirements.
 */
export const PERFORMANCE_THRESHOLDS = {
  /** Maximum acceptable render time (2 seconds) */
  MAX_RENDER_TIME_MS: 2000,
  
  /** Maximum bundle size (200KB) */
  MAX_BUNDLE_SIZE_BYTES: 200 * 1024,
  
  /** Maximum number of API requests on initial load */
  MAX_INITIAL_REQUESTS: 5,
  
  /** Maximum time to interactive */
  MAX_TIME_TO_INTERACTIVE_MS: 3000
} as const;

/**
 * Form validation constants.
 */
export const VALIDATION_RULES = {
  /** Character name constraints */
  CHARACTER_NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 32,
    PATTERN: /^[a-zA-Z0-9\s\-']+$/,
    FORBIDDEN_WORDS: ['admin', 'system', 'null', 'undefined']
  },
  
  /** General validation timeouts */
  DEBOUNCE_MS: 300,
  RETRY_ATTEMPTS: 3
} as const;

/**
 * Type guard to check if a value is a valid CharacterStatus.
 */
export function isCharacterStatus(value: unknown): value is CharacterStatus {
  return typeof value === 'string' && Object.values(CHARACTER_STATUS).includes(value as CharacterStatus);
}

/**
 * Type guard to check if a value is a valid ServiceStatus.
 */
export function isServiceStatus(value: unknown): value is ServiceStatus {
  return typeof value === 'string' && Object.values(SERVICE_STATUS).includes(value as ServiceStatus);
}

/**
 * Type guard to check if a value is a valid LoadingState.
 */
export function isLoadingState(value: unknown): value is LoadingState {
  return typeof value === 'string' && Object.values(LOADING_STATE).includes(value as LoadingState);
}

/**
 * Type guard to check if an object is a valid Archetype.
 */
export function isArchetype(obj: unknown): obj is Archetype {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const archetype = obj as Record<string, unknown>;
  return (
    typeof archetype.id === 'string' &&
    typeof archetype.name === 'string' &&
    typeof archetype.description === 'string' &&
    typeof archetype.isAvailable === 'boolean' &&
    typeof archetype.lastUpdatedAt === 'string'
  );
}

/**
 * Type guard to check if an object is a valid Character.
 */
export function isCharacter(obj: unknown): obj is Character {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const character = obj as Record<string, unknown>;
  return (
    typeof character.id === 'string' &&
    typeof character.name === 'string' &&
    typeof character.archetypeId === 'string' &&
    typeof character.createdAt === 'string' &&
    isCharacterStatus(character.status)
  );
}

/**
 * Type guard to check if an object is a valid ServiceHealth response.
 */
export function isServiceHealth(obj: unknown): obj is ServiceHealth {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const health = obj as Record<string, unknown>;
  return (
    typeof health.service === 'string' &&
    isServiceStatus(health.status) &&
    (health.outage === null || isServiceOutage(health.outage))
  );
}

/**
 * Type guard to check if an object is a valid ServiceOutage.
 */
export function isServiceOutage(obj: unknown): obj is ServiceOutage {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const outage = obj as Record<string, unknown>;
  return (
    typeof outage.service === 'string' &&
    typeof outage.message === 'string' &&
    (outage.retryAfterSeconds === null || typeof outage.retryAfterSeconds === 'number')
  );
}

/**
 * Type guard to check if an object is a valid ApiError.
 */
export function isApiError(obj: unknown): obj is ApiError {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const error = obj as Record<string, unknown>;
  return (
    typeof error.service === 'string' &&
    typeof error.message === 'string' &&
    (error.retryAfterSeconds === undefined || typeof error.retryAfterSeconds === 'number')
  );
}

/**
 * Type guard to check if an object is a valid ValidationError.
 */
export function isValidationError(obj: unknown): obj is ValidationError {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const error = obj as Record<string, unknown>;
  return (
    typeof error.field === 'string' &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

/**
 * Creates an empty AsyncState for initial component state.
 */
export function createAsyncState<T>(): AsyncState<T> {
  return {
    state: LOADING_STATE.IDLE,
    data: null,
    error: null,
    lastUpdated: null
  };
}

/**
 * Creates a loading AsyncState for ongoing operations.
 */
export function createLoadingState<T>(): AsyncState<T> {
  return {
    state: LOADING_STATE.LOADING,
    data: null,
    error: null,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Creates a success AsyncState with data payload.
 */
export function createSuccessState<T>(data: T): AsyncState<T> {
  return {
    state: LOADING_STATE.SUCCESS,
    data,
    error: null,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Creates an error AsyncState with error information.
 */
export function createErrorState<T>(error: ApiError): AsyncState<T> {
  return {
    state: LOADING_STATE.ERROR,
    data: null,
    error,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Utility type for extracting the data type from an AsyncState.
 */
export type AsyncData<T extends AsyncState<unknown>> = T extends AsyncState<infer U> ? U : never;

/**
 * Utility type for creating partial updates to domain objects.
 */
export type PartialUpdate<T> = Partial<Pick<T, keyof T>>;

/**
 * Utility type for required fields during object creation.
 */
export type RequiredCreate<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * Utility type for form field names derived from domain objects.
 */
export type FormFields<T> = {
  [K in keyof T]: T[K] extends string | number | boolean ? K : never;
}[keyof T];

/**
 * HTTP status codes for API error handling.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

/**
 * Azure MSAL error codes for auth error handling.
 */
export const MSAL_ERROR_CODES = {
  INTERACTION_REQUIRED: 'interaction_required',
  LOGIN_REQUIRED: 'login_required',
  CONSENT_REQUIRED: 'consent_required',
  USER_CANCELLED: 'user_cancelled'
} as const;

/**
 * Local storage keys for client-side persistence.
 */
export const STORAGE_KEYS = {
  AUTH_STATE: 'tilemud_auth_state',
  SELECTED_CHARACTER: 'tilemud_selected_character',
  PERFORMANCE_METRICS: 'tilemud_performance_metrics',
  LAST_ROSTER_UPDATE: 'tilemud_last_roster_update'
} as const;