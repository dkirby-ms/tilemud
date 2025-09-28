import { Request, Response } from 'express';
import { logger } from '../../infra/monitoring/logger';
import { QueueService } from '../../application/services/queue/queueService';
import { SessionService } from '../../application/services/session/sessionService';
import { Redis } from 'ioredis';

interface QueueStatusServices {
  queueService: QueueService;
  sessionService: SessionService;
  redisClient: Redis;
}

export class QueueStatusController {
  constructor(private services: QueueStatusServices) {}

  /**
   * GET /instances/:id/queue/status
   * Returns current queue status for an instance:
   * - Total queue length
   * - Estimated wait time
   * - Current capacity utilization
   * - Processing rate statistics
   */
  async getQueueStatus(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const instanceId = req.params['id'];
      if (!instanceId) {
        res.status(400).json({
          error: 'Instance ID required',
          processingTimeMs: Date.now() - startTime
        });
        return;
      }

      // Get comprehensive queue status
      const [queueStats, sessionStats] = await Promise.all([
        this.services.queueService.getQueueStats(instanceId),
        this.getSessionStatistics(instanceId)
      ]);

      logger.debug({
        event: 'queue_status_requested',
        instanceId,
        queueLength: queueStats.depth,
        estimatedWaitTime: queueStats.averageWaitTime,
        processingTimeMs: Date.now() - startTime
      }, 'Queue status requested');

      res.status(200).json({
        instanceId,
        queue: {
          length: queueStats.depth,
          estimatedWaitTimeSeconds: queueStats.averageWaitTime,
          oldestEntryAgeSeconds: Math.floor((Date.now() - queueStats.oldestEntry) / 1000),
          lastUpdatedAt: new Date().toISOString()
        },
        capacity: {
          current: sessionStats.activeSessions,
          maximum: sessionStats.maxCapacity,
          utilizationPercent: Math.round((sessionStats.activeSessions / sessionStats.maxCapacity) * 100),
          availableSlots: sessionStats.maxCapacity - sessionStats.activeSessions
        },
        processing: {
          admissionsPerMinute: sessionStats.admissionsPerMinute,
          averageSessionDurationMinutes: sessionStats.averageSessionDurationMinutes,
          gracePeriodSessions: sessionStats.gracePeriodSessions
        },
        updatedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime
      });

    } catch (error) {
      logger.error({
        event: 'queue_status_request_failed',
        instanceId: req.params['id'],
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: Date.now() - startTime
      }, 'Queue status request failed');

      res.status(500).json({
        error: 'Failed to retrieve queue status',
        processingTimeMs: Date.now() - startTime
      });
    }
  }

  /**
   * Get detailed session statistics for capacity reporting
   */
  private async getSessionStatistics(instanceId: string): Promise<{
    activeSessions: number;
    maxCapacity: number;
    admissionsPerMinute: number;
    averageSessionDurationMinutes: number;
    gracePeriodSessions: number;
  }> {
    try {
      // Get active session count
      const activeSessionCount = await this.services.sessionService.getActiveSessionCount(instanceId);
      
      // Get capacity limit (default to 100 if not configured)
      const maxCapacity = await this.getInstanceCapacity(instanceId);
      
      // Get recent admission rate
      const admissionsPerMinute = await this.getAdmissionRate(instanceId);
      
      // Get average session duration
      const averageSessionDurationMinutes = await this.getAverageSessionDuration(instanceId);
      
      // Get grace period session count
      const gracePeriodSessions = await this.services.sessionService.getGracePeriodSessionCount(instanceId);

      return {
        activeSessions: activeSessionCount,
        maxCapacity,
        admissionsPerMinute,
        averageSessionDurationMinutes,
        gracePeriodSessions
      };
      
    } catch (error) {
      logger.error({
        event: 'session_statistics_failed',
        instanceId,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to get session statistics');
      
      // Return default values on error
      return {
        activeSessions: 0,
        maxCapacity: 100,
        admissionsPerMinute: 0,
        averageSessionDurationMinutes: 0,
        gracePeriodSessions: 0
      };
    }
  }

  /**
   * Get configured capacity limit for instance
   */
  private async getInstanceCapacity(instanceId: string): Promise<number> {
    try {
      const capacityKey = `instance:capacity:${instanceId}`;
      const capacity = await this.services.redisClient.get(capacityKey);
      return capacity ? parseInt(capacity, 10) : 100; // Default capacity
    } catch {
      return 100; // Default capacity on error
    }
  }

  /**
   * Calculate recent admission rate (admissions per minute)
   */
  private async getAdmissionRate(instanceId: string): Promise<number> {
    try {
      const admissionKey = `metrics:admissions:${instanceId}`;
      const oneMinuteAgo = Date.now() - (60 * 1000);
      
      // Count admissions in the last minute using a sorted set
      const recentAdmissions = await this.services.redisClient.zcount(
        admissionKey, 
        oneMinuteAgo, 
        Date.now()
      );
      
      return recentAdmissions;
    } catch {
      return 0; // Default on error
    }
  }

  /**
   * Calculate average session duration over recent sessions
   */
  private async getAverageSessionDuration(instanceId: string): Promise<number> {
    try {
      const durationKey = `metrics:session_durations:${instanceId}`;
      
      // Get recent session durations (last 100 sessions)
      const durations = await this.services.redisClient.lrange(durationKey, 0, 99);
      
      if (durations.length === 0) {
        return 30; // Default 30 minutes
      }
      
      const totalDuration = durations.reduce((sum, duration) => {
        return sum + parseInt(duration, 10);
      }, 0);
      
      const averageDurationMs = totalDuration / durations.length;
      return Math.round(averageDurationMs / (60 * 1000)); // Convert to minutes
      
    } catch {
      return 30; // Default 30 minutes on error
    }
  }
}

/**
 * Factory function to create queue status route handler
 */
export function createQueueStatusRoutes(services: QueueStatusServices) {
  const controller = new QueueStatusController(services);
  
  return {
    getQueueStatus: controller.getQueueStatus.bind(controller)
  };
}