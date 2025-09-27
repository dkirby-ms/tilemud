import { z } from 'zod';
import { IReplayRepository } from '../../infra/persistence/replayRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  ReplayMetadata, 
  CreateReplayInput 
} from '../../domain/entities/replay';

// Replay writer schemas
export const ReplayEventInputSchema = z.object({
  type: z.string().min(1),
  playerId: z.string().uuid().optional(),
  data: z.record(z.unknown()),
  metadata: z.object({
    tick: z.number().int().min(0).optional(),
    roomId: z.string().optional(),
  }).optional(),
});

export const ReplayWriterConfigSchema = z.object({
  batchSize: z.number().int().min(1).max(1000).default(100),
  flushIntervalMs: z.number().int().min(100).max(30000).default(5000),
  maxBufferSize: z.number().int().min(1000).max(100000).default(10000),
  enableCompression: z.boolean().default(true),
});

export type ReplayEventInput = z.infer<typeof ReplayEventInputSchema>;
export type ReplayWriterConfig = z.infer<typeof ReplayWriterConfigSchema>;

export interface ReplayWriteResult {
  success: boolean;
  eventsWritten?: number;
  error?: string;
  errorCode?: 'REPLAY_NOT_FOUND' | 'BUFFER_OVERFLOW' | 'INVALID_EVENT' | 'WRITE_FAILED';
}

export interface ReplayFinalizeResult {
  success: boolean;
  replay?: ReplayMetadata | undefined;
  totalEvents?: number | undefined;
  finalSize?: number | undefined;
  error?: string;
}

/**
 * Replay writer service implementing FR-017: Event capture and replay generation
 * Handles buffered event writing, batch processing, and replay finalization
 */
export class ReplayWriter {
  private readonly serviceLogger = createServiceLogger('ReplayWriter');
  
  // Event buffers for each active replay - simplified to store raw event data
  private readonly eventBuffers = new Map<string, ReplayEventInput[]>();
  private readonly sequenceCounters = new Map<string, number>();
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();
  private readonly config: ReplayWriterConfig;
  
  constructor(
    private readonly replayRepo: IReplayRepository,
    config: Partial<ReplayWriterConfig> = {}
  ) {
    // Merge with default config
    this.config = ReplayWriterConfigSchema.parse(config);
  }

