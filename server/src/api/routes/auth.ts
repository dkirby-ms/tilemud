import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuthService, AuthService } from '../../application/services/authService';
import { PostgresPlayersRepository } from '../../infra/persistence/playersRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { recordPlayerAction } from '../../infra/monitoring/metrics';

const logger = createServiceLogger('AuthRoutes');

// Request/Response types
interface AuthSessionRequest {
  token: string;
  displayName?: string;
  clientInfo?: {
    userAgent?: string;
    platform?: string;
  };
}

interface AuthSessionResponse {
  sessionTicket: string;
  playerId: string;
  displayName: string;
  expiresAt: number;
}

interface AuthErrorResponse {
  error: string;
  code: 'INVALID_TOKEN' | 'SERVICE_UNAVAILABLE' | 'RATE_LIMITED';
  message: string;
}

/**
 * Register authentication routes
 */
export async function registerAuthRoutes(fastify: FastifyInstance) {
  // Create stub repository for now
  const stubRepo = {
    findById: async () => null,
    findByDisplayName: async () => null,
    create: async () => ({ id: 'stub', displayName: 'stub', createdAt: new Date(), lastLoginAt: new Date(), status: 'active', blockListVersion: 1 }),
    update: async () => null,
    delete: async () => false,
    findMany: async () => [],
    getBlockList: async () => [],
    addToBlockList: async () => ({ ownerPlayerId: 'stub', blockedPlayerId: 'stub', createdAt: new Date() }),
    removeFromBlockList: async () => false,
    isPlayerBlocked: async () => false,
    incrementBlockListVersion: async () => undefined,
    updateLastLogin: async () => undefined,
  } as any;

  const authService: AuthService = createAuthService(stubRepo);

  // POST /auth/session - Issue session ticket
  fastify.post<{
    Body: AuthSessionRequest;
    Reply: AuthSessionResponse | AuthErrorResponse;
  }>('/auth/session', {
    schema: {
      description: 'Issue a session ticket for authenticated access to game services',
      tags: ['Authentication'],
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            description: 'Authentication token from external provider',
            minLength: 1,
          },
          displayName: {
            type: 'string',
            description: 'Optional player display name',
            maxLength: 32,
          },
          clientInfo: {
            type: 'object',
            properties: {
              userAgent: { type: 'string' },
              platform: { type: 'string' },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['sessionTicket', 'playerId', 'displayName', 'expiresAt'],
          properties: {
            sessionTicket: {
              type: 'string',
              description: 'Session ticket for WebSocket authentication',
            },
            playerId: {
              type: 'string',
              description: 'Unique player identifier',
            },
            displayName: {
              type: 'string',
              description: 'Player display name',
            },
            expiresAt: {
              type: 'number',
              description: 'Ticket expiration timestamp (Unix milliseconds)',
            },
          },
        },
        400: {
          type: 'object',
          required: ['error', 'code', 'message'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          required: ['error', 'code', 'message'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        503: {
          type: 'object',
          required: ['error', 'code', 'message'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: AuthSessionRequest }>, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      const { token, displayName, clientInfo } = request.body;

      logger.info({
        event: 'auth_session_request',
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        displayName,
        hasClientInfo: !!clientInfo,
      }, 'Session ticket request received');

      // Validate request
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        const errorResponse: AuthErrorResponse = {
          error: 'Invalid request',
          code: 'INVALID_TOKEN',
          message: 'Authentication token is required and must be a non-empty string',
        };

        logger.warn({
          event: 'auth_validation_failed',
          ip: request.ip,
          reason: 'missing_or_invalid_token',
        }, 'Authentication validation failed');

        recordPlayerAction('auth_session', 'validation', 'failure');
        return reply.status(400).send(errorResponse);
      }

      // Issue session ticket
      const result = await authService.issueSessionTicket({
        inputToken: token.trim(),
        displayName: displayName?.trim() || undefined,
        metadata: {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          clientInfo,
          timestamp: Date.now(),
        },
      });

      const response: AuthSessionResponse = {
        sessionTicket: result.sessionTicket,
        playerId: result.playerId,
        displayName: result.displayName,
        expiresAt: result.expiresAt,
      };

      const duration = Date.now() - startTime;

      logger.info({
        event: 'auth_session_issued',
        playerId: result.playerId,
        displayName: result.displayName,
        expiresAt: result.expiresAt,
        duration,
        ip: request.ip,
      }, `Session ticket issued for player: ${result.playerId}`);

      recordPlayerAction('auth_session', 'issue', 'success');
      return reply.status(200).send(response);

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error({
        event: 'auth_session_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        ip: request.ip,
      }, `Session ticket issuance failed: ${error}`);

      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes('invalid token') || error.message.includes('unauthorized')) {
          const errorResponse: AuthErrorResponse = {
            error: 'Authentication failed',
            code: 'INVALID_TOKEN',
            message: 'The provided authentication token is invalid or expired',
          };

          recordPlayerAction('auth_session', 'validation', 'failure');
          return reply.status(401).send(errorResponse);
        }

        if (error.message.includes('rate limit')) {
          const errorResponse: AuthErrorResponse = {
            error: 'Rate limited',
            code: 'RATE_LIMITED',
            message: 'Too many authentication requests. Please try again later.',
          };

          recordPlayerAction('auth_session', 'rate_limit', 'rate_limited');
          return reply.status(429).send(errorResponse);
        }
      }

      // Generic service error
      const errorResponse: AuthErrorResponse = {
        error: 'Service unavailable',
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service is temporarily unavailable. Please try again later.',
      };

      recordPlayerAction('auth_session', 'service', 'failure');
      return reply.status(503).send(errorResponse);
    }
  });

  // GET /auth/health - Health check endpoint
  fastify.get('/auth/health', {
    schema: {
      description: 'Authentication service health check',
      tags: ['Authentication', 'Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'number' },
            service: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    // TODO: Add actual health checks (DB connectivity, external auth service, etc.)
    return reply.status(200).send({
      status: 'healthy',
      timestamp: Date.now(),
      service: 'authentication',
    });
  });

  logger.info({
    event: 'auth_routes_registered',
  }, 'Authentication routes registered successfully');
}