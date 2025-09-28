import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { server } from '../src/mocks/server';

/**
 * Mock Service Worker setup for tests.
 * This file is imported by vitest to set up MSW for all test files.
 */

// Mock MSAL globally for all tests
vi.mock('@azure/msal-browser', async () => {
  const msalMock = await import('./__mocks__/@azure/msal-browser');
  return msalMock;
});

// Enable request interception before all tests
beforeAll(() => {
  server.listen({
    // Log warnings for requests that don't have a corresponding handler
    onUnhandledRequest: 'warn',
  });
});

// Global test setup
beforeEach(() => {
  // Reset any mock state before each test
});

// Reset handlers after each test to ensure test isolation
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});