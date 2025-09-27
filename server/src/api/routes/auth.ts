import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService, AuthTokenInput } from '../../application/services/authService';
import { createServiceLogger } from '../../infra/monitoring/logger';

const logger = createServiceLogger('AuthRoutes');

// Request/Response schemas
const AuthSessionRequestSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  playerDisplayName: z.string().min(3).max(32).optional(),
});

const AuthSessionResponseSchema = z.object({
  sessionTicket: z.string(),
  playerId: z.string(), 
  displayName: z.string(),
  expiresAt: z.number(),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
  retryAfterMs: z.number().optional(),
});

type AuthSessionRequest = z.infer<typeof AuthSessionRequestSchema>;
type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

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

  const authService = new AuthService(stubRepo);

  // POST /auth/session - Issue session ticket
  fastify.post<{
    Body: AuthSessionRequest,
    Reply: AuthSessionResponse | ErrorResponse
  }>('/auth/session', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            minLength: 1,
          },
          playerDisplayName: {
            type: 'string',
            minLength: 3,
            maxLength: 32,
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            sessionTicket: { type: 'string' },
            playerId: { type: 'string' },
            displayName: { type: 'string' },
            expiresAt: { type: 'number' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: AuthSessionRequest }>, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      // Validate request body with Zod
      const validatedBody = AuthSessionRequestSchema.parse(request.body);
      const { token, playerDisplayName } = validatedBody;

      // Validate and sanitize input
      const authInput: AuthTokenInput = {
        token: token.trim(),
        playerDisplayName: playerDisplayName?.trim(),
      };

      // Call auth service
      const result = await authService.issueSessionTicket(authInput);

      const processingTime = Date.now() - startTime;

      if (result.success && result.ticket) {
        const response: AuthSessionResponse = {
          sessionTicket: result.ticket.sessionId,
          playerId: result.ticket.playerId,
          displayName: result.ticket.displayName,
          expiresAt: result.ticket.expiresAt.getTime(),
        };

        logger.info({
          event: 'session_ticket_issued',
          processingTimeMs: processingTime,
          metadata: {
            playerId: result.ticket.playerId,
            displayName: result.ticket.displayName,
            expiresAt: result.ticket.expiresAt,
          },
        }, `Session ticket issued for player: ${result.ticket.playerId}`);

        return reply.code(200).send(response);
      }

      // Handle auth failures
      if (result.retryAfterMs) {
        const rateLimitResponse: ErrorResponse = {
          error: result.error || 'Too many authentication attempts',
          code: 'RATE_LIMITED',
          retryAfterMs: result.retryAfterMs,
        };

        logger.warn({
          event: 'auth_rate_limited',
          processingTimeMs: processingTime,
          metadata: { retryAfterMs: result.retryAfterMs },
        }, 'Authentication rate limited');

        return reply.code(429).send(rateLimitResponse);
      }

      const authFailedResponse: ErrorResponse = {
        error: result.error || 'Authentication failed',
        code: 'INVALID_TOKEN',
      };

      logger.warn({
        event: 'auth_failed',
        processingTimeMs: processingTime,
        metadata: { error: result.error },
      }, 'Authentication failed');

      return reply.code(401).send(authFailedResponse);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        logger.warn({
          event: 'auth_validation_error',
          validationErrors: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
          processingTimeMs: processingTime,
        }, 'Authentication request validation failed');

        const validationResponse: ErrorResponse = {
          error: 'Invalid request format',
          code: 'VALIDATION_ERROR',
          details: error.issues,
        };

        return reply.code(400).send(validationResponse);
      }

      logger.error({
        event: 'auth_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime,
        metadata: { stack: error instanceof Error ? error.stack : undefined },
      }, 'Authentication service error');

      const errorResponse: ErrorResponse = {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      };

      return reply.code(500).send(errorResponse);
    }
  });

  // GET /auth/health - Health check
  fastify.get('/auth/health', {
    schema: {
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
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'healthy',
      timestamp: Date.now(),
      service: 'authentication',
    });
  });
}