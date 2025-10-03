/**
 * API response types for TileMUD web client
 * 
 * This module defines TypeScript types for all API responses, following the
 * OpenAPI specification and providing type safety for HTTP client operations.
 */

import type {
  ArchetypeCatalog,
  CreateCharacterRequest,
  CreateCharacterResponse,
  Player,
  ServiceHealth,
  ApiError,
  ValidationErrorResponse
} from './domain';

/**
 * Generic API response wrapper that includes metadata
 */
export interface ApiResponse<T> {
  /** The response data payload */
  data: T;
  
  /** HTTP status code */
  status: number;
  
  /** HTTP status text */
  statusText: string;
  
  /** Response headers */
  headers: Record<string, string>;
  
  /** Request timestamp */
  timestamp: string;
}

/**
 * Successful API response for any data type
 */
export type SuccessResponse<T> = ApiResponse<T> & {
  status: 200 | 201 | 204;
};

/**
 * Error API response with error details
 */
export type ErrorResponse = ApiResponse<ApiError> & {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;
};

/**
 * Validation error response for form submission failures
 */
export type ValidationResponse = ApiResponse<ValidationErrorResponse> & {
  status: 422;
};

/**
 * Union type for all possible API responses
 */
export type AnyApiResponse<T> = SuccessResponse<T> | ErrorResponse | ValidationResponse;

/**
 * Specific API response types for each endpoint
 */

/**
 * GET /api/catalog/archetypes
 * Returns the catalog of available character archetypes
 */
export interface GetArchetypeCatalogResponse extends SuccessResponse<ArchetypeCatalog> {
  status: 200;
}

/**
 * GET /api/players/me/characters  
 * Returns the current player's character roster
 */
export interface GetCharacterRosterResponse extends SuccessResponse<Player> {
  status: 200;
}

/**
 * POST /api/players/me/characters
 * Creates a new character for the current player
 */
export interface CreateCharacterSuccessResponse extends SuccessResponse<CreateCharacterResponse> {
  status: 201;
}

/**
 * POST /api/players/me/characters/{characterId}/select
 * Selects a character as the player's active character
 */
export interface SelectCharacterResponse extends ApiResponse<null> {
  status: 204;
  data: null;
}

/**
 * GET /api/service-health/character
 * Returns the health status of the character service
 */
export interface GetServiceHealthResponse extends SuccessResponse<ServiceHealth> {
  status: 200;
}

/**
 * HTTP client request configuration
 */
export interface RequestConfig {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  
  /** Request URL */
  url: string;
  
  /** Request headers */
  headers?: Record<string, string>;
  
  /** Request body for POST/PUT requests */
  body?: unknown;
  
  /** Request timeout in milliseconds */
  timeout?: number;
  
  /** Whether to include credentials */
  credentials?: 'include' | 'omit' | 'same-origin';
  
  /** Custom retry configuration */
  retry?: RetryConfig;
}

/**
 * Retry configuration for failed requests
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  
  /** Base delay between retries in milliseconds */
  baseDelay: number;
  
  /** Maximum delay between retries in milliseconds */
  maxDelay: number;
  
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[];
  
  /** Whether to retry on network errors */
  retryOnNetworkError: boolean;
}

/**
 * HTTP client interface for making API requests
 */
export interface ApiClient {
  /**
   * Make a GET request
   */
  get<T>(url: string, config?: Partial<RequestConfig>): Promise<SuccessResponse<T>>;
  
  /**
   * Make a POST request
   */
  post<TRequest, TResponse>(
    url: string, 
    data: TRequest, 
    config?: Partial<RequestConfig>
  ): Promise<SuccessResponse<TResponse>>;
  
  /**
   * Make a PUT request
   */
  put<TRequest, TResponse>(
    url: string, 
    data: TRequest, 
    config?: Partial<RequestConfig>
  ): Promise<SuccessResponse<TResponse>>;
  
  /**
   * Make a DELETE request
   */
  delete(url: string, config?: Partial<RequestConfig>): Promise<SuccessResponse<null>>;
  
  /**
   * Set default headers for all requests
   */
  setDefaultHeaders(headers: Record<string, string>): void;
  
  /**
   * Set authentication token
   */
  setAuthToken(token: string): void;
  