  /**
   * Initialize a new replay recording session
   */
  async initializeReplay(instanceId: string): Promise<string> {
    try {
      const replayInput: CreateReplayInput = {
        instanceId,
        storageRef: `replays/${instanceId}/${Date.now()}.jsonl`,
      };

      const replay = await this.replayRepo.createReplay(replayInput);
      
      // Initialize buffers
      this.eventBuffers.set(replay.id, []);
      this.sequenceCounters.set(replay.id, 0);
      
      // Start flush timer
      this.startFlushTimer(replay.id);

      this.serviceLogger.info({
        event: 'replay_initialized',
        replayId: replay.id,
        instanceId: instanceId,
        storageRef: replayInput.storageRef,
      }, `Replay initialized for instance: ${instanceId}`);

      return replay.id;
    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_init_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        instanceId: instanceId,
      }, 'Failed to initialize replay');
      throw error;
    }
  }

  /**
   * Append an event to the replay buffer
   */
  async appendEvent(replayId: string, eventInput: ReplayEventInput): Promise<ReplayWriteResult> {
    try {
      // Validate input
      const validatedEvent = ReplayEventInputSchema.parse(eventInput);
      
      const buffer = this.eventBuffers.get(replayId);
      if (!buffer) {
        this.serviceLogger.warn({
          event: 'replay_buffer_not_found',
          replayId: replayId,
          eventType: validatedEvent.type,
        }, 'Replay buffer not found');

        return {
          success: false,
          error: 'Replay not found or not recording',
          errorCode: 'REPLAY_NOT_FOUND',
        };
      }

      // Check buffer size limits
      if (buffer.length >= this.config.maxBufferSize) {
        this.serviceLogger.warn({
          event: 'replay_buffer_overflow',
          replayId: replayId,
          bufferSize: buffer.length,
          maxBufferSize: this.config.maxBufferSize,
        }, 'Replay buffer overflow');

        // Force flush and continue
        await this.flushBuffer(replayId);
      }

      // Increment sequence number
      const currentSeq = this.sequenceCounters.get(replayId) || 0;
      this.sequenceCounters.set(replayId, currentSeq + 1);

      // Add to buffer
      buffer.push(validatedEvent);

      // Check if we should flush
      if (buffer.length >= this.config.batchSize) {
        await this.flushBuffer(replayId);
      }

      this.serviceLogger.debug({
        event: 'replay_event_buffered',
        replayId: replayId,
        seq: currentSeq,
        type: validatedEvent.type,
        bufferSize: buffer.length,
      }, `Event buffered: ${validatedEvent.type}`);

      return {
        success: true,
        eventsWritten: 1,
      };
    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_append_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        replayId: replayId,
        eventType: eventInput.type,
      }, 'Failed to append replay event');

      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: 'Invalid event data',
          errorCode: 'INVALID_EVENT',
        };
      }

      return {
        success: false,
        error: 'Failed to write event',
        errorCode: 'WRITE_FAILED',
      };
    }
  }

  /**
   * Finalize a replay recording session
   */
  async finalizeReplay(replayId: string): Promise<ReplayFinalizeResult> {
    try {
      // Final flush of any remaining events
      await this.flushBuffer(replayId);
      
      // Clear timers and buffers
      this.clearReplayData(replayId);
      
      // Finalize the replay
      const totalEvents = this.sequenceCounters.get(replayId) || 0;
      const completedAt = new Date();
      
      const updatedReplay = await this.replayRepo.finalizeReplay(replayId);

      this.serviceLogger.info({
        event: 'replay_finalized',
        replayId: replayId,
        totalEvents: totalEvents,
        completedAt: completedAt,
        sizeBytes: updatedReplay?.sizeBytes,
      }, `Replay finalized: ${replayId}`);

      return {
        success: true,
        replay: updatedReplay || undefined,
        totalEvents: totalEvents,
        finalSize: updatedReplay?.sizeBytes,
      };
    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_finalize_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        replayId: replayId,
      }, 'Failed to finalize replay');

      return {
        success: false,
        error: 'Failed to finalize replay',
      };
    }
  }

  /**
   * Flush buffered events to persistent storage
   */
  private async flushBuffer(replayId: string): Promise<void> {
    const buffer = this.eventBuffers.get(replayId);
    if (!buffer || buffer.length === 0) {
      return;
    }

    try {
      // Convert buffered events to proper ReplayEvent format and write to repository
      const eventsToWrite = [...buffer];
      buffer.length = 0; // Clear buffer

      let seq = this.sequenceCounters.get(replayId) || 0;
      
      for (const eventInput of eventsToWrite) {
        const replayEvent = {
          seq: seq++,
          timestamp: Date.now(),
          type: eventInput.type,
          playerId: eventInput.playerId,
          data: eventInput.data,
          metadata: eventInput.metadata,
        };

        await this.replayRepo.recordEvent({
          replayId: replayId,
          event: replayEvent as any // Type assertion to work around strict typing
        });
      }

      this.serviceLogger.debug({
        event: 'replay_buffer_flushed',
        replayId: replayId,
        eventCount: eventsToWrite.length,
      }, `Flushed ${eventsToWrite.length} events to storage`);
    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_flush_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        replayId: replayId,
        bufferSize: buffer.length,
      }, 'Failed to flush replay buffer');
      
      // Re-add events to buffer on failure
      buffer.push(...buffer);
      throw error;
    }
  }

  /**
   * Start flush timer for a replay
   */
  private startFlushTimer(replayId: string): void {
    const existingTimer = this.flushTimers.get(replayId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    const timer = setInterval(async () => {
      try {
        await this.flushBuffer(replayId);
      } catch (error) {
        this.serviceLogger.error({
          event: 'replay_timer_flush_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          replayId: replayId,
        }, 'Timer-based flush failed');
      }
    }, this.config.flushIntervalMs);

    this.flushTimers.set(replayId, timer);
  }

  /**
   * Clear all data for a replay
   */
  private clearReplayData(replayId: string): void {
    // Clear timer
    const timer = this.flushTimers.get(replayId);
    if (timer) {
      clearInterval(timer);
      this.flushTimers.delete(replayId);
    }

    // Clear buffers
    this.eventBuffers.delete(replayId);
    this.sequenceCounters.delete(replayId);
  }

  /**
   * Cleanup method to be called on shutdown
   */
  async shutdown(): Promise<void> {
    this.serviceLogger.info({
      event: 'replay_writer_shutdown',
      activeReplays: this.eventBuffers.size,
    }, 'Shutting down replay writer');

    // Finalize all active replays
    const activeReplays = Array.from(this.eventBuffers.keys());
    await Promise.all(
      activeReplays.map(replayId => this.finalizeReplay(replayId))
    );

    // Clear all timers
    this.flushTimers.forEach(timer => clearInterval(timer));
    this.flushTimers.clear();
  }
}

/**
 * Factory function to create ReplayWriter instance
 */
export function createReplayWriter(
  replayRepo: IReplayRepository,
  config?: Partial<ReplayWriterConfig>
): ReplayWriter {
  return new ReplayWriter(replayRepo, config);
}