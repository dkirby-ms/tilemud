import { setupServer } from 'msw/node';
import { characterServiceHandlers } from './characterServiceHandlers';

/**
 * Mock Service Worker server instance for Node.js environment.
 * Used in tests to intercept HTTP requests and return mock responses.
 */
export const server = setupServer(...characterServiceHandlers);