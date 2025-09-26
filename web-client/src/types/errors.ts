/**
 * Error handling types and utilities for TileMUD web client
 * 
 * This module provides comprehensive error handling types, error classes, and utilities
 * for managing different types of errors throughout the application.
 */

import type { ApiError, ValidationError, ServiceOutage } from './domain';
import { HTTP_STATUS, MSAL_ERROR_CODES } from './utils';

/**
 * React Error Info interface for error boundaries
 */
interface ErrorInfo {
  componentStack: string;
}

/**
 * Enhanced error types that extend the base ApiError interface
 * with additional context and handling capabilities.
 */

/**
 * Network-related errors (connection issues, timeouts, etc.)
 */
export interface NetworkError extends ApiError {
  readonly type: 'network';
  /** HTTP status code if available */
  statusCode: number | undefined;
  /** Whether this error might be resolved by retrying */
  isRetryable: boolean;
  /** Network request timeout in milliseconds */
  timeout: number | undefined;
}

/**
 * Authentication and authorization errors
 */
export interface AuthError extends ApiError {
  readonly type: 'auth';
  /** MSAL-specific error code */
  errorCode: string;
  /** Whether user interaction is required to resolve this error */
  requiresInteraction: boolean;
  /** Suggested action for the user */
  suggestedAction: 'login' | 'consent' | 'retry' | 'contact_support';
}

/**
 * Business logic validation errors
 */
export interface BusinessError extends ApiError {
  readonly type: 'business';
  /** Specific business rule that was violated */
  rule: string;
  /** Field-specific validation errors */
  validationErrors: ValidationError[];
  /** Whether the user can fix this error */
  isUserFixable: boolean;
}

/**
 * Service outage and availability errors
 */
export interface ServiceError extends ApiError {
  readonly type: 'service';
  /** Detailed outage information */
  outage: ServiceOutage;
  /** Affected functionality */
  affectedFeatures: string[];
  /** Estimated resolution time */
  estimatedResolution: string | undefined;
}

/**
 * Client-side runtime errors
 */
export interface RuntimeError extends ApiError {
  readonly type: 'runtime';
  /** JavaScript error details */
  originalError: Error;
  /** Component or module where the error occurred */
  component: string | undefined;
  /** User action that triggered the error */
  userAction: string | undefined;
  /** Whether the error was caught and handled gracefully */
  wasHandled: boolean;
}

/**
 * Performance-related errors (slow loading, bundle too large, etc.)
 */
export interface PerformanceError extends ApiError {
  readonly type: 'performance';
  /** Specific performance metric that was violated */
  metric: 'render_time' | 'bundle_size' | 'request_count' | 'time_to_interactive';
  /** Actual value that exceeded the threshold */
  actualValue: number;
  /** Expected threshold that was exceeded */
  threshold: number;
  /** Unit of measurement (ms, bytes, count, etc.) */
  unit: string;
}

/**
 * Union type for all possible application errors
 */
export type AppError = NetworkError | AuthError | BusinessError | ServiceError | RuntimeError | PerformanceError;

/**
 * Error severity levels for logging and user feedback
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error context information for debugging and analytics
 */
export interface ErrorContext {
  /** Timestamp when the error occurred */
  timestamp: string;
  /** User ID if authenticated */
  userId?: string;
  /** Current route/page */
  route: string;
  /** User agent string */
  userAgent: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Complete error report for logging and analytics
 */
export interface ErrorReport {
  /** The error that occurred */
  error: AppError;
  /** Severity level of the error */
  severity: ErrorSeverity;
  /** Context information */
  context: ErrorContext;
  /** Whether the error was handled gracefully */
  wasHandled: boolean;
  /** Recovery actions taken */
  recoveryActions?: string[];
}

/**
 * Error boundary state for React error boundaries
 */
export interface ErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The caught error, if any */
  error: Error | null;
  /** Error information for display */
  errorInfo: ErrorInfo | null;
  /** Recovery callback function */
  onRecover?: () => void;
}

/**
 * Custom error classes for different error types
 */

/**
 * Base application error class
 */
export abstract class AppErrorClass extends Error {
  abstract readonly type: AppError['type'];
  public readonly service: string;
  public readonly timestamp: string;
  public readonly retryAfterSeconds: number | undefined;

