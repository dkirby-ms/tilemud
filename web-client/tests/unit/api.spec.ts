import { describe, it, expect } from 'vitest';
import {
  isSuccessResponse,
  isErrorResponse,
  isValidationResponse,
  isRetryableResponse,
  getErrorMessage,
  getRetryDelay,
  createMockResponse,
  API_STATUS_CODES,
  DEFAULT_RETRY_CONFIG,
  type ArchetypeCatalog,
  type Player,
  type ValidationError
} from '../../src/types';

/**
 * Unit tests for API response types and utilities.
 * 
 * These tests verify that our API response types, type guards, and utility functions
 * work correctly for handling HTTP responses throughout the application.
 */

describe('API Response Types', () => {
  describe('Type Guards', () => {
    it('should identify successful responses', () => {
      const successResponse = createMockResponse('test data', 200);
      const createdResponse = createMockResponse('created', 201);
      const errorResponse = createMockResponse(
        { service: 'test', message: 'Error', retryAfterSeconds: undefined },
        500
      );

      expect(isSuccessResponse(successResponse)).toBe(true);
      expect(isSuccessResponse(createdResponse)).toBe(true);
      expect(isSuccessResponse(errorResponse)).toBe(false);
    });

    it('should identify error responses', () => {
      const errorResponse = createMockResponse(
        { service: 'test', message: 'Server error', retryAfterSeconds: undefined },
        500
      );
      const clientErrorResponse = createMockResponse(
        { service: 'test', message: 'Bad request', retryAfterSeconds: undefined },
        400
      );
      const successResponse = createMockResponse('success', 200);
      const validationResponse = createMockResponse(
        {
          service: 'test',
          message: 'Validation failed',
          retryAfterSeconds: undefined,
          errors: []
        },
        422
      );

      expect(isErrorResponse(errorResponse)).toBe(true);
      expect(isErrorResponse(clientErrorResponse)).toBe(true);
      expect(isErrorResponse(successResponse)).toBe(false);
      expect(isErrorResponse(validationResponse)).toBe(false); // 422 is validation, not error
    });

    it('should identify validation error responses', () => {
      const validationResponse = createMockResponse(
        {
          service: 'character-service',
          message: 'Validation failed',
          retryAfterSeconds: undefined,
          errors: [
            { field: 'name', code: 'required', message: 'Name is required' }
          ]
        },
        422
      );
      const errorResponse = createMockResponse(
        { service: 'test', message: 'Server error', retryAfterSeconds: undefined },
        500
      );

      expect(isValidationResponse(validationResponse)).toBe(true);
      expect(isValidationResponse(errorResponse)).toBe(false);
    });

    it('should identify retryable responses', () => {
      const retryableResponse = createMockResponse('error', 503);
      const nonRetryableResponse = createMockResponse('error', 400);
      const successResponse = createMockResponse('success', 200);

      expect(isRetryableResponse(retryableResponse)).toBe(true);
      expect(isRetryableResponse(nonRetryableResponse)).toBe(false);
      expect(isRetryableResponse(successResponse)).toBe(false);
    });
  });

  describe('Error Message Extraction', () => {
    it('should extract error messages from error responses', () => {
      const errorResponse = createMockResponse(
        { service: 'test', message: 'Something went wrong', retryAfterSeconds: undefined },
        500
      );

      expect(getErrorMessage(errorResponse)).toBe('Something went wrong');
    });

    it('should extract validation error messages', () => {
      const validationErrors: ValidationError[] = [
        { field: 'name', code: 'required', message: 'Name is required' },
        { field: 'archetype', code: 'invalid', message: 'Invalid archetype' }
      ];

      const validationResponse = createMockResponse(
        {
          service: 'character-service',
          message: 'Validation failed',
          retryAfterSeconds: undefined,
          errors: validationErrors
        },
        422
      );

      expect(getErrorMessage(validationResponse)).toBe('Name is required, Invalid archetype');
    });

    it('should return no error for success responses', () => {
      const successResponse = createMockResponse('success', 200);
      expect(getErrorMessage(successResponse)).toBe('No error');
    });
  });

  describe('Retry Delay Extraction', () => {
    it('should extract retry delay from headers', () => {
      const responseWithRetry = createMockResponse('error', 503, { 'retry-after': '60' });
      const responseWithoutRetry = createMockResponse('error', 500);

      expect(getRetryDelay(responseWithRetry)).toBe(60000); // Convert to milliseconds
      expect(getRetryDelay(responseWithoutRetry)).toBe(null);
    });

    it('should handle case-insensitive retry-after headers', () => {
      const responseWithRetry = createMockResponse('error', 503, { 'Retry-After': '30' });
      expect(getRetryDelay(responseWithRetry)).toBe(30000);
    });

    it('should handle invalid retry-after values', () => {
      const responseWithInvalid = createMockResponse('error', 503, { 'retry-after': 'invalid' });
      expect(getRetryDelay(responseWithInvalid)).toBe(null);
    });
  });

  describe('Mock Response Creation', () => {
    it('should create mock responses with correct structure', () => {
      const mockData = { test: 'data' };
      const response = createMockResponse(mockData, 201, { 'custom-header': 'value' });

      expect(response.data).toBe(mockData);
      expect(response.status).toBe(201);
      expect(response.statusText).toBe('Created');
      expect(response.headers['custom-header']).toBe('value');
      expect(response.headers['content-type']).toBe('application/json');
      expect(response.timestamp).toBeTruthy();
    });

    it('should create mock responses with default values', () => {
      const response = createMockResponse('test');

      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
      expect(response.headers['content-type']).toBe('application/json');
    });
  });

  describe('Constants', () => {
    it('should define correct API status codes', () => {
      expect(API_STATUS_CODES.OK).toBe(200);
      expect(API_STATUS_CODES.CREATED).toBe(201);
      expect(API_STATUS_CODES.NO_CONTENT).toBe(204);
      expect(API_STATUS_CODES.BAD_REQUEST).toBe(400);
      expect(API_STATUS_CODES.UNAUTHORIZED).toBe(401);
      expect(API_STATUS_CODES.FORBIDDEN).toBe(403);
      expect(API_STATUS_CODES.NOT_FOUND).toBe(404);
      expect(API_STATUS_CODES.CONFLICT).toBe(409);
      expect(API_STATUS_CODES.UNPROCESSABLE_ENTITY).toBe(422);
      expect(API_STATUS_CODES.INTERNAL_SERVER_ERROR).toBe(500);
      expect(API_STATUS_CODES.SERVICE_UNAVAILABLE).toBe(503);
    });

    it('should define default retry configuration', () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelay).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(30000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(503);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toContain(500);
      expect(DEFAULT_RETRY_CONFIG.retryOnNetworkError).toBe(true);
    });
  });

  describe('Specific API Response Types', () => {
    it('should type archetype catalog responses correctly', () => {
      const catalogData: ArchetypeCatalog = {
        version: '1.0.0',
        archetypes: [
          {
            id: 'warrior-001',
            name: 'Warrior',
            description: 'Strong fighter',
            isAvailable: true,
            lastUpdatedAt: '2025-01-01T00:00:00Z'
          }
        ]
      };

      const response = createMockResponse(catalogData, 200);

      // TypeScript should enforce this structure
      expect(response.data.version).toBe('1.0.0');
      expect(response.data.archetypes).toHaveLength(1);
      expect(response.data.archetypes[0]?.id).toBe('warrior-001');
    });

    it('should type character roster responses correctly', () => {
      const playerData: Player = {
        playerId: 'user-123',
        activeCharacterId: 'char-456',
        characters: [
          {
            id: 'char-456',
            name: 'TestChar',
            archetypeId: 'warrior-001',
            createdAt: '2025-01-01T00:00:00Z',
            status: 'active'
          }
        ],
        outage: null
      };

      const response = createMockResponse(playerData, 200);

      // TypeScript should enforce this structure
      expect(response.data.playerId).toBe('user-123');
      expect(response.data.activeCharacterId).toBe('char-456');
      expect(response.data.characters).toHaveLength(1);
      expect(response.data.characters[0]?.name).toBe('TestChar');
      expect(response.data.outage).toBe(null);
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct response types at compile time', () => {
      // These should compile without errors, demonstrating type safety
      
      const successResponse = createMockResponse('test', 200);
      const errorResponse = createMockResponse(
        { service: 'test', message: 'Error', retryAfterSeconds: undefined },
        500
      );

      // TypeScript should enforce these types
      expect(successResponse.status).toBe(200);
      expect(errorResponse.status).toBe(500);
      expect(typeof successResponse.data).toBe('string');
      expect(typeof errorResponse.data.message).toBe('string');
    });
  });
});