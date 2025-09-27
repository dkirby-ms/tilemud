import { Server, LobbyRoom } from 'colyseus';
import { createServer } from 'http';
import fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from '../config/env';
import { createServiceLogger } from '../infra/monitoring/logger';
import { getMetricsText } from '../infra/monitoring/metrics';
import { createRedisClient } from '../infra/cache/redisClient';

const serverLogger = createServiceLogger('ColyseusServer');

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  colyseus: {
    processId: number;
  };
  redis?: string;
}

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

    // Create Fastify app for HTTP routes (separate from WebSocket)
    const app = fastify({
      logger: false, // We use Pino directly
    });

    // Configure CORS
    await app.register(cors, {
      origin: true, // Allow all origins for development
      credentials: true,
    });

    // Health check endpoint
    app.get('/health', async (_request, reply) => {
      try {
        // Basic health check
        const health: HealthStatus = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          colyseus: {
            processId: process.pid,
          },
        };

        // Test Redis connection if available
        try {
          const redis = await createRedisClient();
          await redis.ping();
          health.redis = 'connected';
          redis.disconnect();
        } catch (error) {
          health.redis = 'disconnected';
          serverLogger.warn({
            event: 'redis_health_check_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 'Redis health check failed during server health check');
        }

        return health;
      } catch (error) {
        serverLogger.error({
          event: 'health_check_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Health check failed');

        reply.code(500);
        return { status: 'unhealthy', error: 'Internal health check failed' };
      }
    });

    // Prometheus metrics endpoint
    app.get('/metrics', async (_request, reply) => {
      try {
        const metrics = await getMetricsText();
        reply.type('text/plain; version=0.0.4; charset=utf-8');
        return metrics;
      } catch (error) {
        serverLogger.error({
          event: 'metrics_endpoint_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Metrics endpoint failed');

        reply.code(500);
        return 'Error generating metrics';
      }
    });

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