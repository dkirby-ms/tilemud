import { describe, it, expect } from 'vitest';
import {
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
  getRecoveryActions,
  type ServiceOutage,
  type ValidationError,
  HTTP_STATUS,
  MSAL_ERROR_CODES
} from '../../src/types';

/**
 * Unit tests for error handling types and utilities.
 * 
 * These tests verify that our error classes, type guards, and utility functions
 * work correctly for comprehensive error handling across the application.
 */

describe('Error Handling', () => {
  describe('Error Classes', () => {
    it('should create NetworkError correctly', () => {
      const error = new NetworkErrorClass(
        'Connection failed',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        true,
        5000,
        'character-service',
        60
      );

      expect(error.type).toBe('network');
      expect(error.message).toBe('Connection failed');
      expect(error.statusCode).toBe(503);
      expect(error.isRetryable).toBe(true);
      expect(error.timeout).toBe(5000);
      expect(error.service).toBe('character-service');
      expect(error.retryAfterSeconds).toBe(60);
    });

    it('should create AuthError from MSAL error', () => {
      const msalError = {
        errorCode: MSAL_ERROR_CODES.INTERACTION_REQUIRED,
        message: 'User interaction required'
      };

      const error = AuthErrorClass.fromMsalError(msalError);

      expect(error.type).toBe('auth');
      expect(error.errorCode).toBe(MSAL_ERROR_CODES.INTERACTION_REQUIRED);
      expect(error.requiresInteraction).toBe(true);
      expect(error.suggestedAction).toBe('login');
    });

    it('should create BusinessError from validation errors', () => {
      const validationErrors: ValidationError[] = [
        {
          field: 'name',
          code: 'required',
          message: 'Character name is required'
        },
        {
          field: 'name',
          code: 'length',
          message: 'Character name must be 1-32 characters'
        }
      ];

      const error = BusinessErrorClass.fromValidationErrors(validationErrors);

      expect(error.type).toBe('business');
      expect(error.rule).toBe('validation');
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.isUserFixable).toBe(true);
      expect(error.message).toContain('Character name is required');
    });

    it('should create ServiceError with outage info', () => {
      const outage: ServiceOutage = {
        service: 'character-service',
        message: 'Service is temporarily unavailable for maintenance',
        retryAfterSeconds: 300
      };

      const error = new ServiceErrorClass(
        'Character service is down',
        outage,
        ['character_creation', 'character_selection'],
        '15 minutes'
      );

      expect(error.type).toBe('service');
      expect(error.outage).toBe(outage);
      expect(error.affectedFeatures).toContain('character_creation');
      expect(error.estimatedResolution).toBe('15 minutes');
      expect(error.retryAfterSeconds).toBe(300);
    });

    it('should create RuntimeError from JavaScript error', () => {
      const jsError = new Error('Cannot read property of undefined');
      const error = new RuntimeErrorClass(
        jsError,
        'CharacterCreationForm',
        'submit_character',
        true
      );

      expect(error.type).toBe('runtime');
      expect(error.originalError).toBe(jsError);
      expect(error.component).toBe('CharacterCreationForm');
      expect(error.userAction).toBe('submit_character');
      expect(error.wasHandled).toBe(true);
      expect(error.message).toContain('Cannot read property of undefined');
    });

    it('should create PerformanceError for constitutional violations', () => {
      const error = new PerformanceErrorClass(
        'render_time',
        3500,
        2000,
        'ms'
      );

      expect(error.type).toBe('performance');
      expect(error.metric).toBe('render_time');
      expect(error.actualValue).toBe(3500);
      expect(error.threshold).toBe(2000);
      expect(error.unit).toBe('ms');
      expect(error.message).toContain('3500ms, exceeds limit of 2000ms');
    });
  });

  describe('Type Guards', () => {
    it('should identify app error types correctly', () => {
      const networkError = new NetworkErrorClass('Network error');
      const authError = new AuthErrorClass('Auth error', 'login_required');
      const regularError = new Error('Regular error');

      expect(isAppError(networkError, 'network')).toBe(true);
      expect(isAppError(networkError, 'auth')).toBe(false);
      expect(isAppError(authError, 'auth')).toBe(true);
      expect(isAppError(authError, 'network')).toBe(false);
      expect(isAppError(regularError, 'network')).toBe(false);
    });

    it('should identify retryable errors', () => {
      const retryableNetworkError = new NetworkErrorClass('Server error', 500, true);
      const nonRetryableNetworkError = new NetworkErrorClass('Client error', 400, false);
      
      const outage: ServiceOutage = {
        service: 'test',
        message: 'Temporary outage',
        retryAfterSeconds: 60
      };
      const serviceError = new ServiceErrorClass('Service down', outage);

      expect(isRetryableError(retryableNetworkError)).toBe(true);
      expect(isRetryableError(nonRetryableNetworkError)).toBe(false);
      expect(isRetryableError(serviceError)).toBe(true);
    });

    it('should identify errors requiring user interaction', () => {
      const interactiveAuthError = new AuthErrorClass('Login required', 'login_required', true, 'login');
      const nonInteractiveAuthError = new AuthErrorClass('Auth failed', 'unknown', false);
      const fixableBusinessError = new BusinessErrorClass('Validation failed', 'validation', [], true);
      const nonFixableBusinessError = new BusinessErrorClass('System error', 'system', [], false);

      expect(requiresUserInteraction(interactiveAuthError)).toBe(true);
      expect(requiresUserInteraction(nonInteractiveAuthError)).toBe(false);
      expect(requiresUserInteraction(fixableBusinessError)).toBe(true);
      expect(requiresUserInteraction(nonFixableBusinessError)).toBe(false);
    });
  });

  describe('Error Utilities', () => {
    it('should determine appropriate error severity', () => {
      const criticalOutage: ServiceOutage = {
        service: 'character-service',
        message: 'Critical failure',
        retryAfterSeconds: null
      };
      const serviceError = new ServiceErrorClass('Critical failure', criticalOutage);
      
      const performanceError = new PerformanceErrorClass('render_time', 5000, 2000, 'ms');
      const handledRuntimeError = new RuntimeErrorClass(new Error('Test'), undefined, undefined, true);
      const unhandledRuntimeError = new RuntimeErrorClass(new Error('Test'), undefined, undefined, false);

      expect(getErrorSeverity(serviceError)).toBe('critical');
      expect(getErrorSeverity(performanceError)).toBe('high');
      expect(getErrorSeverity(handledRuntimeError)).toBe('medium');
      expect(getErrorSeverity(unhandledRuntimeError)).toBe('high');
    });

    it('should generate user-friendly messages', () => {
      const networkError = new NetworkErrorClass('Connection failed');
      const authError = new AuthErrorClass('Login required', 'login_required', true, 'login');
      
      const validationErrors: ValidationError[] = [{
        field: 'name',
        code: 'required',
        message: 'Name is required'
      }];
      const businessError = new BusinessErrorClass('Validation failed', 'validation', validationErrors, true);

      expect(getUserFriendlyMessage(networkError)).toContain('Unable to connect');
      expect(getUserFriendlyMessage(authError)).toBe('Please sign in to continue.');
      expect(getUserFriendlyMessage(businessError)).toBe('Name is required');
    });

    it('should provide appropriate recovery actions', () => {
      const retryableNetworkError = new NetworkErrorClass('Server error', 500, true);
      const authError = new AuthErrorClass('Login required', 'login_required', true, 'login');
      const runtimeError = new RuntimeErrorClass(new Error('Runtime error'));

      const networkActions = getRecoveryActions(retryableNetworkError);
      const authActions = getRecoveryActions(authError);
      const runtimeActions = getRecoveryActions(runtimeError);

      expect(networkActions).toContain('retry');
      expect(networkActions).toContain('check_connection');
      expect(authActions).toContain('login');
      expect(runtimeActions).toContain('refresh_page');
      expect(runtimeActions).toContain('report_bug');
    });
  });

  describe('Error Class Methods', () => {
    it('should convert to ApiError interface', () => {
      const error = new NetworkErrorClass(
        'Test error',
        400,
        false,
        undefined,
        'test-service',
        30
      );

      const apiError = error.toApiError();

      expect(apiError.service).toBe('test-service');
      expect(apiError.message).toBe('Test error');
      expect(apiError.retryAfterSeconds).toBe(30);
    });

    it('should handle ApiError conversion without retryAfterSeconds', () => {
      const error = new NetworkErrorClass('Test error', 400, false);
      const apiError = error.toApiError();

      expect(apiError.service).toBe('character-service');
      expect(apiError.message).toBe('Test error');
      expect(apiError.retryAfterSeconds).toBeUndefined();
    });

    it('should create NetworkError from HTTP Response', () => {
      const mockResponse = {
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Map([['Retry-After', '120']])
      } as unknown as Response;

      mockResponse.headers.get = (name: string) => {
        return name === 'Retry-After' ? '120' : null;
      };

      const error = NetworkErrorClass.fromResponse(mockResponse, 'test-service');

      expect(error.statusCode).toBe(503);
      expect(error.isRetryable).toBe(true); // 5xx errors are retryable
      expect(error.retryAfterSeconds).toBe(120);
      expect(error.service).toBe('test-service');
    });
  });
});