  constructor(message: string, service: string = 'web-client', retryAfterSeconds?: number) {
    super(message);
    this.name = this.constructor.name;
    this.service = service;
    this.timestamp = new Date().toISOString();
    this.retryAfterSeconds = retryAfterSeconds;
    
    // Maintain proper stack trace for debugging
    if ('captureStackTrace' in Error) {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to ApiError interface for consistent handling
   */
  toApiError(): ApiError {
    const apiError: ApiError = {
      service: this.service,
      message: this.message
    };
    
    if (this.retryAfterSeconds !== undefined) {
      apiError.retryAfterSeconds = this.retryAfterSeconds;
    }
    
    return apiError;
  }
}

/**
 * Network error class for connection and HTTP errors
 */
export class NetworkErrorClass extends AppErrorClass {
  readonly type = 'network' as const;
  public readonly statusCode: number | undefined;
  public readonly isRetryable: boolean;
  public readonly timeout: number | undefined;

  constructor(
    message: string,
    statusCode?: number,
    isRetryable: boolean = true,
    timeout?: number,
    service: string = 'character-service',
    retryAfterSeconds?: number
  ) {
    super(message, service, retryAfterSeconds);
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.timeout = timeout;
  }

  static fromResponse(response: Response, service: string = 'character-service'): NetworkErrorClass {
    const isRetryable = response.status >= 500 || response.status === 429;
    const retryAfter = response.headers.get('Retry-After');
    
    return new NetworkErrorClass(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      isRetryable,
      undefined,
      service,
      retryAfter ? parseInt(retryAfter, 10) : undefined
    );
  }
}

/**
 * Authentication error class for auth-related issues
 */
export class AuthErrorClass extends AppErrorClass {
  readonly type = 'auth' as const;
  public readonly errorCode: string;
  public readonly requiresInteraction: boolean;
  public readonly suggestedAction: AuthError['suggestedAction'];

  constructor(
    message: string,
    errorCode: string,
    requiresInteraction: boolean = false,
    suggestedAction: AuthError['suggestedAction'] = 'retry'
  ) {
    super(message, 'auth-service');
    this.errorCode = errorCode;
    this.requiresInteraction = requiresInteraction;
    this.suggestedAction = suggestedAction;
  }

  static fromMsalError(error: any): AuthErrorClass {
    const errorCode = error.errorCode || error.name || 'unknown_auth_error';
    
    switch (errorCode) {
      case MSAL_ERROR_CODES.INTERACTION_REQUIRED:
      case MSAL_ERROR_CODES.LOGIN_REQUIRED:
        return new AuthErrorClass(
          'Please sign in to continue',
          errorCode,
          true,
          'login'
        );
      
      case MSAL_ERROR_CODES.CONSENT_REQUIRED:
        return new AuthErrorClass(
          'Additional permissions required',
          errorCode,
          true,
          'consent'
        );
      
      case MSAL_ERROR_CODES.USER_CANCELLED:
        return new AuthErrorClass(
          'Sign-in was cancelled',
          errorCode,
          false,
          'retry'
        );
      
      default:
        return new AuthErrorClass(
          error.message || 'Authentication failed',
          errorCode,
          false,
          'contact_support'
        );
    }
  }
}

/**
 * Business logic error class for validation and rule violations
 */
export class BusinessErrorClass extends AppErrorClass {
  readonly type = 'business' as const;
  public readonly rule: string;
  public readonly validationErrors: ValidationError[];
  public readonly isUserFixable: boolean;

  constructor(
    message: string,
    rule: string,
    validationErrors: ValidationError[] = [],
    isUserFixable: boolean = true,
    service: string = 'character-service'
  ) {
    super(message, service);
    this.rule = rule;
    this.validationErrors = validationErrors;
    this.isUserFixable = isUserFixable;
  }

  static fromValidationErrors(errors: ValidationError[], service: string = 'character-service'): BusinessErrorClass {
    const message = `Validation failed: ${errors.map(e => e.message).join(', ')}`;
    return new BusinessErrorClass(message, 'validation', errors, true, service);
  }
}

/**
 * Service error class for outages and availability issues
 */
export class ServiceErrorClass extends AppErrorClass {
  readonly type = 'service' as const;
  public readonly outage: ServiceOutage;
  public readonly affectedFeatures: string[];
  public readonly estimatedResolution: string | undefined;

  constructor(
    message: string,
    outage: ServiceOutage,
    affectedFeatures: string[] = [],
    estimatedResolution?: string
  ) {
    super(message, outage.service, outage.retryAfterSeconds || undefined);
    this.outage = outage;
    this.affectedFeatures = affectedFeatures;
    this.estimatedResolution = estimatedResolution;
  }
}

/**
 * Runtime error class for client-side JavaScript errors
 */
export class RuntimeErrorClass extends AppErrorClass {
  readonly type = 'runtime' as const;
  public readonly originalError: Error;
  public readonly component: string | undefined;
  public readonly userAction: string | undefined;
  public readonly wasHandled: boolean;

  constructor(
    originalError: Error,
    component?: string,
    userAction?: string,
    wasHandled: boolean = false
  ) {
    super(`Runtime error: ${originalError.message}`, 'web-client');
    this.originalError = originalError;
    this.component = component;
    this.userAction = userAction;
    this.wasHandled = wasHandled;
  }
}

/**
 * Performance error class for constitutional requirement violations
 */
export class PerformanceErrorClass extends AppErrorClass {
  readonly type = 'performance' as const;
  public readonly metric: PerformanceError['metric'];
  public readonly actualValue: number;
  public readonly threshold: number;
  public readonly unit: string;

  constructor(
    metric: PerformanceError['metric'],
    actualValue: number,
    threshold: number,
    unit: string
  ) {
    const message = `Performance threshold exceeded: ${metric} is ${actualValue}${unit}, exceeds limit of ${threshold}${unit}`;
    super(message, 'web-client');
    this.metric = metric;
    this.actualValue = actualValue;
    this.threshold = threshold;
    this.unit = unit;
  }
}

/**
 * Utility functions for error handling
 */

/**
 * Type guard to check if an error is a specific type of AppError
 */
export function isAppError<T extends AppError['type']>(
  error: unknown,
  type: T
): error is Extract<AppError, { type: T }> {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as any).type === type
  );
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: unknown): error is NetworkError | ServiceError {
  return (
    (isAppError(error, 'network') && error.isRetryable) ||
    (isAppError(error, 'service') && error.outage.retryAfterSeconds !== null)
  );
}

