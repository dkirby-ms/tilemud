/**
 * Character Service API Client
 * 
 * This module provides typed wrapper functions for the Character Service API.
 * It handles HTTP requests, error normalization, authentication, and provides
 * a clean interface for the application to interact with character-related endpoints.
 * 
 * The client is designed to work with both MSW handlers (development/testing)
 * and live API endpoints (production).
 */

import type {
  ArchetypeCatalog,
  CreateCharacterRequest,
  CreateCharacterResponse,
  Player,
  ServiceHealth,
  ServiceOutage,
  ValidationError
} from '../../../types/domain';
import type {
  GetArchetypeCatalogResponse,
  GetCharacterRosterResponse,
  CreateCharacterSuccessResponse,
  SelectCharacterResponse,
  GetServiceHealthResponse,
  CharacterServiceClient,
  RequestConfig
} from '../../../types/api';
import { NetworkErrorClass, BusinessErrorClass, ServiceErrorClass } from '../../../types/errors';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface ValidationErrorPayload {
  message?: string;
  errors: ValidationError[];
}

const isValidationErrorPayload = (value: unknown): value is ValidationErrorPayload =>
  isRecord(value) && Array.isArray(value.errors);

const isServiceOutagePayload = (value: unknown): value is ServiceOutage =>
  isRecord(value) &&
  typeof value.service === 'string' &&
  typeof value.message === 'string' &&
  'retryAfterSeconds' in value &&
  (typeof value.retryAfterSeconds === 'number' || value.retryAfterSeconds === null);

/**
 * Configuration for the API client
 */
export interface ClientConfig {
  /** Base URL for the API */
  baseUrl: string;
  
  /** Default timeout for requests in milliseconds */
  timeout: number;
  
  /** Default retry configuration */
  retry: {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  };
  
  /** Function to get the current auth token */
  getAuthToken?: () => Promise<string | null>;
}

/**
 * Default client configuration
 */
const DEFAULT_CONFIG: ClientConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
  timeout: 30000, // 30 seconds
  retry: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 5000,
    backoffMultiplier: 2
  }
};

/**
 * HTTP client wrapper with error handling and retry logic
 */
class HttpClient {
  private config: ClientConfig;
  
  constructor(config: ClientConfig) {
    this.config = config;
  }

