import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ArenaCatalogService, ArenaTier, ArenaCatalogFilters, ArenaCapacityInfo } from '../../application/services/arenaCatalogService';
import { createServiceLogger } from '../../infra/monitoring/logger';

const logger = createServiceLogger('ArenaRoutes');

// Query parameter schemas
const ArenaListQuerySchema = z.object({
  tier: z.enum(['tutorial', 'skirmish', 'epic']).optional(),
  availableOnly: z.coerce.boolean().default(false),
  minCapacity: z.coerce.number().int().min(0).optional(),
  maxWaitTime: z.coerce.number().min(0).optional(),
});

const ArenaCapacityQuerySchema = z.object({
  tier: z.enum(['tutorial', 'skirmish', 'epic']).optional(),
});

// Response schemas
const ArenaCatalogResponseSchema = z.object({
  arenas: z.array(z.object({
    arenaId: z.string(),
    tier: z.string(),
    currentPlayers: z.number(),
    maxCapacity: z.number(),
    utilizationPercent: z.number(),
    status: z.string(),
    estimatedWaitTime: z.number().optional(),
    instanceId: z.string().optional(),
  })),
  totalCount: z.number(),
});

const ArenaCapacityResponseSchema = z.object({
  capacityInfo: z.array(z.object({
    tier: z.string(),
    totalArenas: z.number(),
    activeArenas: z.number(),
    totalCapacity: z.number(),
    currentPlayers: z.number(),
    utilizationPercent: z.number(),
    averageWaitTime: z.number().optional(),
  })),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

type ArenaListQuery = z.infer<typeof ArenaListQuerySchema>;
type ArenaCapacityQuery = z.infer<typeof ArenaCapacityQuerySchema>;
type ArenaCatalogResponse = z.infer<typeof ArenaCatalogResponseSchema>;
type ArenaCapacityResponse = z.infer<typeof ArenaCapacityResponseSchema>;
type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Register arena routes
 */
export async function registerArenaRoutes(fastify: FastifyInstance) {
  // Create stub repository for now
  const stubRepo = {
    findById: async () => null,
    create: async () => ({ id: 'stub', instanceId: 'stub', tier: 'tutorial', createdAt: new Date(), status: 'active' }),
    update: async () => null,
    delete: async () => false,
    findMany: async () => [],
    findActiveArenas: async () => [],
    findAvailableArenas: async () => [],
    getArenaUtilization: async () => ({ totalCapacity: 100, currentPlayers: 30, utilizationPercent: 30 }),
  } as any;

  const arenaCatalogService = new ArenaCatalogService(stubRepo);

  // GET /arenas - List available arenas with filtering
  fastify.get<{
    Querystring: ArenaListQuery,
    Reply: ArenaCatalogResponse | ErrorResponse
  }>('/arenas', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tier: {
            type: 'string',
            enum: ['tutorial', 'skirmish', 'epic'],
          },
          availableOnly: {
            type: 'boolean',
            default: false,
          },
          minCapacity: {
            type: 'integer',
            minimum: 0,
          },
          maxWaitTime: {
            type: 'number',
            minimum: 0,
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            arenas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  arenaId: { type: 'string' },
                  tier: { type: 'string' },
                  currentPlayers: { type: 'integer' },
                  maxCapacity: { type: 'integer' },
                  utilizationPercent: { type: 'number' },
                  status: { type: 'string' },
                  estimatedWaitTime: { type: 'number' },
                  instanceId: { type: 'string' },
                },
              },
            },
            totalCount: { type: 'integer' },
          },
        },
        400: {
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
  }, async (request: FastifyRequest<{ Querystring: ArenaListQuery }>, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // Validate and parse query parameters
      const queryParams = ArenaListQuerySchema.parse(request.query);
      
      // Build filters for the catalog service
      const filters: ArenaCatalogFilters = {};
      if (queryParams.tier) filters.tier = queryParams.tier as ArenaTier;
      if (queryParams.availableOnly) filters.availableOnly = queryParams.availableOnly;
      if (queryParams.minCapacity !== undefined) filters.minCapacity = queryParams.minCapacity;
      if (queryParams.maxWaitTime !== undefined) filters.maxWaitTime = queryParams.maxWaitTime;

      // Get arena catalog from service
      const arenas = await arenaCatalogService.getCatalog(filters);

      const processingTime = Date.now() - startTime;

      const response: ArenaCatalogResponse = {
        arenas: arenas.map(arena => ({
          arenaId: arena.arenaId,
          tier: arena.tier,
          currentPlayers: arena.currentPlayers,
          maxCapacity: arena.maxCapacity,
          utilizationPercent: arena.utilizationPercent,
          status: arena.status,
          estimatedWaitTime: arena.estimatedWaitTime,
          instanceId: arena.instanceId,
        })),
        totalCount: arenas.length,
      };

      logger.info({
        event: 'arenas_listed',
        processingTimeMs: processingTime,
        metadata: {
          totalArenas: arenas.length,
          filters: filters,
        },
      }, `Listed ${arenas.length} arenas`);

      return reply.code(200).send(response);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      if (error instanceof z.ZodError) {
        logger.warn({
          event: 'arena_list_validation_error',
          error: error.message,
          processingTimeMs: processingTime,
        }, 'Invalid query parameters for arena list');

        const validationError: ErrorResponse = {
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        };

        return reply.code(400).send(validationError);
      }

      logger.error({
        event: 'arena_list_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime,
        metadata: { stack: error instanceof Error ? error.stack : undefined },
      }, 'Error listing arenas');

      const errorResponse: ErrorResponse = {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      };

      return reply.code(500).send(errorResponse);
    }
  });

  // GET /arenas/capacity - Get arena capacity information
  fastify.get<{
    Querystring: ArenaCapacityQuery,
    Reply: ArenaCapacityResponse | ErrorResponse
  }>('/arenas/capacity', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tier: {
            type: 'string',
            enum: ['tutorial', 'skirmish', 'epic'],
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            capacityInfo: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tier: { type: 'string' },
                  totalArenas: { type: 'integer' },
                  activeArenas: { type: 'integer' },
                  totalCapacity: { type: 'integer' },
                  currentPlayers: { type: 'integer' },
                  utilizationPercent: { type: 'number' },
                  averageWaitTime: { type: 'number' },
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
        500: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: ArenaCapacityQuery }>, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // Validate query parameters
      const queryParams = ArenaCapacityQuerySchema.parse(request.query);
      
      let capacityInfo: ArenaCapacityInfo[];
      
      if (queryParams.tier) {
        // Get capacity for specific tier
        const tierInfo = await arenaCatalogService.getTierCapacityInfo(queryParams.tier as ArenaTier);
        capacityInfo = [tierInfo];
      } else {
        // Get capacity overview for all tiers
        capacityInfo = await arenaCatalogService.getCapacityOverview();
      }

      const processingTime = Date.now() - startTime;

      const response: ArenaCapacityResponse = {
        capacityInfo: capacityInfo.map(info => ({
          tier: info.tier,
          totalArenas: info.totalArenas,
          activeArenas: info.activeArenas,
          totalCapacity: info.totalCapacity,
          currentPlayers: info.currentPlayers,
          utilizationPercent: info.utilizationPercent,
          averageWaitTime: info.averageWaitTime,
        })),
      };

      logger.info({
        event: 'arena_capacity_retrieved',
        processingTimeMs: processingTime,
        metadata: {
          tierCount: capacityInfo.length,
          specificTier: queryParams.tier,
        },
      }, `Retrieved arena capacity info for ${capacityInfo.length} tier(s)`);

      return reply.code(200).send(response);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      if (error instanceof z.ZodError) {
        logger.warn({
          event: 'arena_capacity_validation_error',
          error: error.message,
          processingTimeMs: processingTime,
        }, 'Invalid query parameters for arena capacity');

        const validationError: ErrorResponse = {
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        };

        return reply.code(400).send(validationError);
      }

      logger.error({
        event: 'arena_capacity_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime,
        metadata: { stack: error instanceof Error ? error.stack : undefined },
      }, 'Error retrieving arena capacity');

      const errorResponse: ErrorResponse = {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      };

      return reply.code(500).send(errorResponse);
    }
  });

  // GET /arenas/health - Health check for arena service
  fastify.get('/arenas/health', {
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
      service: 'arena-catalog',
    });
  });
}