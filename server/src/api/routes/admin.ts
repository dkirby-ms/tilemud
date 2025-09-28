import { Request, Response } from 'express';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { logger } from '../../infra/monitoring/logger';
import { redisKeys } from '../../infra/persistence/redisKeys';
import { config } from '../../config/env';

// Request validation schemas
const drainModeRequestSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
  ttlSeconds: z.number().int().min(60).max(86400).optional().default(3600),
});

const instanceListRequestSchema = z.object({
  instanceIds: z.array(z.string()).min(1).max(100),
});

interface AdminServices {
  redisClient: Redis;
}

export class AdminController {
  constructor(private services: AdminServices) {}

  /**
   * GET /admin/drain-mode/status
   * Get current drain mode status
   */
  async getDrainModeStatus(_req: Request, res: Response): Promise<void> {
    try {
      const globalDrainMode = config.DRAIN_MODE_ENABLED;
      const maintenanceMode = config.MAINTENANCE_MODE_ENABLED;

      // Get instance-specific drain modes
      const pattern = redisKeys.session.instanceDrain('*');
      const drainKeys = await this.services.redisClient.keys(pattern);
      
      const instanceDrainModes: Record<string, { enabled: boolean; ttl?: number }> = {};
      
      for (const key of drainKeys) {
        // Extract instance ID from key
        const instanceId = key.split(':').pop();
        if (instanceId) {
          const ttl = await this.services.redisClient.ttl(key);
          instanceDrainModes[instanceId] = {
            enabled: true,
            ...(ttl > 0 && { ttl })
          };
        }
      }

      res.status(200).json({
        globalDrainMode,
        maintenanceMode,
        instanceDrainModes,
        timestamp: new Date().toISOString()
      });

      logger.info({
        event: 'drain_mode_status_requested',
        globalDrainMode,
        maintenanceMode,
        instanceCount: Object.keys(instanceDrainModes).length
      }, 'Drain mode status requested');

    } catch (error) {
      logger.error({
        event: 'drain_mode_status_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to get drain mode status');

      res.status(500).json({
        error: 'Failed to get drain mode status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * POST /admin/drain-mode/instance/:id
   * Enable/disable drain mode for a specific instance
   */
  async setInstanceDrainMode(req: Request, res: Response): Promise<void> {
    try {
      const instanceId = req.params['id'];
      if (!instanceId) {
        res.status(400).json({
          error: 'Instance ID required'
        });
        return;
      }

      const parseResult = drainModeRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Request validation failed',
          details: parseResult.error.errors
        });
        return;
      }

      const { enabled, reason, ttlSeconds } = parseResult.data;
      const drainKey = redisKeys.session.instanceDrain(instanceId);

      if (enabled) {
        // Enable drain mode with TTL
        await this.services.redisClient.setex(
          drainKey,
          ttlSeconds,
          JSON.stringify({
            enabled: true,
            reason: reason || 'Administrative drain',
            enabledAt: new Date().toISOString()
          })
        );

        logger.info({
          event: 'instance_drain_mode_enabled',
          instanceId,
          reason,
          ttlSeconds
        }, `Drain mode enabled for instance ${instanceId}`);

        res.status(200).json({
          instanceId,
          drainMode: true,
          reason,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
        });

      } else {
        // Disable drain mode
        const deleted = await this.services.redisClient.del(drainKey);

        logger.info({
          event: 'instance_drain_mode_disabled',
          instanceId,
          wasEnabled: deleted > 0
        }, `Drain mode disabled for instance ${instanceId}`);

        res.status(200).json({
          instanceId,
          drainMode: false,
          wasEnabled: deleted > 0
        });
      }

    } catch (error) {
      logger.error({
        event: 'instance_drain_mode_failed',
        instanceId: req.params['id'],
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to set instance drain mode');

      res.status(500).json({
        error: 'Failed to set instance drain mode',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * POST /admin/drain-mode/bulk
   * Enable/disable drain mode for multiple instances
   */
  async setBulkInstanceDrainMode(req: Request, res: Response): Promise<void> {
    try {
      // Validate instance list
      const instanceParseResult = instanceListRequestSchema.safeParse(req.body);
      if (!instanceParseResult.success) {
        res.status(400).json({
          error: 'Invalid instance list',
          details: instanceParseResult.error.errors
        });
        return;
      }

      // Validate drain mode settings
      const drainParseResult = drainModeRequestSchema.safeParse(req.body);
      if (!drainParseResult.success) {
        res.status(400).json({
          error: 'Invalid drain mode settings',
          details: drainParseResult.error.errors
        });
        return;
      }

      const { instanceIds } = instanceParseResult.data;
      const { enabled, reason, ttlSeconds } = drainParseResult.data;

      const results: Array<{
        instanceId: string;
        success: boolean;
        error?: string;
      }> = [];

      // Process each instance
      for (const instanceId of instanceIds) {
        try {
          const drainKey = redisKeys.session.instanceDrain(instanceId);

          if (enabled) {
            await this.services.redisClient.setex(
              drainKey,
              ttlSeconds,
              JSON.stringify({
                enabled: true,
                reason: reason || 'Bulk administrative drain',
                enabledAt: new Date().toISOString()
              })
            );
          } else {
            await this.services.redisClient.del(drainKey);
          }

          results.push({
            instanceId,
            success: true
          });

        } catch (error) {
          results.push({
            instanceId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      logger.info({
        event: 'bulk_drain_mode_operation',
        enabled,
        instanceCount: instanceIds.length,
        successCount,
        failureCount,
        reason
      }, `Bulk drain mode operation completed`);

      res.status(200).json({
        operation: enabled ? 'enable' : 'disable',
        totalInstances: instanceIds.length,
        successCount,
        failureCount,
        results: results.filter(r => !r.success), // Only return failures
        expiresAt: enabled ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : undefined
      });

    } catch (error) {
      logger.error({
        event: 'bulk_drain_mode_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to process bulk drain mode operation');

      res.status(500).json({
        error: 'Failed to process bulk drain mode operation',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}