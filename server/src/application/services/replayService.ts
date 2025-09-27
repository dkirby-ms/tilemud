import { z } from 'zod';
import { IReplayRepository } from '../../infra/persistence/replayRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  ReplayMetadata, 
  CreateReplayInput,
  ReplayEvent,
  isReplayAvailable,
  isReplayExpired,
  REPLAY_RETENTION_DAYS
} from '../../domain/entities/replay';

// Replay service schemas
export const ReplayQuerySchema = z.object({
  replayId: z.string().uuid(),
  requesterId: z.string().uuid().optional(),
});

export const ReplaySearchFiltersSchema = z.object({
  instanceId: z.string().uuid().optional(),
  playerId: z.string().uuid().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type ReplayQuery = z.infer<typeof ReplayQuerySchema>;
export type ReplaySearchFilters = z.infer<typeof ReplaySearchFiltersSchema>;

export interface ReplayAccessResult {
  success: boolean;
  replay?: ReplayMetadata;
  events?: ReplayEvent[];
  error?: string;
  errorCode?: 'NOT_FOUND' | 'EXPIRED' | 'ACCESS_DENIED' | 'INVALID_FORMAT';
}

export interface ReplayListResult {
  replays: ReplayMetadata[];
  totalCount: number;
  hasMore: boolean;
}

/**
 * Replay service implementing FR-017: Replay capture and retrieval
 * Handles replay metadata, event streaming, and retention policies
 */
export class ReplayService {
  private readonly serviceLogger = createServiceLogger('ReplayService');

  constructor(private readonly replayRepo: IReplayRepository) {}

  /**
   * Retrieve replay metadata and validate access
   */
  async getReplayMetadata(query: ReplayQuery): Promise<ReplayAccessResult> {
    try {
      const validatedQuery = ReplayQuerySchema.parse(query);

      this.serviceLogger.debug({
        event: 'replay_metadata_request',
        replayId: validatedQuery.replayId,
        requesterId: validatedQuery.requesterId,
      }, 'Processing replay metadata request');

      // Get replay from repository
      const replay = await this.replayRepo.findReplayById(validatedQuery.replayId);
      if (!replay) {
        this.serviceLogger.info({
          event: 'replay_not_found',
          replayId: validatedQuery.replayId,
          requesterId: validatedQuery.requesterId,
        }, 'Replay not found');

        return {
          success: false,
          error: 'Replay not found',
          errorCode: 'NOT_FOUND',
        };
      }

      // Check if replay is expired
      if (isReplayExpired(replay.expiresAt)) {
        this.serviceLogger.info({
          event: 'replay_expired',
          replayId: validatedQuery.replayId,
          expiresAt: replay.expiresAt,
          requesterId: validatedQuery.requesterId,
        }, 'Replay has expired');

        return {
          success: false,
          error: 'Replay has expired and is no longer available',
          errorCode: 'EXPIRED',
        };
      }

      // Check if replay is available (completed status)
      if (!isReplayAvailable(replay)) {
        this.serviceLogger.warn({
          event: 'replay_unavailable',
          replayId: validatedQuery.replayId,
          status: replay.status,
          requesterId: validatedQuery.requesterId,
        }, 'Replay is not available for viewing');

        return {
          success: false,
          error: 'Replay is not available for viewing',
          errorCode: 'INVALID_FORMAT',
        };
      }

      // TODO: Implement access control based on replay privacy settings
      // For now, all completed replays are accessible

      this.serviceLogger.debug({
        event: 'replay_metadata_retrieved',
        replayId: validatedQuery.replayId,
        status: replay.status,
        eventCount: replay.eventCount,
        sizeBytes: replay.sizeBytes,
        requesterId: validatedQuery.requesterId,
      }, 'Replay metadata retrieved successfully');

      return {
        success: true,
        replay,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_metadata_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        replayId: query.replayId,
        requesterId: query.requesterId,
      }, 'Failed to get replay metadata');

      return {
        success: false,
        error: 'Failed to retrieve replay metadata',
        errorCode: 'INVALID_FORMAT',
      };
    }
  }

  /**
   * Retrieve replay events for playback
   */
  async getReplayEvents(query: ReplayQuery): Promise<ReplayAccessResult> {
    try {
      // First validate access to replay
      const metadataResult = await this.getReplayMetadata(query);
      if (!metadataResult.success || !metadataResult.replay) {
        return metadataResult;
      }

      const replay = metadataResult.replay;

      this.serviceLogger.debug({
        event: 'replay_events_request',
        replayId: query.replayId,
        eventCount: replay.eventCount,
        requesterId: query.requesterId,
      }, 'Loading replay events for playback');

      // Get events from repository
      const events = await this.replayRepo.getEventsByReplay(query.replayId);

      this.serviceLogger.debug({
        event: 'replay_events_loaded',
        replayId: query.replayId,
        eventCount: events.length,
        expectedCount: replay.eventCount,
        requesterId: query.requesterId,
      }, `Loaded ${events.length} replay events`);

      return {
        success: true,
        replay,
        events,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_events_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        replayId: query.replayId,
        requesterId: query.requesterId,
      }, 'Failed to get replay events');

      return {
        success: false,
        error: 'Failed to retrieve replay events',
        errorCode: 'INVALID_FORMAT',
      };
    }
  }

  /**
   * Stream replay events for efficient large replay playback
   */
  async *streamReplayEvents(query: ReplayQuery): AsyncIterable<ReplayEvent> {
    try {
      // Validate access first
      const metadataResult = await this.getReplayMetadata(query);
      if (!metadataResult.success || !metadataResult.replay) {
        this.serviceLogger.warn({
          event: 'replay_stream_access_denied',
          replayId: query.replayId,
          requesterId: query.requesterId,
          error: metadataResult.error,
        }, 'Access denied for replay stream');
        return;
      }

      this.serviceLogger.debug({
        event: 'replay_stream_started',
        replayId: query.replayId,
        requesterId: query.requesterId,
      }, 'Starting replay event stream');

      let eventCount = 0;
      
      // Stream events from repository
      for await (const event of this.replayRepo.getEventsStream(query.replayId)) {
        eventCount++;
        yield event;
      }

      this.serviceLogger.debug({
        event: 'replay_stream_completed',
        replayId: query.replayId,
        eventCount,
        requesterId: query.requesterId,
      }, `Replay stream completed with ${eventCount} events`);

    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_stream_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        replayId: query.replayId,
        requesterId: query.requesterId,
      }, 'Replay stream failed');
    }
  }

  /**
   * Search for replays based on filters
   */
  async searchReplays(filters: ReplaySearchFilters): Promise<ReplayListResult> {
    try {
      const validatedFilters = ReplaySearchFiltersSchema.parse(filters);

      this.serviceLogger.debug({
        event: 'replay_search_request',
        filters: validatedFilters,
      }, 'Processing replay search request');

      let replays: ReplayMetadata[] = [];

      // Search by instance ID
      if (validatedFilters.instanceId) {
        replays = await this.replayRepo.findReplaysByInstance(validatedFilters.instanceId);
      }
      // Search by player ID
      else if (validatedFilters.playerId) {
        replays = await this.replayRepo.findReplaysByPlayer(validatedFilters.playerId);
      }
      // TODO: Implement general search with date filters
      else {
        this.serviceLogger.warn({
          event: 'unsupported_search',
          filters: validatedFilters,
        }, 'Search without instance or player ID not yet implemented');
        replays = [];
      }

      // Filter out expired replays
      const availableReplays = replays.filter(replay => 
        isReplayAvailable(replay) && !isReplayExpired(replay.expiresAt)
      );

      // Apply date filters if provided
      let filteredReplays = availableReplays;
      if (validatedFilters.startDate || validatedFilters.endDate) {
        filteredReplays = availableReplays.filter(replay => {
          if (validatedFilters.startDate && replay.createdAt < validatedFilters.startDate) {
            return false;
          }
          if (validatedFilters.endDate && replay.createdAt > validatedFilters.endDate) {
            return false;
          }
          return true;
        });
      }

      // Sort by creation date (newest first)
      filteredReplays.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Apply pagination
      const totalCount = filteredReplays.length;
      const paginatedReplays = filteredReplays.slice(
        validatedFilters.offset,
        validatedFilters.offset + validatedFilters.limit
      );
      const hasMore = validatedFilters.offset + validatedFilters.limit < totalCount;

      this.serviceLogger.debug({
        event: 'replay_search_completed',
        totalCount,
        returnedCount: paginatedReplays.length,
        hasMore,
        filters: validatedFilters,
      }, `Replay search returned ${paginatedReplays.length} results`);

      return {
        replays: paginatedReplays,
        totalCount,
        hasMore,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_search_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
      }, 'Replay search failed');

      return {
        replays: [],
        totalCount: 0,
        hasMore: false,
      };
    }
  }

  /**
   * Get replay statistics and health metrics
   */
  async getReplayStats(): Promise<{
    totalReplays: number;
    availableReplays: number;
    expiredReplays: number;
    totalSizeBytes: number;
    retentionDays: number;
  }> {
    try {
      this.serviceLogger.debug({
        event: 'replay_stats_request',
      }, 'Processing replay statistics request');

      // This would need to be implemented in the repository layer
      // For now, return basic stats structure
      const stats = {
        totalReplays: 0,
        availableReplays: 0,
        expiredReplays: 0,
        totalSizeBytes: 0,
        retentionDays: REPLAY_RETENTION_DAYS,
      };

      // TODO: Implement actual stats gathering from repository
      this.serviceLogger.debug({
        event: 'replay_stats_completed',
        stats,
      }, 'Replay statistics calculated');

      return stats;

    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_stats_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to get replay statistics');

      // Return zero stats on error
      return {
        totalReplays: 0,
        availableReplays: 0,
        expiredReplays: 0,
        totalSizeBytes: 0,
        retentionDays: REPLAY_RETENTION_DAYS,
      };
    }
  }

  /**
   * Validate replay integrity
   */
  async validateReplay(replayId: string): Promise<{
    valid: boolean;
    issues: string[];
    eventCount: number;
    expectedEventCount: number;
  }> {
    try {
      this.serviceLogger.debug({
        event: 'replay_validation_request',
        replayId,
      }, 'Starting replay validation');

      const isValid = await this.replayRepo.validateReplayIntegrity(replayId);
      const replay = await this.replayRepo.findReplayById(replayId);
      
      const issues: string[] = [];
      if (!replay) {
        issues.push('Replay metadata not found');
      }
      if (!isValid) {
        issues.push('Replay event sequence integrity check failed');
      }

      const result = {
        valid: isValid && !!replay,
        issues,
        eventCount: 0, // Would be calculated during validation
        expectedEventCount: replay?.eventCount || 0,
      };

      this.serviceLogger.debug({
        event: 'replay_validation_completed',
        replayId,
        valid: result.valid,
        issuesCount: issues.length,
      }, `Replay validation completed: ${result.valid ? 'valid' : 'invalid'}`);

      return result;

    } catch (error) {
      this.serviceLogger.error({
        event: 'replay_validation_error',
        replayId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Replay validation failed');

      return {
        valid: false,
        issues: ['Validation process failed'],
        eventCount: 0,
        expectedEventCount: 0,
      };
    }
  }
}

// Factory function
export function createReplayService(replayRepo: IReplayRepository): ReplayService {
  return new ReplayService(replayRepo);
}