import { z } from 'zod';
import { IPlayersRepository } from '../../infra/persistence/playersRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';

// Block list middleware configuration
export const BlockListConfigSchema = z.object({
  enabled: z.boolean().default(true),
  cacheTtlMs: z.number().int().min(1000).max(24 * 60 * 60 * 1000).default(5 * 60 * 1000), // 5 minutes default
  logBlocked: z.boolean().default(true),
  logCacheStats: z.boolean().default(false),
});

export type BlockListConfig = z.infer<typeof BlockListConfigSchema>;

export interface BlockCheckResult {
  blocked: boolean;
  reason?: string | undefined;
  blockedBy?: string | undefined;
  bidirectional?: boolean | undefined;
}

export interface BlockCacheEntry {
  blocked: boolean;
  blockedBy?: string | undefined;
  bidirectional?: boolean | undefined;
  cachedAt: number;
}

export interface BlockListStats {
  cacheHits: number;
  cacheMisses: number;
  blockedAttempts: number;
  totalChecks: number;
  cacheSize: number;
  lastCacheClean?: Date;
}

/**
 * Block list enforcement middleware for chat and direct messages (FR-014)
 * Provides efficient block list checking with caching and logging
 */
export class BlockListMiddleware {
  private readonly serviceLogger = createServiceLogger('BlockListMiddleware');
  private readonly config: BlockListConfig;
  private readonly blockCache = new Map<string, BlockCacheEntry>();
  private stats: BlockListStats = {
    cacheHits: 0,
    cacheMisses: 0,
    blockedAttempts: 0,
    totalChecks: 0,
    cacheSize: 0,
  };
  private cacheCleanupTimer?: NodeJS.Timeout | undefined;

  constructor(
    private readonly playersRepo: IPlayersRepository,
    config: Partial<BlockListConfig> = {}
  ) {
    this.config = BlockListConfigSchema.parse(config);
    
    this.serviceLogger.info({
      event: 'block_list_middleware_initialized',
      config: this.config,
    }, 'Block list middleware initialized');

    // Start cache cleanup timer
    this.startCacheCleanup();
  }

