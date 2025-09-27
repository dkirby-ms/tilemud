import { z } from 'zod';
import { IReplayRepository } from '../../infra/persistence/replayRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { ReplayMetadata } from '../../domain/entities/replay';

// Replay purge job configuration
export const ReplayPurgeConfigSchema = z.object({
  intervalMs: z.number().int().min(60000).default(24 * 60 * 60 * 1000), // 24 hours
  batchSize: z.number().int().min(1).max(1000).default(100),
  retentionDays: z.number().int().min(1).max(365).default(7),
  dryRun: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export type ReplayPurgeConfig = z.infer<typeof ReplayPurgeConfigSchema>;

export interface ReplayPurgeResult {
  success: boolean;
  totalScanned: number;
  totalPurged: number;
  errors: number;
  durationMs: number;
  nextRun?: Date;
}

export interface ReplayPurgeStats {
  lastRun?: Date;
  lastResult?: ReplayPurgeResult;
  totalRuns: number;
  totalPurged: number;
  averageDurationMs: number;
}

/**
 * Replay purge job implementing FR-017: Automatic replay cleanup
 * Removes expired replays and their associated storage artifacts
 */
export class ReplayPurgeJob {
  private readonly serviceLogger = createServiceLogger('ReplayPurgeJob');
  private readonly config: ReplayPurgeConfig;
  private purgeTimer?: NodeJS.Timeout | undefined;
  private isRunning = false;
  private stats: ReplayPurgeStats = {
    totalRuns: 0,
    totalPurged: 0,
    averageDurationMs: 0,
  };

  constructor(
    private readonly replayRepo: IReplayRepository,
    config: Partial<ReplayPurgeConfig> = {}
  ) {
    this.config = ReplayPurgeConfigSchema.parse(config);
    
    this.serviceLogger.info({
      event: 'replay_purge_job_initialized',
      config: this.config,
    }, 'Replay purge job initialized');
  }

  /**
   * Start the replay purge job with scheduled runs
   */
  start(): void {
    if (this.purgeTimer) {
      this.serviceLogger.warn({
        event: 'replay_purge_already_running',
      }, 'Replay purge job is already running');
      return;
    }

    if (!this.config.enabled) {
      this.serviceLogger.info({
        event: 'replay_purge_disabled',
      }, 'Replay purge job is disabled');
      return;
    }

    this.serviceLogger.info({
      event: 'replay_purge_job_started',
      intervalMs: this.config.intervalMs,
      retentionDays: this.config.retentionDays,
    }, 'Starting replay purge job');

    // Run immediately on start
    this.runPurge().catch(error => {
      this.serviceLogger.error({
        event: 'replay_purge_initial_run_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Initial replay purge run failed');
    });

    // Schedule periodic runs
    this.purgeTimer = setInterval(async () => {
      try {
        await this.runPurge();
      } catch (error) {
        this.serviceLogger.error({
          event: 'replay_purge_scheduled_run_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Scheduled replay purge run failed');
      }
    }, this.config.intervalMs);
  }

  /**
   * Stop the replay purge job
   */
  stop(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = undefined;
      
      this.serviceLogger.info({
        event: 'replay_purge_job_stopped',
      }, 'Replay purge job stopped');
    }
  }

  /**
   * Run a single replay purge operation
   */
  async runPurge(): Promise<ReplayPurgeResult> {
    if (this.isRunning) {
      this.serviceLogger.warn({
        event: 'replay_purge_already_running',
      }, 'Replay purge is already running, skipping this run');
      
      return {
        success: false,
        totalScanned: 0,
        totalPurged: 0,
        errors: 0,
        durationMs: 0,
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    let totalScanned = 0;
    let totalPurged = 0;
    let errors = 0;

    try {
      this.serviceLogger.info({
        event: 'replay_purge_started',
        dryRun: this.config.dryRun,
        retentionDays: this.config.retentionDays,
        batchSize: this.config.batchSize,
      }, 'Starting replay purge operation');

      // Get expired replays
      const expiredReplays = await this.replayRepo.findExpiredReplays();
      totalScanned = expiredReplays.length;

      this.serviceLogger.info({
        event: 'expired_replays_found',
        count: expiredReplays.length,
      }, `Found ${expiredReplays.length} expired replays`);

      if (expiredReplays.length === 0) {
        const durationMs = Date.now() - startTime;
        const result: ReplayPurgeResult = {
          success: true,
          totalScanned: 0,
          totalPurged: 0,
          errors: 0,
          durationMs: durationMs,
          nextRun: new Date(Date.now() + this.config.intervalMs),
        };

        this.updateStats(result);
        
        this.serviceLogger.info({
          event: 'replay_purge_completed',
          result: result,
        }, 'Replay purge completed with no expired replays');

        return result;
      }

      // Process expired replays in batches
      const batches = this.createBatches(expiredReplays, this.config.batchSize);
      
      for (const batch of batches) {
        try {
          const batchResult = await this.purgeBatch(batch);
          totalPurged += batchResult.purged;
          errors += batchResult.errors;
          
          this.serviceLogger.debug({
            event: 'replay_purge_batch_completed',
            batchSize: batch.length,
            purged: batchResult.purged,
            errors: batchResult.errors,
          }, `Processed batch of ${batch.length} replays`);
          
          // Small delay between batches to avoid overwhelming the system
          await this.delay(100);
        } catch (error) {
          this.serviceLogger.error({
            event: 'replay_purge_batch_error',
            error: error instanceof Error ? error.message : 'Unknown error',
            batchSize: batch.length,
          }, 'Failed to process replay purge batch');
          errors += batch.length;
        }
      }

      const durationMs = Date.now() - startTime;
      const result: ReplayPurgeResult = {
        success: errors === 0,
        totalScanned: totalScanned,
        totalPurged: totalPurged,
        errors: errors,
        durationMs: durationMs,
        nextRun: new Date(Date.now() + this.config.intervalMs),
      };

      this.updateStats(result);

      this.serviceLogger.info({
        event: 'replay_purge_completed',
        result: result,
      }, `Replay purge completed: ${totalPurged}/${totalScanned} purged, ${errors} errors`);

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      this.serviceLogger.error({
        event: 'replay_purge_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        totalScanned: totalScanned,
        totalPurged: totalPurged,
        errors: errors,
        durationMs: durationMs,
      }, 'Replay purge operation failed');

      return {
        success: false,
        totalScanned: totalScanned,
        totalPurged: totalPurged,
        errors: errors + 1,
        durationMs: durationMs,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get current job statistics
   */
  getStats(): ReplayPurgeStats {
    return { ...this.stats };
  }

  /**
   * Get current job configuration
   */
  getConfig(): ReplayPurgeConfig {
    return { ...this.config };
  }

  /**
   * Check if job is currently running
   */
  getStatus(): { isRunning: boolean; isScheduled: boolean; nextRun?: Date | undefined } {
    return {
      isRunning: this.isRunning,
      isScheduled: !!this.purgeTimer,
      nextRun: this.stats.lastResult?.nextRun,
    };
  }

  /**
   * Purge a batch of expired replays
   */
  private async purgeBatch(replays: ReplayMetadata[]): Promise<{ purged: number; errors: number }> {
    let purged = 0;
    let errors = 0;

    for (const replay of replays) {
      try {
        if (this.config.dryRun) {
          this.serviceLogger.info({
            event: 'replay_purge_dry_run',
            replayId: replay.id,
            expiresAt: replay.expiresAt,
          }, `[DRY RUN] Would purge replay: ${replay.id}`);
          purged++;
        } else {
          const deleted = await this.replayRepo.deleteReplay(replay.id);
          
          if (deleted) {
            purged++;
            this.serviceLogger.debug({
              event: 'replay_purged',
              replayId: replay.id,
              instanceId: replay.instanceId,
              expiresAt: replay.expiresAt,
              sizeBytes: replay.sizeBytes,
            }, `Purged replay: ${replay.id}`);
          } else {
            errors++;
            this.serviceLogger.warn({
              event: 'replay_purge_failed',
              replayId: replay.id,
              reason: 'delete_returned_false',
            }, `Failed to purge replay: ${replay.id}`);
          }
        }
      } catch (error) {
        errors++;
        this.serviceLogger.error({
          event: 'replay_purge_error',
          replayId: replay.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, `Error purging replay: ${replay.id}`);
      }
    }

    return { purged, errors };
  }

  /**
   * Create batches from an array of replays
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update job statistics
   */
  private updateStats(result: ReplayPurgeResult): void {
    this.stats.lastRun = new Date();
    this.stats.lastResult = result;
    this.stats.totalRuns++;
    this.stats.totalPurged += result.totalPurged;
    
    // Update average duration
    const totalDuration = this.stats.averageDurationMs * (this.stats.totalRuns - 1) + result.durationMs;
    this.stats.averageDurationMs = Math.round(totalDuration / this.stats.totalRuns);
  }
}

/**
 * Factory function to create ReplayPurgeJob instance
 */
export function createReplayPurgeJob(
  replayRepo: IReplayRepository,
  config?: Partial<ReplayPurgeConfig>
): ReplayPurgeJob {
  return new ReplayPurgeJob(replayRepo, config);
}