  /**
   * Clear authentication token
   */
  clearAuthToken(): void;
}

/**
 * Character service API client interface with typed methods
 */
export interface CharacterServiceClient {
  /**
   * Get available character archetypes
   */
  getArchetypeCatalog(): Promise<GetArchetypeCatalogResponse>;
  
  /**
   * Get current player's character roster
   */
  getCharacterRoster(): Promise<GetCharacterRosterResponse>;
  
  /**
   * Create a new character
   */
  createCharacter(request: CreateCharacterRequest): Promise<CreateCharacterSuccessResponse>;
  
  /**
   * Select an active character
   */
  selectCharacter(characterId: string): Promise<SelectCharacterResponse>;
  
  /**
   * Check service health status
   */
  getServiceHealth(): Promise<GetServiceHealthResponse>;
}

/**
 * Request/Response type mapping for each API endpoint
 */
export interface ApiEndpoints {
  'GET /api/catalog/archetypes': {
    request: undefined;
    response: ArchetypeCatalog;
  };
  
  'GET /api/players/me/characters': {
    request: undefined;
    response: Player;
  };
  
  'POST /api/players/me/characters': {
    request: CreateCharacterRequest;
    response: CreateCharacterResponse;
  };
  
  'POST /api/players/me/characters/{characterId}/select': {
    request: undefined;
    response: null;
  };
  
  'GET /api/service-health/character': {
    request: undefined;
    response: ServiceHealth;
  };
}

/**
 * Utility types for extracting request/response types
 */
export type RequestType<T extends keyof ApiEndpoints> = ApiEndpoints[T]['request'];
export type ResponseType<T extends keyof ApiEndpoints> = ApiEndpoints[T]['response'];

/**
 * HTTP status code constants for API responses
 */
export const API_STATUS_CODES = {
  // Success codes
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  
  // Client error codes
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  
  // Server error codes
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryOnNetworkError: true
};

/**
 * Default request timeout in milliseconds
 */
export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Type guards for API responses
 */

/**
 * Check if a response is a successful API response
 */
export function isSuccessResponse<T>(response: ApiResponse<T>): response is SuccessResponse<T> {
  return response.status >= 200 && response.status < 300;
}

/**
 * Check if a response is an error response
 */
export function isErrorResponse(response: ApiResponse<unknown>): response is ErrorResponse {
  return response.status >= 400 && response.status < 600 && response.status !== 422;
}

/**
 * Check if a response is a validation error response
 */
export function isValidationResponse(response: ApiResponse<unknown>): response is ValidationResponse {
  return response.status === 422;
}

/**
 * Check if a response indicates a retryable error
 */
export function isRetryableResponse<T>(response: ApiResponse<T>): boolean {
  return DEFAULT_RETRY_CONFIG.retryableStatusCodes.includes(response.status);
}

/**
 * Extract error message from any API response
 */
export function getErrorMessage(response: ApiResponse<unknown>): string {
  if (isSuccessResponse(response)) {
    return 'No error';
  }
  
  if (isValidationResponse(response)) {
    const errors = response.data.errors;
    return errors.length > 0 
      ? errors.map(e => e.message).join(', ')
      : response.data.message;
  }
  
  if (isErrorResponse(response)) {
    return response.data.message;
  }
  
  return 'Unknown error occurred';
}

/**
 * Extract retry delay from API response headers
 */
export function getRetryDelay(response: ApiResponse<unknown>): number | null {
  const retryAfter = response.headers['retry-after'] || response.headers['Retry-After'];
  
  if (!retryAfter) return null;
  
  // Parse retry-after header (can be seconds or HTTP date)
  const parsed = parseInt(retryAfter, 10);
  return isNaN(parsed) ? null : parsed * 1000; // Convert to milliseconds
}

/**
 * Create a mock API response for testing
 */
export function createMockResponse<T>(
  data: T,
  status: number = 200,
  headers: Record<string, string> = {}
): ApiResponse<T> {
  return {
    data,
    status,
    statusText: getStatusText(status),
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Get standard HTTP status text for a status code
 */
function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    503: 'Service Unavailable'
  };
  
  return statusTexts[status] || 'Unknown Status';
}