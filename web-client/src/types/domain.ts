/**
 * Domain model interfaces for TileMUD web client
 * 
 * These interfaces represent the core business entities in the character creation system.
 * They are derived from the OpenAPI specification and provide type safety throughout
 * the application.
 */

/**
 * Represents a character archetype that players can choose from when creating characters.
 * Archetypes define the fundamental class/role of a character (e.g., Warrior, Wizard).
 */
export interface Archetype {
  /** Unique identifier for the archetype */
  id: string;
  
  /** Human-readable name of the archetype */
  name: string;
  
  /** Description of the archetype's characteristics and abilities */
  description: string;
  
  /** Whether this archetype is currently available for character creation */
  isAvailable: boolean;
  
  /** ISO timestamp when this archetype was last updated */
  lastUpdatedAt: string;
}

/**
 * Collection of archetypes available for character creation, with version information.
 */
export interface ArchetypeCatalog {
  /** Version of the archetype catalog for cache invalidation */
  version: string;
  
  /** List of available archetypes */
  archetypes: Archetype[];
}

/**
 * Represents a player's character within the game world.
 */
export interface Character {
  /** Unique identifier for the character */
  id: string;
  
  /** Player-chosen name for the character */
  name: string;
  
  /** ID of the archetype this character is based on */
  archetypeId: string;
  
  /** ISO timestamp when this character was created */
  createdAt: string;
  
  /** Current status of the character */
  status: CharacterStatus;
}

/**
 * Possible states for a character.
 */
export type CharacterStatus = 'active' | 'retired' | 'suspended';

/**
 * Request payload for creating a new character.
 */
export interface CreateCharacterRequest {
  /** Desired name for the new character */
  name: string;
  
  /** ID of the archetype for the new character */
  archetypeId: string;
}

/**
 * Response payload when a character is successfully created.
 */
export interface CreateCharacterResponse {
  /** Unique identifier for the newly created character */
  id: string;
  
  /** Confirmed name of the character */
  name: string;
  
  /** ID of the archetype the character was created with */
  archetypeId: string;
  
  /** ISO timestamp when the character was created */
  createdAt: string;
  
  /** Initial status of the character (typically 'active') */
  status: CharacterStatus;
}

/**
 * Represents a player in the system with their character roster.
 */
export interface Player {
  /** Unique identifier for the player (matches auth system user ID) */
  playerId: string;
  
  /** ID of the character currently selected as active, if any */
  activeCharacterId: string | null;
  
  /** List of all characters owned by this player */
  characters: Character[];
  
  /** Service outage information, if any */
  outage: ServiceOutage | null;
}

/**
 * Represents the health status of a service component.
 */
export interface ServiceHealth {
  /** Name of the service being monitored */
  service: string;
  
  /** Current operational status of the service */
  status: ServiceStatus;
  
  /** Outage information if service is degraded/unavailable */
  outage: ServiceOutage | null;
}

/**
 * Possible operational states for a service.
 */
export type ServiceStatus = 'healthy' | 'degraded' | 'unavailable';

/**
 * Information about a service outage or degradation.
 */
export interface ServiceOutage {
  /** Name of the affected service */
  service: string;
  
  /** User-friendly message explaining the outage impact */
  message: string;
  
  /** 
   * Recommended time to wait before retrying, in seconds.
   * null means retry timing is not specified.
   */
  retryAfterSeconds: number | null;
}

/**
 * Standard error response structure for API failures.
 */
export interface ApiError {
  /** Name of the service that generated the error */
  service: string;
  
  /** Error message describing what went wrong */
  message: string;
  
  /** Suggested retry delay in seconds, if applicable */
  retryAfterSeconds: number | undefined;
}

/**
 * Validation error details for form submissions.
 */
export interface ValidationError {
  /** Field name that failed validation */
  field: string;
  
  /** Error code for programmatic handling */
  code: string;
  
  /** Human-readable error message */
  message: string;
}

/**
 * Response structure when validation fails on character creation.
 */
export interface ValidationErrorResponse extends ApiError {
  /** List of specific validation failures */
  errors: ValidationError[];
}

/**
 * Authentication context information from Azure Entra ID.
 */
export interface AuthUser {
  /** Unique user identifier from the auth provider */
  homeAccountId: string;
  
  /** User's email address */
  username: string;
  
  /** Display name of the user */
  name: string;
}

/**
 * Configuration for Azure MSAL authentication.
 */
export interface AuthConfig {
  /** Azure AD application (client) ID */
  clientId: string;
  
  /** Authority URL for the tenant */
  authority: string;
  
  /** Redirect URI after successful authentication */
  redirectUri: string;
  
  /** Scopes to request during authentication */
  scopes: string[];
}

/**
 * Loading states for async operations throughout the application.
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Generic async operation state container.
 */
export interface AsyncState<T> {
  /** Current loading state */
  state: LoadingState;
  
  /** Data payload when state is 'success' */
  data: T | null;
  
  /** Error information when state is 'error' */
  error: ApiError | null;
  
  /** ISO timestamp of the last update to this state */
  lastUpdated: string | null;
}

/**
 * UI-specific state for form components.
 */
export interface FormState<T> {
  /** Current form values */
  values: T;
  
  /** Field-level validation errors */
  errors: Record<string, string>;
  
  /** Whether the form has been modified */
  isDirty: boolean;
  
  /** Whether the form is currently being submitted */
  isSubmitting: boolean;
  
  /** Whether all required fields are valid */
  isValid: boolean;
}

/**
 * Performance metrics for monitoring constitutional requirements.
 */
export interface PerformanceMetrics {
  /** Time from navigation to first contentful paint (ms) */
  renderTime: number;
  
  /** Total bundle size loaded (bytes) */
  bundleSize: number;
  
  /** Network request count for initial load */
  requestCount: number;
  
  /** Time to interactive (ms) */
  timeToInteractive: number;
}