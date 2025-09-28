import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { AdmissionController } from './admission';
import { QueueStatusController } from './queueStatus';
import { AdminController } from './admin';
import { getServiceContainer } from '../../infra/container/serviceContainer';

const logger = createServiceLogger('InstanceRoutes');

// Route parameter schemas
const InstanceParamSchema = z.object({
  id: z.string().min(1, 'Instance ID is required')
});

type InstanceParams = z.infer<typeof InstanceParamSchema>;

/**
 * Register instance-related routes (admission, queue status, admin)
 */
export async function registerInstanceRoutes(fastify: FastifyInstance) {
  // Get properly initialized services
  const serviceContainer = getServiceContainer();
  
  // Create controllers with real services
  const admissionController = new AdmissionController(serviceContainer.getAdmissionServices());
  const queueStatusController = new QueueStatusController(serviceContainer.getQueueStatusServices());
  const adminController = new AdminController(serviceContainer.getAdminServices());

  // POST /instances/:id/connect - Main admission endpoint
  fastify.post<{
    Params: InstanceParams;
    Body: any;
    Reply: any;
  }>('/instances/:id/connect', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id']
      }
    }
  }, async (request: FastifyRequest<{ Params: InstanceParams; Body: any }>, reply: FastifyReply) => {
    try {
      // Convert Fastify request/reply to Express-style for the controller
      const mockReq = {
        params: request.params,
        body: request.body,
        headers: request.headers,
      } as any;

      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => {
            reply.code(code).send(data);
            return mockRes;
          }
        }),
        setHeader: (name: string, value: string) => {
          reply.header(name, value);
          return mockRes;
        }
      } as any;

      await admissionController.connect(mockReq, mockRes);
    } catch (error) {
      logger.error({
        event: 'admission_route_error',
        instanceId: request.params.id,
        error: error instanceof Error ? error.message : String(error)
      }, 'Admission route failed');

      reply.code(500).send({
        status: 'ERROR',
        outcome: 'SERVER_ERROR',
        message: 'Internal server error'
      });
    }
  });

  // GET /instances/:id/queue/status - Queue status endpoint
  fastify.get<{
    Params: InstanceParams;
    Reply: any;
  }>('/instances/:id/queue/status', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id']
      }
    }
  }, async (request: FastifyRequest<{ Params: InstanceParams }>, reply: FastifyReply) => {
    try {
      const mockReq = {
        params: request.params,
        headers: request.headers,
      } as any;

      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => {
            reply.code(code).send(data);
            return mockRes;
          }
        }),
        setHeader: (name: string, value: string) => {
          reply.header(name, value);
          return mockRes;
        }
      } as any;

      await queueStatusController.getQueueStatus(mockReq, mockRes);
    } catch (error) {
      logger.error({
        event: 'queue_status_route_error',
        instanceId: request.params.id,
        error: error instanceof Error ? error.message : String(error)
      }, 'Queue status route failed');

      reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  // Admin routes for drain mode management
  // GET /admin/drain-mode/status
  fastify.get('/admin/drain-mode/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const mockReq = {} as any;
      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => {
            reply.code(code).send(data);
            return mockRes;
          }
        })
      } as any;

      await adminController.getDrainModeStatus(mockReq, mockRes);
    } catch (error) {
      logger.error({
        event: 'admin_drain_status_error',
        error: error instanceof Error ? error.message : String(error)
      }, 'Admin drain status route failed');

      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /admin/drain-mode/instance/:id
  fastify.post<{
    Params: InstanceParams;
    Body: any;
  }>('/admin/drain-mode/instance/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id']
      }
    }
  }, async (request: FastifyRequest<{ Params: InstanceParams; Body: any }>, reply: FastifyReply) => {
    try {
      const mockReq = {
        params: request.params,
        body: request.body
      } as any;

      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => {
            reply.code(code).send(data);
            return mockRes;
          }
        })
      } as any;

      await adminController.setInstanceDrainMode(mockReq, mockRes);
    } catch (error) {
      logger.error({
        event: 'admin_instance_drain_error',
        instanceId: request.params.id,
        error: error instanceof Error ? error.message : String(error)
      }, 'Admin instance drain route failed');

      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /admin/drain-mode/bulk
  fastify.post<{
    Body: any;
  }>('/admin/drain-mode/bulk', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const mockReq = {
        body: request.body
      } as any;

      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => {
            reply.code(code).send(data);
            return mockRes;
          }
        })
      } as any;

      await adminController.setBulkInstanceDrainMode(mockReq, mockRes);
    } catch (error) {
      logger.error({
        event: 'admin_bulk_drain_error',
        error: error instanceof Error ? error.message : String(error)
      }, 'Admin bulk drain route failed');

      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  logger.info({
    event: 'instance_routes_registered'
  }, 'Instance routes registered: admission, queue status, admin');
}