  /**
   * Check if communication between two players is blocked
   */
  async checkBlock(fromPlayerId: string, toPlayerId: string): Promise<BlockCheckResult> {
    if (!this.config.enabled) {
      return { blocked: false };
    }

    // Don't block communication with self
    if (fromPlayerId === toPlayerId) {
      return { blocked: false };
    }

    this.stats.totalChecks++;

    try {
      // Check cache first
      const cacheKey = this.createCacheKey(fromPlayerId, toPlayerId);
      const cached = this.getCachedResult(cacheKey);
      
      if (cached) {
        this.stats.cacheHits++;
        
        if (this.config.logCacheStats) {
          this.serviceLogger.debug({
            event: 'block_check_cache_hit',
            fromPlayerId: fromPlayerId,
            toPlayerId: toPlayerId,
            blocked: cached.blocked,
            cachedAt: new Date(cached.cachedAt),
          }, 'Block check cache hit');
        }

        const result: BlockCheckResult = {
          blocked: cached.blocked,
          blockedBy: cached.blockedBy,
          bidirectional: cached.bidirectional,
        };

        if (result.blocked) {
          this.stats.blockedAttempts++;
          this.logBlockedAttempt(fromPlayerId, toPlayerId, result, 'cached');
        }

        return result;
      }

      // Cache miss - check repository
      this.stats.cacheMisses++;
      
      this.serviceLogger.debug({
        event: 'block_check_repository_query',
        fromPlayerId: fromPlayerId,
        toPlayerId: toPlayerId,
      }, 'Querying repository for block status');

      // Check both directions for blocking
      const [isFromBlocked, isToBlocked] = await Promise.all([
        this.playersRepo.isPlayerBlocked(fromPlayerId, toPlayerId),
        this.playersRepo.isPlayerBlocked(toPlayerId, fromPlayerId),
      ]);

      const blocked = isFromBlocked || isToBlocked;
      const blockedBy = isFromBlocked ? fromPlayerId : (isToBlocked ? toPlayerId : undefined);
      const bidirectional = isFromBlocked && isToBlocked;

      const result: BlockCheckResult = {
        blocked: blocked,
        reason: blocked ? 'blocked_by_user' : undefined,
        blockedBy: blockedBy,
        bidirectional: bidirectional,
      };

      // Cache the result
      this.cacheResult(cacheKey, {
        blocked: result.blocked,
        blockedBy: result.blockedBy,
        bidirectional: result.bidirectional,
        cachedAt: Date.now(),
      });

      if (result.blocked) {
        this.stats.blockedAttempts++;
        this.logBlockedAttempt(fromPlayerId, toPlayerId, result, 'repository');
      }

      this.serviceLogger.debug({
        event: 'block_check_completed',
        fromPlayerId: fromPlayerId,
        toPlayerId: toPlayerId,
        blocked: result.blocked,
        blockedBy: result.blockedBy,
        bidirectional: result.bidirectional,
        source: 'repository',
      }, `Block check completed: ${result.blocked ? 'BLOCKED' : 'ALLOWED'}`);

      return result;
    } catch (error) {
      this.serviceLogger.error({
        event: 'block_check_error',
        fromPlayerId: fromPlayerId,
        toPlayerId: toPlayerId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Error checking block status');

      // On error, allow communication (fail open)
      return { 
        blocked: false, 
        reason: 'check_failed' 
      };
    }
  }

  /**
   * Check if a player can send messages to multiple recipients (group chat scenarios)
   */
  async checkMultipleBlocks(fromPlayerId: string, toPlayerIds: string[]): Promise<{
    allowed: string[];
    blocked: { playerId: string; result: BlockCheckResult }[];
  }> {
    const allowed: string[] = [];
    const blocked: { playerId: string; result: BlockCheckResult }[] = [];

    // Check each recipient
    const checks = toPlayerIds.map(async (toPlayerId) => {
      const result = await this.checkBlock(fromPlayerId, toPlayerId);
      return { playerId: toPlayerId, result };
    });

    const results = await Promise.all(checks);

    for (const { playerId, result } of results) {
      if (result.blocked) {
        blocked.push({ playerId, result });
      } else {
        allowed.push(playerId);
      }
    }

    this.serviceLogger.debug({
      event: 'multiple_block_check_completed',
      fromPlayerId: fromPlayerId,
      totalRecipients: toPlayerIds.length,
      allowedCount: allowed.length,
      blockedCount: blocked.length,
    }, `Multiple block check: ${allowed.length}/${toPlayerIds.length} recipients allowed`);

    return { allowed, blocked };
  }

  /**
   * Invalidate cached block status for a specific player pair
   */
  invalidateCache(playerId1: string, playerId2: string): void {
    const cacheKey = this.createCacheKey(playerId1, playerId2);
    this.blockCache.delete(cacheKey);
    this.stats.cacheSize = this.blockCache.size;

    this.serviceLogger.debug({
      event: 'block_cache_invalidated',
      playerId1: playerId1,
      playerId2: playerId2,
      cacheKey: cacheKey,
    }, 'Block cache entry invalidated');
  }

  /**
   * Clear all cached block data for a player (when their block list changes)
   */
  invalidatePlayerCache(playerId: string): void {
    let invalidatedCount = 0;

    for (const cacheKey of Array.from(this.blockCache.keys())) {
      if (cacheKey.includes(playerId)) {
        this.blockCache.delete(cacheKey);
        invalidatedCount++;
      }
    }

    this.stats.cacheSize = this.blockCache.size;

    this.serviceLogger.info({
      event: 'player_block_cache_invalidated',
      playerId: playerId,
      invalidatedCount: invalidatedCount,
    }, `Invalidated ${invalidatedCount} cache entries for player ${playerId}`);
  }

  /**
   * Clear entire cache (useful for testing or configuration changes)
   */
  clearCache(): void {
    const previousSize = this.blockCache.size;
    this.blockCache.clear();
    this.stats.cacheSize = 0;

    this.serviceLogger.info({
      event: 'block_cache_cleared',
      previousSize: previousSize,
    }, 'Block list cache cleared');
  }

  /**
   * Get current middleware statistics
   */
  getStats(): BlockListStats {
    return {
      ...this.stats,
      cacheSize: this.blockCache.size,
    };
  }

  /**
   * Get current middleware configuration
   */
  getConfig(): BlockListConfig {
    return { ...this.config };
  }

  /**
   * Shutdown the middleware and clean up resources
   */
  shutdown(): void {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }

    this.clearCache();

    this.serviceLogger.info({
      event: 'block_list_middleware_shutdown',
      finalStats: this.getStats(),
    }, 'Block list middleware shut down');
  }

  /**
   * Create a consistent cache key for player pairs
   */
  private createCacheKey(playerId1: string, playerId2: string): string {
    // Sort to ensure consistent key regardless of order
    return playerId1 < playerId2 ? `${playerId1}:${playerId2}` : `${playerId2}:${playerId1}`;
  }

  /**
   * Get cached block result if valid and not expired
   */
  private getCachedResult(cacheKey: string): BlockCacheEntry | null {
    const cached = this.blockCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    const isExpired = Date.now() - cached.cachedAt > this.config.cacheTtlMs;
    if (isExpired) {
      this.blockCache.delete(cacheKey);
      this.stats.cacheSize = this.blockCache.size;
      return null;
    }

    return cached;
  }

  /**
   * Cache a block check result
   */
  private cacheResult(cacheKey: string, entry: BlockCacheEntry): void {
    this.blockCache.set(cacheKey, entry);
    this.stats.cacheSize = this.blockCache.size;
  }

  /**
   * Log a blocked communication attempt
   */
  private logBlockedAttempt(
    fromPlayerId: string, 
    toPlayerId: string, 
    result: BlockCheckResult, 
    source: 'cached' | 'repository'
  ): void {
    if (!this.config.logBlocked) {
      return;
    }

    this.serviceLogger.info({
      event: 'communication_blocked',
      fromPlayerId: fromPlayerId,
      toPlayerId: toPlayerId,
      blockedBy: result.blockedBy,
      bidirectional: result.bidirectional,
      source: source,
      reason: result.reason,
    }, `Communication blocked: ${fromPlayerId} → ${toPlayerId} (blocked by ${result.blockedBy})`);
  }

  /**
   * Start periodic cache cleanup
   */
  private startCacheCleanup(): void {
    // Clean up expired entries every 10 minutes
    this.cacheCleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, 10 * 60 * 1000);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const cacheKey of Array.from(this.blockCache.keys())) {
      const entry = this.blockCache.get(cacheKey);
      if (entry && now - entry.cachedAt > this.config.cacheTtlMs) {
        this.blockCache.delete(cacheKey);
        cleanedCount++;
      }
    }

    this.stats.cacheSize = this.blockCache.size;
    this.stats.lastCacheClean = new Date();

    if (cleanedCount > 0) {
      this.serviceLogger.debug({
        event: 'block_cache_cleanup',
        cleanedCount: cleanedCount,
        remainingSize: this.blockCache.size,
      }, `Cleaned up ${cleanedCount} expired cache entries`);
    }
  }
}

/**
 * Factory function to create BlockListMiddleware instance
 */
export function createBlockListMiddleware(
  playersRepo: IPlayersRepository,
  config?: Partial<BlockListConfig>
): BlockListMiddleware {
  return new BlockListMiddleware(playersRepo, config);
}