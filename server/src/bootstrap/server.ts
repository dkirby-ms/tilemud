import { Server, LobbyRoom } from 'colyseus';
import { createServer } from 'http';

import { config } from '../config/env';
import { createServiceLogger } from '../infra/monitoring/logger';
import { buildApp } from '../api/server';

const serverLogger = createServiceLogger('ColyseusServer');

/**
 * Bootstrap and configure the Colyseus server with HTTP endpoints
 */
export async function createColyseusServer(): Promise<{ gameServer: Server; httpServer: any; app: any }> {
  try {
    // Create HTTP server using Node.js built-in
    const httpServer = createServer();
    
    // Create Colyseus server (uses built-in WebSocket transport by default)
    const gameServer = new Server({
      server: httpServer,
    });

    // Create HTTP API server with all routes integrated
    const app = buildApp({
      logger: false, // We use Pino directly
    });

    // Configure CORS (already handled in buildApp)
    // Additional health and metrics endpoints are in buildApp

    serverLogger.info({
      event: 'http_api_server_configured',
      endpoints: ['/health', '/metrics', '/auth/session', '/arenas', '/guilds', '/replays/:id'],
    }, 'HTTP API server configured with all routes');

    // Colyseus Monitor (development only) - skip for now due to Fastify incompatibility
    if (config.NODE_ENV === 'development') {
      serverLogger.info('Colyseus Monitor disabled (Fastify compatibility issue)');
      // TODO: Set up monitor on separate Express server or fix Fastify integration
    }

    // Default lobby room (Colyseus built-in)
    gameServer.define('lobby', LobbyRoom);

    serverLogger.info({
      event: 'colyseus_server_created',
      wsPort: config.PORT,
      httpPort: config.HTTP_PORT || config.PORT + 1,
      environment: config.NODE_ENV,
      monitorEnabled: false, // Temporarily disabled
    }, 'Colyseus server created successfully');

    return { gameServer, httpServer, app };

  } catch (error) {
    serverLogger.error({
      event: 'colyseus_server_creation_failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'Failed to create Colyseus server');
    
    throw error;
  }
}

/**
 * Start the server and listen on configured ports
 */
export async function startServer(): Promise<void> {
  try {
    const { gameServer, httpServer, app } = await createColyseusServer();

    // Start WebSocket server (Colyseus)
    const wsPort = config.PORT;
    httpServer.listen(wsPort, () => {
      serverLogger.info({
        event: 'websocket_server_started',
        port: wsPort,
        environment: config.NODE_ENV,
      }, `WebSocket server listening on port ${wsPort}`);
    });

    // Start HTTP API server (Fastify)
    const httpPort = config.HTTP_PORT || wsPort + 1;
    await app.listen({ 
      port: httpPort, 
      host: '0.0.0.0' // Bind to all interfaces for Docker/container compatibility
    });

    serverLogger.info({
      event: 'http_server_started',
      port: httpPort,
      endpoints: ['/health', '/metrics'],
      monitor: 'disabled',
    }, `HTTP server listening on port ${httpPort}`);

    // Register graceful shutdown handlers
    process.on('SIGINT', () => gracefulShutdown(gameServer, app));
    process.on('SIGTERM', () => gracefulShutdown(gameServer, app));

    serverLogger.info({
      event: 'server_startup_complete',
      wsPort,
      httpPort,
      pid: process.pid,
    }, 'Server startup complete - ready to accept connections');

  } catch (error) {
    serverLogger.error({
      event: 'server_startup_failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'Server startup failed');

    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(gameServer: Server, app: any): Promise<void> {
  serverLogger.info({
    event: 'graceful_shutdown_started',
  }, 'Starting graceful shutdown...');

  try {
    // Stop accepting new connections
    await gameServer.gracefullyShutdown(false);
    
    // Close HTTP server
    await app.close();

    serverLogger.info({
      event: 'graceful_shutdown_complete',
    }, 'Graceful shutdown complete');

    process.exit(0);
  } catch (error) {
    serverLogger.error({
      event: 'graceful_shutdown_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'Error during graceful shutdown');

    process.exit(1);
  }
}

// Export for testing
export { gracefulShutdown };