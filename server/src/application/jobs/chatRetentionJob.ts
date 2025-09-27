import { z } from 'zod';
import { IChatRepository } from '../../infra/persistence/chatRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { ChatMessage } from '../../domain/entities/chat';

// Chat retention policy configuration
export const ChatRetentionConfigSchema = z.object({
  intervalMs: z.number().int().min(60000).default(6 * 60 * 60 * 1000), // 6 hours
  batchSize: z.number().int().min(1).max(10000).default(1000),
  // Retention periods by channel type (in days)
  retentionPolicies: z.object({
    guild: z.number().int().min(1).max(365).default(30),        // Guild chat: 30 days
    party: z.number().int().min(1).max(365).default(7),         // Party chat: 7 days  
    direct: z.number().int().min(1).max(365).default(90),       // Direct messages: 90 days
    global: z.number().int().min(1).max(365).default(7),        // Global chat: 7 days
    system: z.number().int().min(1).max(365).default(30),       // System messages: 30 days
    moderation: z.number().int().min(1).max(365).default(180),  // Moderation logs: 180 days
  }),
  dryRun: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export type ChatRetentionConfig = z.infer<typeof ChatRetentionConfigSchema>;

export interface ChatRetentionResult {
  success: boolean;
  channelsProcessed: number;
  totalScanned: number;
  totalPurged: number;
  errors: number;
  durationMs: number;
  nextRun?: Date;
  breakdown: Record<string, { scanned: number; purged: number; errors: number }>;
}

export interface ChatRetentionStats {
  lastRun?: Date;
  lastResult?: ChatRetentionResult;
  totalRuns: number;
  totalPurged: number;
  averageDurationMs: number;
  purgedByChannelType: Record<string, number>;
}

/**
 * Chat retention purge job implementing FR-007: Tiered chat retention policies
 * Removes expired chat messages based on channel-specific retention periods
 */
export class ChatRetentionJob {
  private readonly serviceLogger = createServiceLogger('ChatRetentionJob');
  private readonly config: ChatRetentionConfig;
  private retentionTimer?: NodeJS.Timeout | undefined;
  private isRunning = false;
  private stats: ChatRetentionStats = {
    totalRuns: 0,
    totalPurged: 0,
    averageDurationMs: 0,
    purgedByChannelType: {},
  };

  constructor(
    private readonly chatRepo: IChatRepository,
    config: Partial<ChatRetentionConfig> = {}
  ) {
    this.config = ChatRetentionConfigSchema.parse(config);
    
    this.serviceLogger.info({
      event: 'chat_retention_job_initialized',
      config: this.config,
    }, 'Chat retention job initialized');
  }

  /**
   * Start the chat retention job with scheduled runs
   */
  start(): void {
    if (this.retentionTimer) {
      this.serviceLogger.warn({
        event: 'chat_retention_already_running',
      }, 'Chat retention job is already running');
      return;
    }

    if (!this.config.enabled) {
      this.serviceLogger.info({
        event: 'chat_retention_disabled',
      }, 'Chat retention job is disabled');
      return;
    }

    this.serviceLogger.info({
      event: 'chat_retention_job_started',
      intervalMs: this.config.intervalMs,
      retentionPolicies: this.config.retentionPolicies,
    }, 'Starting chat retention job');

    // Run immediately on start
    this.runRetention().catch(error => {
      this.serviceLogger.error({
        event: 'chat_retention_initial_run_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Initial chat retention run failed');
    });

    // Schedule periodic runs
    this.retentionTimer = setInterval(async () => {
      try {
        await this.runRetention();
      } catch (error) {
        this.serviceLogger.error({
          event: 'chat_retention_scheduled_run_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Scheduled chat retention run failed');
      }
    }, this.config.intervalMs);
  }

  /**
   * Stop the chat retention job
   */
  stop(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = undefined;
      
      this.serviceLogger.info({
        event: 'chat_retention_job_stopped',
      }, 'Chat retention job stopped');
    }
  }

  /**
   * Run a single chat retention operation
   */
  async runRetention(): Promise<ChatRetentionResult> {
    if (this.isRunning) {
      this.serviceLogger.warn({
        event: 'chat_retention_already_running',
      }, 'Chat retention is already running, skipping this run');
      
      return {
        success: false,
        channelsProcessed: 0,
        totalScanned: 0,
        totalPurged: 0,
        errors: 0,
        durationMs: 0,
        breakdown: {},
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    let channelsProcessed = 0;
    let totalScanned = 0;
    let totalPurged = 0;
    let errors = 0;
    const breakdown: Record<string, { scanned: number; purged: number; errors: number }> = {};

    try {
      this.serviceLogger.info({
        event: 'chat_retention_started',
        dryRun: this.config.dryRun,
        retentionPolicies: this.config.retentionPolicies,
        batchSize: this.config.batchSize,
      }, 'Starting chat retention operation');

      // Process each channel type according to its retention policy
      for (const [channelType, retentionDays] of Object.entries(this.config.retentionPolicies)) {
        try {
          channelsProcessed++;
          
          this.serviceLogger.debug({
            event: 'chat_retention_processing_channel_type',
            channelType: channelType,
            retentionDays: retentionDays,
          }, `Processing ${channelType} channels`);

          const result = await this.processChannelType(channelType, retentionDays);
          
          breakdown[channelType] = {
            scanned: result.scanned,
            purged: result.purged,
            errors: result.errors,
          };
          
          totalScanned += result.scanned;
          totalPurged += result.purged;
          errors += result.errors;

          this.serviceLogger.debug({
            event: 'chat_retention_channel_type_completed',
            channelType: channelType,
            scanned: result.scanned,
            purged: result.purged,
            errors: result.errors,
          }, `Completed ${channelType} channels: ${result.purged}/${result.scanned} purged`);
          
          // Small delay between channel types to avoid overwhelming the system
          await this.delay(500);
        } catch (error) {
          errors++;
          breakdown[channelType] = { scanned: 0, purged: 0, errors: 1 };
          
          this.serviceLogger.error({
            event: 'chat_retention_channel_type_error',
            channelType: channelType,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, `Failed to process ${channelType} channels`);
        }
      }

      const durationMs = Date.now() - startTime;
      const result: ChatRetentionResult = {
        success: errors === 0,
        channelsProcessed: channelsProcessed,
        totalScanned: totalScanned,
        totalPurged: totalPurged,
        errors: errors,
        durationMs: durationMs,
        nextRun: new Date(Date.now() + this.config.intervalMs),
        breakdown: breakdown,
      };

      this.updateStats(result);

      this.serviceLogger.info({
        event: 'chat_retention_completed',
        result: result,
      }, `Chat retention completed: ${totalPurged}/${totalScanned} messages purged across ${channelsProcessed} channel types`);

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      this.serviceLogger.error({
        event: 'chat_retention_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        channelsProcessed: channelsProcessed,
        totalScanned: totalScanned,
        totalPurged: totalPurged,
        errors: errors,
        durationMs: durationMs,
      }, 'Chat retention operation failed');

      return {
        success: false,
        channelsProcessed: channelsProcessed,
        totalScanned: totalScanned,
        totalPurged: totalPurged,
        errors: errors + 1,
        durationMs: durationMs,
        breakdown: breakdown,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get current job statistics
   */
  getStats(): ChatRetentionStats {
    return { ...this.stats };
  }

  /**
   * Get current job configuration
   */
  getConfig(): ChatRetentionConfig {
    return { ...this.config };
  }

  /**
   * Check if job is currently running
   */
  getStatus(): { isRunning: boolean; isScheduled: boolean; nextRun?: Date | undefined } {
    return {
      isRunning: this.isRunning,
      isScheduled: !!this.retentionTimer,
      nextRun: this.stats.lastResult?.nextRun,
    };
  }

  /**
   * Process retention for a specific channel type
   */
  private async processChannelType(
    channelType: string, 
    retentionDays: number
  ): Promise<{ scanned: number; purged: number; errors: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let scanned = 0;
    let purged = 0;
    let errors = 0;
    let offset = 0;

    try {
      // Process messages in batches to avoid memory issues
      while (true) {
        const messages = await this.chatRepo.findExpiredMessages(
          channelType,
          cutoffDate,
          this.config.batchSize,
          offset
        );

        if (messages.length === 0) {
          break; // No more messages to process
        }

        scanned += messages.length;

        const batchResult = await this.purgeBatch(messages, channelType);
        purged += batchResult.purged;
        errors += batchResult.errors;

        // If we got fewer messages than batch size, we're done
        if (messages.length < this.config.batchSize) {
          break;
        }

        offset += messages.length;
        
        // Small delay between batches
        await this.delay(100);
      }
    } catch (error) {
      this.serviceLogger.error({
        event: 'chat_retention_channel_process_error',
        channelType: channelType,
        error: error instanceof Error ? error.message : 'Unknown error',
        scanned: scanned,
        purged: purged,
      }, `Error processing ${channelType} channel retention`);
      errors++;
    }

    return { scanned, purged, errors };
  }

  /**
   * Purge a batch of expired chat messages
   */
  private async purgeBatch(
    messages: ChatMessage[], 
    channelType: string
  ): Promise<{ purged: number; errors: number }> {
    let purged = 0;
    let errors = 0;

    for (const message of messages) {
      try {
        if (this.config.dryRun) {
          this.serviceLogger.info({
            event: 'chat_retention_dry_run',
            messageId: message.id,
            channelType: channelType,
            channelId: message.channelId,
            createdAt: message.createdAt,
          }, `[DRY RUN] Would purge message: ${message.id}`);
          purged++;
        } else {
          const deleted = await this.chatRepo.deleteMessage(message.id);
          
          if (deleted) {
            purged++;
            this.serviceLogger.debug({
              event: 'chat_message_purged',
              messageId: message.id,
              channelType: channelType,
              channelId: message.channelId,
              createdAt: message.createdAt,
              senderPlayerId: message.senderPlayerId,
            }, `Purged message: ${message.id}`);
          } else {
            errors++;
            this.serviceLogger.warn({
              event: 'chat_message_purge_failed',
              messageId: message.id,
              channelType: channelType,
              reason: 'delete_returned_false',
            }, `Failed to purge message: ${message.id}`);
          }
        }
      } catch (error) {
        errors++;
        this.serviceLogger.error({
          event: 'chat_message_purge_error',
          messageId: message.id,
          channelType: channelType,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, `Error purging message: ${message.id}`);
      }
    }

    return { purged, errors };
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
  private updateStats(result: ChatRetentionResult): void {
    this.stats.lastRun = new Date();
    this.stats.lastResult = result;
    this.stats.totalRuns++;
    this.stats.totalPurged += result.totalPurged;
    
    // Update channel-specific purge counts
    for (const [channelType, breakdown] of Object.entries(result.breakdown)) {
      const currentCount = this.stats.purgedByChannelType[channelType] || 0;
      this.stats.purgedByChannelType[channelType] = currentCount + breakdown.purged;
    }
    
    // Update average duration
    const totalDuration = this.stats.averageDurationMs * (this.stats.totalRuns - 1) + result.durationMs;
    this.stats.averageDurationMs = Math.round(totalDuration / this.stats.totalRuns);
  }
}

/**
 * Factory function to create ChatRetentionJob instance
 */
export function createChatRetentionJob(
  chatRepo: IChatRepository,
  config?: Partial<ChatRetentionConfig>
): ChatRetentionJob {
  return new ChatRetentionJob(chatRepo, config);
}