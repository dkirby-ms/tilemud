import { Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../infra/monitoring/logger';
import { RateLimitService } from '../../application/services/rateLimit/rateLimitService';
import { SessionService } from '../../application/services/session/sessionService';
import { QueueService } from '../../application/services/queue/queueService';
import { redisKeys } from '../../infra/persistence/redisKeys';
import { 
  AdmissionStatus, 
  AdmissionOutcome,
  QueuePosition 
} from '../../domain/connection/types';
import { config } from '../../config/env';
import { Redis } from 'ioredis';

// Request validation schema
const admissionRequestSchema = z.object({
  characterId: z.string().uuid(),
  clientVersion: z.string().min(1),
  replaceToken: z.string().uuid().optional(),
  timeout: z.number().int().min(1000).max(30000).default(10000),
});

interface AdmissionServices {
  rateLimitService: RateLimitService;
  sessionService: SessionService;
  queueService: QueueService;
  redisClient: Redis;
}

export class AdmissionController {
  constructor(private services: AdmissionServices) {}

  /**
   * POST /instances/:id/connect
   * Main admission endpoint
   */
  async connect(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const correlationId = uuidv4();
    
    try {
      // Extract and validate instance ID
      const instanceId = req.params['id'];
      if (!instanceId) {
        res.status(400).json({
          status: AdmissionStatus.REJECTED,
          outcome: AdmissionOutcome.INVALID_REQUEST,
          message: 'Instance ID required',
          correlationId,
          processingTimeMs: Date.now() - startTime
        });
        return;
      }

      // Validate request body
      const parseResult = admissionRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.error({
          event: 'admission_validation_failed',
          errors: parseResult.error.errors,
          correlationId,
          instanceId
        }, 'Admission request validation failed');

        res.status(400).json({
          status: AdmissionStatus.REJECTED,
          outcome: AdmissionOutcome.INVALID_REQUEST,
          message: 'Request validation failed',
          correlationId,
          processingTimeMs: Date.now() - startTime
        });
        return;
      }

      const { characterId, clientVersion, replaceToken, timeout } = parseResult.data;

      logger.info({
        event: 'admission_request_started',
        instanceId,
        characterId,
        clientVersion,
        hasReplaceToken: !!replaceToken,
        correlationId
      }, 'Processing admission request');

      // 1. Rate limiting check
      const rateLimitResult = await this.services.rateLimitService.checkRateLimit(characterId);
      
      // Always add rate limiting headers
      this.addRateLimitHeaders(res, rateLimitResult);
      
      if (!rateLimitResult.allowed) {
        logger.warn({
          event: 'admission_rate_limited',
          characterId,
          correlationId,
          retryAfter: rateLimitResult.resetTimeSeconds
        }, 'Admission rate limited');

        res.status(429).json({
          status: AdmissionStatus.RATE_LIMITED,
          outcome: AdmissionOutcome.RATE_LIMITED,
          message: 'Too many requests',
          retryAfterSeconds: rateLimitResult.resetTimeSeconds,
          correlationId,
          processingTimeMs: Date.now() - startTime
        });
        return;
      }

      // 2. Check for maintenance/drain mode
      const isDrainMode = await this.checkDrainMode(instanceId);
      if (isDrainMode && !replaceToken) {
        logger.warn({
          event: 'admission_drain_mode',
          instanceId,
          characterId,
          correlationId
        }, 'Admission rejected - drain mode');

        res.status(503).json({
          status: AdmissionStatus.REJECTED,
          outcome: AdmissionOutcome.DRAIN_MODE,
          message: 'Instance is in maintenance mode',
          correlationId,
          processingTimeMs: Date.now() - startTime
        });
        return;
      }

      // 3. Set up timeout handling
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('ADMISSION_TIMEOUT')), timeout);
      });

      try {
        // 4. Race admission logic against timeout
        const admissionResult = await Promise.race([
          this.processAdmission(instanceId, characterId, replaceToken, correlationId),
          timeoutPromise
        ]);

        // 5. Return successful admission result
        res.status(200).json({
          ...admissionResult,
          correlationId,
          processingTimeMs: Date.now() - startTime
        });

      } catch (error) {
        if (error instanceof Error && error.message === 'ADMISSION_TIMEOUT') {
          logger.warn({
            event: 'admission_timeout',
            instanceId,
            characterId,
            correlationId,
            timeoutMs: timeout
          }, 'Admission request timed out');

          res.status(408).json({
            status: AdmissionStatus.TIMEOUT,
            outcome: AdmissionOutcome.TIMEOUT,
            message: 'Admission request timed out',
            correlationId,
            processingTimeMs: Date.now() - startTime
          });
        } else {
          throw error;
        }
      }

    } catch (error) {
      logger.error({
        event: 'admission_request_failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        correlationId,
        processingTimeMs: Date.now() - startTime
      }, 'Admission request failed');

      res.status(500).json({
        status: AdmissionStatus.ERROR,
        outcome: AdmissionOutcome.SERVER_ERROR,
        message: 'Internal server error',
        correlationId,
        processingTimeMs: Date.now() - startTime
      });
    }
  }

  /**
   * Core admission processing logic
   */
  private async processAdmission(
    instanceId: string,
    characterId: string,
    replaceToken?: string,
    correlationId?: string
  ): Promise<{
    status: AdmissionStatus;
    outcome: AdmissionOutcome;
    message: string;
    sessionToken?: string;
    queuePosition?: QueuePosition;
    reconnectionToken?: string;
  }> {
    // Build admission request with proper optional handling
    const admissionRequest: {
      instanceId: string;
      characterId: string;
      replaceToken?: string;
      correlationId?: string;
    } = {
      instanceId,
      characterId,
    };
    
    if (replaceToken) {
      admissionRequest.replaceToken = replaceToken;
    }
    
    if (correlationId) {
      admissionRequest.correlationId = correlationId;
    }
    
    const admissionResult = await this.services.sessionService.admit(admissionRequest);

    // Handle different admission outcomes
    if (admissionResult.status === 'admitted') {
      logger.info({
        event: 'character_admitted',
        instanceId,
        characterId,
        sessionToken: admissionResult.sessionToken,
        correlationId
      }, 'Character admitted successfully');

      const result: {
        status: AdmissionStatus;
        outcome: AdmissionOutcome;
        message: string;
        sessionToken?: string;
        reconnectionToken?: string;
      } = {
        status: AdmissionStatus.ADMITTED,
        outcome: AdmissionOutcome.ADMITTED,
        message: 'Admission approved - session created'
      };

      if (admissionResult.sessionToken) {
        result.sessionToken = admissionResult.sessionToken;
      }

      if (admissionResult.reconnectionToken) {
        result.reconnectionToken = admissionResult.reconnectionToken;
      }

      return result;

    } else if (admissionResult.status === 'queued') {
      logger.info({
        event: 'character_queued',
        instanceId,
        characterId,
        queuePosition: admissionResult.queuePosition,
        correlationId
      }, 'Character queued for admission');

      return {
        status: AdmissionStatus.QUEUED,
        outcome: AdmissionOutcome.QUEUED,
        message: 'Added to queue - capacity currently full',
        queuePosition: admissionResult.queuePosition
      };

    } else {
      // Rejection
      logger.warn({
        event: 'character_rejected',
        instanceId,
        characterId,
        reason: admissionResult.reason,
        correlationId
      }, 'Character admission rejected');

      return {
        status: AdmissionStatus.REJECTED,
        outcome: this.mapRejectionReason(admissionResult.reason || 'UNKNOWN'),
        message: admissionResult.reason || 'Admission rejected'
      };
    }
  }

  /**
   * Check if instance is in drain/maintenance mode
   */
  private async checkDrainMode(instanceId: string): Promise<boolean> {
    try {
      // Check global drain mode configuration
      if (config.DRAIN_MODE_ENABLED) {
        return true;
      }

      // Check maintenance mode configuration
      if (config.MAINTENANCE_MODE_ENABLED) {
        return true;
      }

      // Check instance-specific drain mode in Redis
      const drainKey = redisKeys.session.instanceDrain(instanceId);
      const result = await this.services.redisClient.exists(drainKey);
      return result === 1;
    } catch (error) {
      logger.error({
        event: 'drain_mode_check_failed',
        instanceId,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to check drain mode');
      
      // Fail safe: assume not in drain mode
      return false;
    }
  }

  /**
   * Add standard rate limiting headers to response
   */
  private addRateLimitHeaders(res: Response, rateLimitResult: any): void {
    // X-RateLimit-Limit: Request limit per window
    if (rateLimitResult.limit) {
      res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
    }

    // X-RateLimit-Remaining: Requests remaining in current window
    if (rateLimitResult.remaining !== undefined) {
      res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    }

    // X-RateLimit-Reset: Unix timestamp when the rate limit resets
    if (rateLimitResult.resetTimeSeconds) {
      const resetTimestamp = Math.floor(Date.now() / 1000) + rateLimitResult.resetTimeSeconds;
      res.setHeader('X-RateLimit-Reset', resetTimestamp.toString());
    }

    // X-RateLimit-Window: Window size in seconds
    if (rateLimitResult.windowSeconds) {
      res.setHeader('X-RateLimit-Window', rateLimitResult.windowSeconds.toString());
    }

    // Retry-After: When rate limited, how long to wait
    if (!rateLimitResult.allowed && rateLimitResult.retryAfterSeconds) {
      res.setHeader('Retry-After', rateLimitResult.retryAfterSeconds.toString());
    }

    // X-RateLimit-Policy: Brief description of the rate limiting policy
    res.setHeader('X-RateLimit-Policy', 'sliding-window');
  }

  /**
   * Map session service rejection reasons to admission outcomes
   */
  private mapRejectionReason(reason: string): AdmissionOutcome {
    switch (reason.toUpperCase()) {
      case 'ALREADY_IN_SESSION':
        return AdmissionOutcome.ALREADY_IN_SESSION;
      case 'INVALID_REPLACE_TOKEN':
        return AdmissionOutcome.INVALID_REPLACE_TOKEN;
      case 'SUSPENDED':
        return AdmissionOutcome.SUSPENDED;
      case 'INVALID_INSTANCE':
        return AdmissionOutcome.INVALID_INSTANCE;
      case 'DRAIN_MODE':
        return AdmissionOutcome.DRAIN_MODE;
      default:
        return AdmissionOutcome.SERVER_ERROR;
    }
  }
}

/**
 * Factory function to create admission route handler
 */
export function createAdmissionRoutes(services: AdmissionServices) {
  const controller = new AdmissionController(services);
  
  return {
    connect: controller.connect.bind(controller)
  };
}