/**
 * Type guard to check if an error requires user interaction
 */
export function requiresUserInteraction(error: unknown): error is AuthError | BusinessError {
  return (
    (isAppError(error, 'auth') && error.requiresInteraction) ||
    (isAppError(error, 'business') && error.isUserFixable)
  );
}

/**
 * Determine error severity based on error type and context
 */
export function getErrorSeverity(error: AppError): ErrorSeverity {
  switch (error.type) {
    case 'runtime':
      return error.wasHandled ? 'medium' : 'high';
    case 'performance':
      return error.metric === 'render_time' ? 'high' : 'medium';
    case 'service':
      return error.outage.retryAfterSeconds === null ? 'critical' : 'high';
    case 'auth':
      return error.requiresInteraction ? 'medium' : 'high';
    case 'network':
      return error.statusCode && error.statusCode >= 500 ? 'high' : 'medium';
    case 'business':
      return error.isUserFixable ? 'low' : 'medium';
    default:
      return 'medium';
  }
}

/**
 * Get user-friendly error message for display
 */
export function getUserFriendlyMessage(error: AppError): string {
  switch (error.type) {
    case 'network':
      if (error.statusCode === HTTP_STATUS.SERVICE_UNAVAILABLE) {
        return 'The service is temporarily unavailable. Please try again in a few moments.';
      }
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        return 'There was a problem with your request. Please check your input and try again.';
      }
      return 'Unable to connect to the server. Please check your internet connection and try again.';
    
    case 'auth':
      switch (error.suggestedAction) {
        case 'login':
          return 'Please sign in to continue.';
        case 'consent':
          return 'Additional permissions are required to use this feature.';
        case 'contact_support':
          return 'There was a problem with authentication. Please contact support if this continues.';
        default:
          return 'Authentication is required to use this feature.';
      }
    
    case 'business':
      if (error.validationErrors.length > 0) {
        return error.validationErrors.map(e => e.message).join(' ');
      }
      return error.message;
    
    case 'service':
      return error.outage.message;
    
    case 'runtime':
      return 'Something unexpected happened. Please refresh the page and try again.';
    
    case 'performance':
      return 'The page is loading slowly. Please be patient or try refreshing.';
    
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

/**
 * Get suggested recovery actions for an error
 */
export function getRecoveryActions(error: AppError): string[] {
  const actions: string[] = [];
  
  switch (error.type) {
    case 'network':
      if (error.isRetryable) {
        actions.push('retry');
      }
      actions.push('check_connection', 'refresh_page');
      break;
    
    case 'auth':
      actions.push(error.suggestedAction);
      break;
    
    case 'business':
      if (error.isUserFixable) {
        actions.push('fix_input', 'retry');
      } else {
        actions.push('contact_support');
      }
      break;
    
    case 'service':
      if (error.outage.retryAfterSeconds !== null) {
        actions.push('wait_and_retry');
      }
      actions.push('check_status_page');
      break;
    
    case 'runtime':
      actions.push('refresh_page', 'clear_cache');
      if (!error.wasHandled) {
        actions.push('report_bug');
      }
      break;
    
    case 'performance':
      actions.push('wait', 'refresh_page', 'check_connection');
      break;
  }
  
  return actions;
}