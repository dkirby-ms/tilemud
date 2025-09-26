/**
 * Type definitions index for TileMUD web client
 * 
 * This module provides a single entry point for all TypeScript types,
 * interfaces, and utilities used throughout the application.
 */

// Domain model interfaces
export type {
  Archetype,
  ArchetypeCatalog,
  Character,
  CharacterStatus,
  CreateCharacterRequest,
  CreateCharacterResponse,
  Player,
  ServiceHealth,
  ServiceStatus,
  ServiceOutage,
  ApiError,
  ValidationError,
  ValidationErrorResponse,
  AuthUser,
  AuthConfig,
  LoadingState,
  AsyncState,
  FormState,
  PerformanceMetrics
} from './domain';

// API response types and client interfaces
export type {
  ApiResponse,
  SuccessResponse,
  ErrorResponse,
  ValidationResponse,
  AnyApiResponse,
  GetArchetypeCatalogResponse,
  GetCharacterRosterResponse,
  CreateCharacterSuccessResponse,
  SelectCharacterResponse,
  GetServiceHealthResponse,
  RequestConfig,
  RetryConfig,
  ApiClient,
  CharacterServiceClient,
  ApiEndpoints,
  RequestType,
  ResponseType
} from './api';

export {
  API_STATUS_CODES,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_MS,
  isSuccessResponse,
  isErrorResponse,
  isValidationResponse,
  isRetryableResponse,
  getErrorMessage,
  getRetryDelay,
  createMockResponse
} from './api';

// Error handling types and classes
export type {
  NetworkError,
  AuthError,
  BusinessError,
  ServiceError,
  RuntimeError,
  PerformanceError,
  AppError,
  ErrorSeverity,
  ErrorContext,
  ErrorReport,
  ErrorBoundaryState
} from './errors';

export {
  AppErrorClass,
  NetworkErrorClass,
  AuthErrorClass,
  BusinessErrorClass,
  ServiceErrorClass,
  RuntimeErrorClass,
  PerformanceErrorClass,
  isAppError,
  isRetryableError,
  requiresUserInteraction,
  getErrorSeverity,
  getUserFriendlyMessage,
  getRecoveryActions
} from './errors';

// Type utilities and constants
export {
  API_ENDPOINTS,
  CHARACTER_STATUS,
  SERVICE_STATUS,
  LOADING_STATE,
  PERFORMANCE_THRESHOLDS,
  VALIDATION_RULES,
  HTTP_STATUS,
  MSAL_ERROR_CODES,
  STORAGE_KEYS,
  isCharacterStatus,
  isServiceStatus,
  isLoadingState,
  isArchetype,
  isCharacter,
  isServiceHealth,
  isServiceOutage,
  isApiError,
  isValidationError,
  createAsyncState,
  createLoadingState,
  createSuccessState,
  createErrorState
} from './utils';

// Re-export utility types
export type {
  AsyncData,
  PartialUpdate,
  RequiredCreate,
  FormFields
} from './utils';