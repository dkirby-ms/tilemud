import { setupWorker } from 'msw/browser';
import { characterServiceHandlers } from './characterServiceHandlers';

/**
 * Mock Service Worker worker instance for browser environment.
 * Used in development mode to intercept HTTP requests and return mock responses.
 */
export const worker = setupWorker(...characterServiceHandlers);

/**
 * Start the MSW worker in development mode
 */
export async function startMSW() {
  if (import.meta.env.DEV) {
    await worker.start({
      onUnhandledRequest: 'warn',
    });
    console.log('[MSW] Mock Service Worker started');
  }
}