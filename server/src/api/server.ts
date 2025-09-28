import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { createServiceLogger } from '../infra/monitoring/logger';
import { getMetricsText } from '../infra/monitoring/metrics';
import { registerAuthRoutes } from './routes/auth';
import { registerArenaRoutes } from './routes/arenas';
import { registerGuildRoutes } from './routes/guilds';
import { registerReplayRoutes } from './routes/replays';
import { registerInstanceRoutes } from './routes/instance';
import { initializeServices } from '../infra/container/serviceContainer';

const logger = createServiceLogger('HTTPServer');

/**
 * Build and configure the Fastify HTTP server
 * Integrates all API routes and middleware
 */
export async function buildApp(opts?: FastifyServerOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: opts?.logger ?? true,
    ...opts
  });

  // Initialize services before setting up routes
  try {
    await initializeServices();
    logger.info({ event: 'services_initialized' }, 'Application services initialized');
  } catch (error) {
    logger.error({
      event: 'service_initialization_failed',
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to initialize services');
    throw error;
  }

  // Add global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method
    }, 'HTTP request error');

    // Don't expose internal errors in production
    const message = process.env['NODE_ENV'] === 'production' 
      ? 'Internal Server Error' 
      : error.message;

    reply.status(error.statusCode || 500).send({
      error: 'Internal Server Error',
      message,
      statusCode: error.statusCode || 500
    });
  });

  // Add global request logging
  app.addHook('onRequest', (request, _reply, done) => {
    logger.info({
      url: request.url,
      method: request.method,
      headers: request.headers,
      ip: request.ip
    }, 'Incoming HTTP request');
    done();
  });

  // Add response time logging
  app.addHook('onResponse', (request, reply, done) => {
    const responseTime = reply.getResponseTime();
    logger.info({
      url: request.url,
      method: request.method,
      statusCode: reply.statusCode,
      responseTime: `${responseTime}ms`
    }, 'HTTP request completed');
    done();
  });

  // CORS support for browser clients
  app.register(import('@fastify/cors'), {
    origin: true, // Allow all origins in development
    credentials: true
  });

  // JSON body parsing
  // app.register(import('@fastify/formbody')); // Not needed for JSON APIs

  // Content type validation
  app.addHook('preValidation', (request, reply, done) => {
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      const contentType = request.headers['content-type'];
      if (!contentType || !contentType.includes('application/json')) {
        reply.status(400).send({
          error: 'Bad Request',
          message: 'Content-Type must be application/json',
          statusCode: 400
        });
        return;
      }
    }
    done();
  });

  // Register route modules
  app.register(registerAuthRoutes);
  app.register(registerArenaRoutes);
  app.register(registerGuildRoutes);
  app.register(registerReplayRoutes);
  app.register(registerInstanceRoutes);

  // Health check endpoint
  app.get('/health', async (_request, _reply) => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '0.1.0',
      environment: process.env['NODE_ENV'] || 'development'
    };
  });

  // Prometheus metrics endpoint
  app.get('/metrics', async (_request, reply) => {
    try {
      const metrics = await getMetricsText();
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return metrics;
    } catch (error) {
      logger.error({
        event: 'metrics_endpoint_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Metrics endpoint failed');

      reply.code(500);
      return 'Error generating metrics';
    }
  });

  // Handle 404s
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404
    });
  });

  // Handle method not allowed
  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 405) {
      reply.status(405).send({
        error: 'Method Not Allowed',
        message: `Method ${request.method} not allowed for ${request.url}`,
        statusCode: 405
      });
      return;
    }

    // Default error handler
    logger.error({
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method
    }, 'HTTP request error');

    const message = process.env['NODE_ENV'] === 'production' 
      ? 'Internal Server Error' 
      : error.message;

    reply.status(error.statusCode || 500).send({
      error: 'Internal Server Error',
      message,
      statusCode: error.statusCode || 500
    });
  });

  return app;
}

/**
 * Start the HTTP server
 */
export async function startServer(port = 3000, host = '0.0.0.0'): Promise<FastifyInstance> {
  const app = await buildApp();

  try {
    await app.listen({ port, host });
    logger.info({ port, host }, 'HTTP server started');
    return app;
  } catch (error) {
    logger.error({ error }, 'Failed to start HTTP server');
    process.exit(1);
  }
}