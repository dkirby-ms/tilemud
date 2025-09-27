import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ReplayService, ReplayQuery, ReplayAccessResult } from '../../application/services/replayService';
import { createServiceLogger } from '../../infra/monitoring/logger';

const logger = createServiceLogger('ReplayRoutes');

// Route parameter schemas
const ReplayParamsSchema = z.object({
  id: z.string().uuid(),
});

const ReplayQuerySchema = z.object({
  includeEvents: z.coerce.boolean().default(false),
  requesterId: z.string().uuid().optional(),
});

// Response schemas
const ReplayMetadataResponseSchema = z.object({
  replayId: z.string(),
  instanceId: z.string(),
  sessionType: z.string(),
  status: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  expiresAt: z.string(),
  participantIds: z.array(z.string()),
  eventCount: z.number(),
  metadata: z.record(z.any()).optional(),
});

const ReplayWithEventsResponseSchema = z.object({
  replayId: z.string(),
  instanceId: z.string(),
  sessionType: z.string(),
  status: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  expiresAt: z.string(),
  participantIds: z.array(z.string()),
  eventCount: z.number(),
  metadata: z.record(z.any()).optional(),
  events: z.array(z.object({
    timestamp: z.string(),
    type: z.string(),
    playerId: z.string().optional(),
    data: z.any(),
  })),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

type ReplayParams = z.infer<typeof ReplayParamsSchema>;
type ReplayQueryParams = z.infer<typeof ReplayQuerySchema>;
type ReplayMetadataResponse = z.infer<typeof ReplayMetadataResponseSchema>;
type ReplayWithEventsResponse = z.infer<typeof ReplayWithEventsResponseSchema>;
type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Register replay routes
 */
export async function registerReplayRoutes(fastify: FastifyInstance) {
  // Create stub repository for now
  const stubReplayRepo = {
    findReplayById: async () => ({
      replayId: 'replay-123',
      instanceId: 'instance-456',
      sessionType: 'arena',
      status: 'completed',
      createdAt: new Date(),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      participantIds: ['player-1', 'player-2'],
      eventCount: 150,
      metadata: { arenaId: 'arena-789', tier: 'skirmish' },
    }),
    findReplaysByInstanceId: async () => [],
    findReplaysByPlayerId: async () => [],
    findExpiredReplays: async () => [],
    createReplay: async () => ({ replayId: 'new-replay', createdAt: new Date() }),
    updateReplay: async () => null,
    deleteReplay: async () => false,
    appendEvent: async () => undefined,
    getEventsByReplayId: async () => [
      {
        timestamp: new Date(),
        type: 'tile_placed',
        playerId: 'player-1',
        data: { x: 5, y: 10, tileType: 'grass' },
      },
      {
        timestamp: new Date(),
        type: 'battle_result',
        playerId: 'player-2',
        data: { outcome: 'victory', points: 100 },
      },
    ],
    getReplayStats: async () => ({ totalCount: 50, activeCount: 30, expiredCount: 20 }),
  } as any;

  const replayService = new ReplayService(stubReplayRepo);

  // GET /replays/:id - Retrieve replay by ID
  fastify.get<{
    Params: ReplayParams,
    Querystring: ReplayQueryParams,
    Reply: ReplayMetadataResponse | ReplayWithEventsResponse | ErrorResponse
  }>('/replays/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          includeEvents: {
            type: 'boolean',
            default: false,
          },
          requesterId: {
            type: 'string',
            format: 'uuid',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            replayId: { type: 'string' },
            instanceId: { type: 'string' },
            sessionType: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
            completedAt: { type: 'string' },
            expiresAt: { type: 'string' },
            participantIds: { 
              type: 'array',
              items: { type: 'string' },
            },
            eventCount: { type: 'integer' },
            metadata: { type: 'object' },
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string' },
                  type: { type: 'string' },
                  playerId: { type: 'string' },
                  data: { type: 'object' },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        410: {
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
  }, async (request: FastifyRequest<{ Params: ReplayParams, Querystring: ReplayQueryParams }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const { id } = request.params;
    const { includeEvents, requesterId } = request.query;

    try {
      // Validate parameters
      const validatedParams = ReplayParamsSchema.parse({ id });
      const validatedQuery = ReplayQuerySchema.parse({ includeEvents, requesterId });

      // Build query for replay service
      const replayQuery: ReplayQuery = {
        replayId: validatedParams.id,
        requesterId: validatedQuery.requesterId,
      };

      // Get replay metadata first
      const metadataResult: ReplayAccessResult = await replayService.getReplayMetadata(replayQuery);

      const processingTime = Date.now() - startTime;

      if (!metadataResult.success || !metadataResult.replay) {
        // Handle different error cases
        switch (metadataResult.errorCode) {
          case 'NOT_FOUND':
            const notFoundError: ErrorResponse = {
              error: metadataResult.error || 'Replay not found',
              code: 'NOT_FOUND',
            };

            logger.warn({
              event: 'replay_not_found',
              processingTimeMs: processingTime,
              metadata: { replayId: validatedParams.id, requesterId: validatedQuery.requesterId },
            }, `Replay not found: ${validatedParams.id}`);

            return reply.code(404).send(notFoundError);

          case 'EXPIRED':
            const expiredError: ErrorResponse = {
              error: metadataResult.error || 'Replay has expired',
              code: 'EXPIRED',
            };

            logger.warn({
              event: 'replay_expired',
              processingTimeMs: processingTime,
              metadata: { replayId: validatedParams.id, requesterId: validatedQuery.requesterId },
            }, `Replay expired: ${validatedParams.id}`);

            return reply.code(410).send(expiredError);

          case 'ACCESS_DENIED':
            const accessDeniedError: ErrorResponse = {
              error: metadataResult.error || 'Access denied to replay',
              code: 'ACCESS_DENIED',
            };

            logger.warn({
              event: 'replay_access_denied',
              processingTimeMs: processingTime,
              metadata: { replayId: validatedParams.id, requesterId: validatedQuery.requesterId },
            }, `Replay access denied: ${validatedParams.id}`);

            return reply.code(403).send(accessDeniedError);

          default:
            const genericError: ErrorResponse = {
              error: metadataResult.error || 'Failed to retrieve replay',
              code: 'RETRIEVAL_FAILED',
            };

            logger.error({
              event: 'replay_retrieval_failed',
              processingTimeMs: processingTime,
              metadata: { 
                replayId: validatedParams.id,
                requesterId: validatedQuery.requesterId,
                errorCode: metadataResult.errorCode,
              },
            }, `Replay retrieval failed: ${validatedParams.id}`);

            return reply.code(500).send(genericError);
        }
      }

      // If includeEvents is true, also get the events
      if (validatedQuery.includeEvents) {
        const eventsResult: ReplayAccessResult = await replayService.getReplayEvents(replayQuery);

        if (eventsResult.success && eventsResult.events) {
          const responseWithEvents: ReplayWithEventsResponse = {
            replayId: metadataResult.replay.id,
            instanceId: metadataResult.replay.instanceId,
            sessionType: 'arena', // Default value since not in ReplayMetadata
            status: metadataResult.replay.status,
            createdAt: metadataResult.replay.createdAt.toISOString(),
            completedAt: metadataResult.replay.completedAt?.toISOString(),
            expiresAt: metadataResult.replay.expiresAt.toISOString(),
            participantIds: [], // Default since not in ReplayMetadata - would need to fetch from instance
            eventCount: metadataResult.replay.eventCount || 0,
            metadata: { instanceId: metadataResult.replay.instanceId },
            events: eventsResult.events.map(event => ({
              timestamp: new Date(event.timestamp).toISOString(),
              type: event.type,
              playerId: event.playerId,
              data: event.data,
            })),
          };

          logger.info({
            event: 'replay_with_events_retrieved',
            processingTimeMs: processingTime,
            metadata: {
              replayId: metadataResult.replay.id,
              eventCount: eventsResult.events.length,
              requesterId: validatedQuery.requesterId,
            },
          }, `Replay with events retrieved: ${metadataResult.replay.id}`);

          return reply.code(200).send(responseWithEvents);
        }
      }

      // Return metadata-only response
      const response: ReplayMetadataResponse = {
        replayId: metadataResult.replay.id,
        instanceId: metadataResult.replay.instanceId,
        sessionType: 'arena', // Default value since not in ReplayMetadata
        status: metadataResult.replay.status,
        createdAt: metadataResult.replay.createdAt.toISOString(),
        completedAt: metadataResult.replay.completedAt?.toISOString(),
        expiresAt: metadataResult.replay.expiresAt.toISOString(),
        participantIds: [], // Default since not in ReplayMetadata - would need to fetch from instance
        eventCount: metadataResult.replay.eventCount || 0,
        metadata: { instanceId: metadataResult.replay.instanceId },
      };

      logger.info({
        event: 'replay_metadata_retrieved',
        processingTimeMs: processingTime,
        metadata: {
          replayId: metadataResult.replay.id,
          requesterId: validatedQuery.requesterId,
        },
      }, `Replay metadata retrieved: ${metadataResult.replay.id}`);

      return reply.code(200).send(response);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      if (error instanceof z.ZodError) {
        logger.warn({
          event: 'replay_validation_error',
          error: error.message,
          processingTimeMs: processingTime,
        }, 'Invalid parameters for replay retrieval');

        const validationError: ErrorResponse = {
          error: 'Invalid request parameters',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        };

        return reply.code(400).send(validationError);
      }

      logger.error({
        event: 'replay_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime,
        metadata: { 
          replayId: id,
          stack: error instanceof Error ? error.stack : undefined,
        },
      }, 'Error retrieving replay');

      const errorResponse: ErrorResponse = {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      };

      return reply.code(500).send(errorResponse);
    }
  });

  // GET /replays/health - Health check for replay service
  fastify.get('/replays/health', {
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
      service: 'replay',
    });
  });
}