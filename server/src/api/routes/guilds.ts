import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GuildService, GuildCreationRequest, GuildOperationResult } from '../../application/services/guildService';
import { createServiceLogger } from '../../infra/monitoring/logger';

const logger = createServiceLogger('GuildRoutes');

// Request/Response schemas
const CreateGuildRequestSchema = z.object({
  name: z.string().min(3).max(32),
  leaderPlayerId: z.string().uuid(),
});

const CreateGuildResponseSchema = z.object({
  guildId: z.string(),
  name: z.string(),
  leaderPlayerId: z.string(),
  createdAt: z.string(),
  memberCount: z.number(),
});
 
const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

type CreateGuildRequest = z.infer<typeof CreateGuildRequestSchema>;
type CreateGuildResponse = z.infer<typeof CreateGuildResponseSchema>;
type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Register guild routes
 */
export async function registerGuildRoutes(fastify: FastifyInstance) {
  // Create stub repositories for now
  const stubGuildsRepo = {
    findById: async () => null,
    findByName: async () => null,
    create: async () => ({ 
      id: 'guild-123', 
      name: 'Test Guild', 
      leaderPlayerId: 'player-123',
      createdAt: new Date(),
      memberCount: 1,
      status: 'active',
    }),
    update: async () => null,
    delete: async () => false,
    findMany: async () => [],
    addMembership: async () => ({ 
      guildId: 'guild-123',
      playerId: 'player-456',
      role: 'member',
      joinedAt: new Date(),
    }),
    removeMembership: async () => false,
    updateMemberRole: async () => null,
    getMembersByGuildId: async () => [],
    getMembershipByPlayerId: async () => null,
    getMembership: async () => null,
    getMemberships: async () => [],
    getPlayerMemberships: async () => [],
    updateMembershipRole: async () => null,
    incrementMemberCount: async () => undefined,
    decrementMemberCount: async () => undefined,
    isMemberCountValid: async () => true,
    checkNameAvailability: async () => true,
  } as any;

  const stubPlayersRepo = {
    findById: async () => ({ 
      id: 'player-123', 
      displayName: 'TestPlayer', 
      status: 'active', 
      createdAt: new Date(),
      lastLoginAt: new Date(),
      blockListVersion: 1,
    }),
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

  const guildService = new GuildService(stubGuildsRepo, stubPlayersRepo);

  // POST /guilds - Create a new guild
  fastify.post<{
    Body: CreateGuildRequest,
    Reply: CreateGuildResponse | ErrorResponse
  }>('/guilds', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'leaderPlayerId'],
        properties: {
          name: {
            type: 'string',
            minLength: 3,
            maxLength: 32,
          },
          leaderPlayerId: {
            type: 'string',
            format: 'uuid',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            guildId: { type: 'string' },
            name: { type: 'string' },
            leaderPlayerId: { type: 'string' },
            createdAt: { type: 'string' },
            memberCount: { type: 'integer' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        409: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        422: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        500: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: CreateGuildRequest }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const { name, leaderPlayerId } = request.body;

    try {
      // Validate input
      const guildRequest: GuildCreationRequest = CreateGuildRequestSchema.parse({
        name: name.trim(),
        leaderPlayerId: leaderPlayerId.trim(),
      });

      // Call guild service to create guild
      const result: GuildOperationResult = await guildService.createGuild(guildRequest);

      const processingTime = Date.now() - startTime;

      if (result.success && result.guild) {
        const response: CreateGuildResponse = {
          guildId: result.guild.id,
          name: result.guild.name,
          leaderPlayerId: result.guild.leaderPlayerId,
          createdAt: result.guild.createdAt.toISOString(),
          memberCount: result.guild.memberCount,
        };

        logger.info({
          event: 'guild_created',
          processingTimeMs: processingTime,
          metadata: {
            guildId: result.guild.id,
            guildName: result.guild.name,
            leaderPlayerId: result.guild.leaderPlayerId,
          },
        }, `Guild created: ${result.guild.name}`);

        return reply.code(201).send(response);
      }

      // Handle creation failures based on error code
      const processingTimeMs = Date.now() - startTime;

      switch (result.errorCode) {
        case 'DUPLICATE_NAME':
          const duplicateNameError: ErrorResponse = {
            error: result.error || 'Guild name already exists',
            code: 'DUPLICATE_NAME',
          };

          logger.warn({
            event: 'guild_creation_failed',
            reason: 'duplicate_name',
            processingTimeMs: processingTimeMs,
            metadata: { guildName: guildRequest.name },
          }, 'Guild creation failed: duplicate name');

          return reply.code(409).send(duplicateNameError);

        case 'PLAYER_NOT_FOUND':
          const playerNotFoundError: ErrorResponse = {
            error: result.error || 'Leader player not found or inactive',
            code: 'PLAYER_NOT_FOUND',
          };

          logger.warn({
            event: 'guild_creation_failed',
            reason: 'player_not_found',
            processingTimeMs: processingTimeMs,
            metadata: { leaderPlayerId: guildRequest.leaderPlayerId },
          }, 'Guild creation failed: leader player not found');

          return reply.code(422).send(playerNotFoundError);

        case 'VALIDATION_ERROR':
          const validationError: ErrorResponse = {
            error: result.error || 'Invalid guild data',
            code: 'VALIDATION_ERROR',
          };

          logger.warn({
            event: 'guild_creation_failed',
            reason: 'validation_error',
            processingTimeMs: processingTimeMs,
            metadata: { error: result.error },
          }, 'Guild creation failed: validation error');

          return reply.code(400).send(validationError);

        default:
          const genericError: ErrorResponse = {
            error: result.error || 'Failed to create guild',
            code: 'CREATION_FAILED',
          };

          logger.error({
            event: 'guild_creation_failed',
            reason: 'unknown',
            processingTimeMs: processingTimeMs,
            metadata: { 
              error: result.error,
              errorCode: result.errorCode,
            },
          }, 'Guild creation failed: unknown error');

          return reply.code(500).send(genericError);
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      if (error instanceof z.ZodError) {
        logger.warn({
          event: 'guild_creation_validation_error',
          error: error.message,
          processingTimeMs: processingTime,
        }, 'Invalid request body for guild creation');

        const validationError: ErrorResponse = {
          error: 'Invalid request body',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        };

        return reply.code(400).send(validationError);
      }

      logger.error({
        event: 'guild_creation_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime,
        metadata: { stack: error instanceof Error ? error.stack : undefined },
      }, 'Error creating guild');

      const errorResponse: ErrorResponse = {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      };

      return reply.code(500).send(errorResponse);
    }
  });

  // GET /guilds/health - Health check for guild service
  fastify.get('/guilds/health', {
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
      service: 'guild',
    });
  });
}