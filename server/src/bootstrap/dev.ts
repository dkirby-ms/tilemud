import { startServer } from './server';

/**
 * Development bootstrap script
 * This is the entry point for `npm run dev:server`
 */
async function startDevelopmentServer(): Promise<void> {
  try {
    console.log('🚀 Starting TileMUD server in development mode...\n');
    
    // Start the Colyseus server with HTTP endpoints
    await startServer();
    
  } catch (error) {
    console.error('❌ Failed to start development server:', error);
    process.exit(1);
  }
}

// Start the server
startDevelopmentServer();