  /**
   * Execute an HTTP request with error handling and retry logic
   */
  async request<T>(config: RequestConfig): Promise<T> {
    const { retry } = this.config;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        const response = await this.executeRequest(config);
        return await this.handleResponse<T>(response);
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (error instanceof BusinessErrorClass || error instanceof ServiceErrorClass) {
          throw error;
        }
        
        // If this is the last attempt, throw the error
        if (attempt === retry.maxAttempts) {
          throw error;
        }
        
        // Calculate delay for next attempt
        const delay = Math.min(
          retry.baseDelay * Math.pow(retry.backoffMultiplier, attempt - 1),
          retry.maxDelay
        );
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Execute the actual HTTP request
   */
  private async executeRequest(config: RequestConfig): Promise<Response> {
    const url = config.url.startsWith('http') ? config.url : `${this.config.baseUrl}${config.url}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers
    };

    // Add auth token if available
    if (this.config.getAuthToken) {
      try {
        const token = await this.config.getAuthToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      } catch (error) {
        // Log auth token error but continue with request
        console.warn('Failed to get auth token:', error);
      }
    }

    const requestInit: RequestInit = {
      method: config.method,
      headers,
      credentials: config.credentials || 'include',
    };

    if (config.body && (config.method === 'POST' || config.method === 'PUT' || config.method === 'PATCH')) {
      requestInit.body = JSON.stringify(config.body);
    }

    try {
      const controller = new AbortController();
      const timeout = config.timeout || this.config.timeout;
      
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        ...requestInit,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new NetworkErrorClass('Request timeout', undefined, true, config.timeout || this.config.timeout);
        }
        if (error.message.includes('Failed to fetch')) {
          throw new NetworkErrorClass('Network request failed', undefined, true);
        }
      }
      throw new NetworkErrorClass('Request failed', undefined, true);
    }
  }

  /**
   * Handle the HTTP response and extract data or throw errors
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    
    // Handle successful responses
    if (response.ok) {
      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }
      
      // Handle JSON responses
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      
      // Handle text responses
      return await response.text() as T;
    }

    // Handle error responses
  let errorData: unknown = null;
    
    if (contentType.includes('application/json')) {
      try {
        errorData = await response.json();
      } catch {
        // Ignore JSON parsing errors for error responses
      }
    }

    // Determine error type based on status and content
    if (response.status === 400 && isValidationErrorPayload(errorData)) {
      // Validation error
      throw new BusinessErrorClass(
        errorData.message || 'Validation failed',
        'validation',
        errorData.errors,
        true
      );
    }

    if (response.status >= 500 && isServiceOutagePayload(errorData)) {
      // Service outage
      throw new ServiceErrorClass(
        errorData.message,
        errorData,
        ['character-creation', 'character-selection']
      );
    }

    // Generic network error
    throw NetworkErrorClass.fromResponse(response);
  }
}

/**
 * Character Service API client implementation
 */
export class CharacterServiceApiClient implements CharacterServiceClient {
  private httpClient: HttpClient;

  constructor(config: Partial<ClientConfig> = {}) {
    this.httpClient = new HttpClient({ ...DEFAULT_CONFIG, ...config });
  }

  /**
   * Get available character archetypes
   */
  async getArchetypeCatalog(): Promise<GetArchetypeCatalogResponse> {
    const data = await this.httpClient.request<ArchetypeCatalog>({
      method: 'GET',
      url: '/api/catalog/archetypes'
    });

    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get current player's character roster
   */
  async getCharacterRoster(): Promise<GetCharacterRosterResponse> {
    const data = await this.httpClient.request<Player>({
      method: 'GET',
      url: '/api/players/me/characters'
    });

    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create a new character
   */
  async createCharacter(request: CreateCharacterRequest): Promise<CreateCharacterSuccessResponse> {
    const data = await this.httpClient.request<CreateCharacterResponse>({
      method: 'POST',
      url: '/api/players/me/characters',
      body: request
    });

    return {
      data,
      status: 201,
      statusText: 'Created',
      headers: {},
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Select an active character
   */
  async selectCharacter(characterId: string): Promise<SelectCharacterResponse> {
    await this.httpClient.request<undefined>({
      method: 'POST',
      url: `/api/players/me/characters/${encodeURIComponent(characterId)}/select`
    });

    return {
      data: null,
      status: 204,
      statusText: 'No Content',
      headers: {},
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check service health status
   */
  async getServiceHealth(): Promise<GetServiceHealthResponse> {
    const data = await this.httpClient.request<ServiceHealth>({
      method: 'GET',
      url: '/api/service-health/character'
    });

    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Default client instance with auth integration
 */
let defaultClientInstance: CharacterServiceApiClient | null = null;

/**
 * Initialize the default client with auth token provider
 */
export const initializeCharacterClient = (getAuthToken: () => Promise<string | null>) => {
  defaultClientInstance = new CharacterServiceApiClient({
    getAuthToken
  });
};

/**
 * Get the default client instance
 */
const getDefaultClient = (): CharacterServiceApiClient => {
  if (!defaultClientInstance) {
    // Create default client without auth if not initialized
    defaultClientInstance = new CharacterServiceApiClient();
  }
  return defaultClientInstance;
};

/**
 * Default client instance (will be configured with auth)
 */
export const characterServiceClient = getDefaultClient();

/**
 * Convenience functions for direct usage
 */

/**
 * Fetch the archetype catalog
 */
export const fetchCatalog = () => getDefaultClient().getArchetypeCatalog();

/**
 * Fetch the current player's character roster
 */
export const fetchRoster = () => getDefaultClient().getCharacterRoster();

/**
 * Create a new character
 */
export const createCharacter = (request: CreateCharacterRequest) => 
  getDefaultClient().createCharacter(request);

/**
 * Select an active character
 */
export const selectCharacter = (characterId: string) => 
  getDefaultClient().selectCharacter(characterId);

/**
 * Get service health status
 */
export const getServiceHealth = () => getDefaultClient().getServiceHealth();