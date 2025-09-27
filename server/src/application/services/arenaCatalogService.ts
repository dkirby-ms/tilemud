import { z } from 'zod';
import { ISessionsRepository } from '../../infra/persistence/sessionsRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { Arena } from '../../domain/entities/sessions';

// Arena catalog schemas
export const ArenaTierSchema = z.enum(['tutorial', 'skirmish', 'epic']);
export type ArenaTier = z.infer<typeof ArenaTierSchema>;

export const ArenaCapacityInfoSchema = z.object({
  tier: ArenaTierSchema,
  totalArenas: z.number().int().min(0),
  activeArenas: z.number().int().min(0),
  totalCapacity: z.number().int().min(0),
  currentPlayers: z.number().int().min(0),
  utilizationPercent: z.number().min(0).max(100),
  averageWaitTime: z.number().min(0).optional(),
});

export const ArenaCatalogEntrySchema = z.object({
  arenaId: z.string().uuid(),
  tier: ArenaTierSchema,
  currentPlayers: z.number().int().min(0),
  maxCapacity: z.number().int().min(1),
  utilizationPercent: z.number().min(0).max(100),
  status: z.enum(['available', 'full', 'starting', 'in_progress', 'maintenance']),
  estimatedWaitTime: z.number().min(0).optional(),
  instanceId: z.string().uuid().optional(),
});

export type ArenaCapacityInfo = z.infer<typeof ArenaCapacityInfoSchema>;
export type ArenaCatalogEntry = z.infer<typeof ArenaCatalogEntrySchema>;

export interface ArenaCatalogFilters {
  tier?: ArenaTier;
  availableOnly?: boolean;
  minCapacity?: number;
  maxWaitTime?: number;
}

/**
 * Arena catalog service implementing FR-002 and FR-011
 * Computes arena utilization, capacity tiers, and availability
 */
export class ArenaCatalogService {
  private readonly serviceLogger = createServiceLogger('ArenaCatalogService');

  // Capacity configuration based on arena tiers
  private readonly ARENA_CAPACITIES = {
    tutorial: { min: 2, max: 8, optimal: 6 },
    skirmish: { min: 8, max: 50, optimal: 30 },
    epic: { min: 50, max: 300, optimal: 200 },
  } as const;

  constructor(private readonly sessionsRepo: ISessionsRepository) {}

  /**
   * Get arena capacity information for all tiers
   */
  async getCapacityOverview(): Promise<ArenaCapacityInfo[]> {
    try {
      const results: ArenaCapacityInfo[] = [];

      for (const tier of ['tutorial', 'skirmish', 'epic'] as ArenaTier[]) {
        const capacityInfo = await this.getTierCapacityInfo(tier);
        results.push(capacityInfo);
      }

      this.serviceLogger.debug({
        event: 'capacity_overview_generated',
        tiers: results.length,
        totalArenas: results.reduce((sum, info) => sum + info.totalArenas, 0),
        totalPlayers: results.reduce((sum, info) => sum + info.currentPlayers, 0),
      }, 'Generated arena capacity overview');

      return results;
    } catch (error) {
      this.serviceLogger.error({
        event: 'capacity_overview_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to get capacity overview');
      throw error;
    }
  }

  /**
   * Get capacity information for a specific tier
   */
  async getTierCapacityInfo(tier: ArenaTier): Promise<ArenaCapacityInfo> {
    try {
      // Get all arenas for this tier
      const arenas = await this.sessionsRepo.findAvailableArenas(tier, 0);
      
      const totalArenas = arenas.length;
      // For now, assume all fetched arenas are active (would need status field in Arena entity)
      const activeArenas = arenas.length;
      
      const capacityConfig = this.ARENA_CAPACITIES[tier];
      const totalCapacity = totalArenas * capacityConfig.max;
      
      // Calculate current player count across all arenas of this tier
      const currentPlayers = await this.calculateCurrentPlayers(arenas);
      
      const utilizationPercent = totalCapacity > 0 
        ? Math.round((currentPlayers / totalCapacity) * 100)
        : 0;

      // Estimate average wait time based on utilization
      const averageWaitTime = this.estimateWaitTime(tier, utilizationPercent);

      return {
        tier,
        totalArenas,
        activeArenas,
        totalCapacity,
        currentPlayers,
        utilizationPercent,
        averageWaitTime,
      };
    } catch (error) {
      this.serviceLogger.error({
        event: 'tier_capacity_error',
        tier,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Failed to get capacity info for tier ${tier}`);
      throw error;
    }
  }

  /**
   * Get available arenas matching filters
   */
  async getCatalog(filters: ArenaCatalogFilters = {}): Promise<ArenaCatalogEntry[]> {
    try {
      this.serviceLogger.debug({
        event: 'catalog_request',
        filters,
      }, 'Processing arena catalog request');

      // Get arenas based on tier filter
      const arenas = filters.tier 
        ? await this.sessionsRepo.findAvailableArenas(filters.tier, filters.minCapacity || 0)
        : await this.getAllArenas(filters.minCapacity || 0);

      const catalogEntries: ArenaCatalogEntry[] = [];

      for (const arena of arenas) {
        const entry = await this.createCatalogEntry(arena);
        
        // Apply filters
        if (filters.availableOnly && entry.status !== 'available') {
          continue;
        }
        
        if (filters.maxWaitTime !== undefined && 
            entry.estimatedWaitTime !== undefined && 
            entry.estimatedWaitTime > filters.maxWaitTime) {
          continue;
        }

        catalogEntries.push(entry);
      }

      // Sort by availability and then by utilization
      catalogEntries.sort((a, b) => {
        if (a.status === 'available' && b.status !== 'available') return -1;
        if (b.status === 'available' && a.status !== 'available') return 1;
        return a.utilizationPercent - b.utilizationPercent;
      });

      this.serviceLogger.debug({
        event: 'catalog_generated',
        totalEntries: catalogEntries.length,
        availableCount: catalogEntries.filter(e => e.status === 'available').length,
        filters,
      }, `Generated arena catalog with ${catalogEntries.length} entries`);

      return catalogEntries;
    } catch (error) {
      this.serviceLogger.error({
        event: 'catalog_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
      }, 'Failed to generate arena catalog');
      throw error;
    }
  }

  /**
   * Get the best available arena for a player to join
   */
  async getBestAvailableArena(tier: ArenaTier): Promise<ArenaCatalogEntry | null> {
    try {
      const catalog = await this.getCatalog({ 
        tier, 
        availableOnly: true 
      });

      if (catalog.length === 0) {
        this.serviceLogger.info({
          event: 'no_available_arenas',
          tier,
        }, `No available arenas found for tier ${tier}`);
        return null;
      }

      // Return the arena with lowest utilization (best availability)
      const bestArena = catalog[0];
      if (!bestArena) {
        this.serviceLogger.warn({
          event: 'unexpected_empty_catalog',
          tier,
        }, `Catalog was unexpectedly empty for tier ${tier}`);
        return null;
      }

      this.serviceLogger.debug({
        event: 'best_arena_selected',
        arenaId: bestArena.arenaId,
        tier,
        utilization: bestArena.utilizationPercent,
        currentPlayers: bestArena.currentPlayers,
      }, `Selected best available arena for tier ${tier}`);

      return bestArena;
    } catch (error) {
      this.serviceLogger.error({
        event: 'best_arena_error',
        tier,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Failed to find best arena for tier ${tier}`);
      return null;
    }
  }

  /**
   * Calculate current player count for a list of arenas
   */
  private async calculateCurrentPlayers(arenas: Arena[]): Promise<number> {
    let totalPlayers = 0;
    
    for (const arena of arenas) {
      try {
        const currentCapacity = await this.sessionsRepo.getArenaCapacityUsage(arena.id);
        totalPlayers += currentCapacity;
      } catch (error) {
        this.serviceLogger.warn({
          event: 'capacity_calculation_error',
          arenaId: arena.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, `Failed to get capacity for arena ${arena.id}`);
      }
    }
    
    return totalPlayers;
  }

  /**
   * Create a catalog entry from an arena
   */
  private async createCatalogEntry(arena: Arena): Promise<ArenaCatalogEntry> {
    const tier = arena.tier as ArenaTier;
    const capacityConfig = this.ARENA_CAPACITIES[tier];
    
    const currentPlayers = await this.sessionsRepo.getArenaCapacityUsage(arena.id);
    const maxCapacity = capacityConfig.max;
    const utilizationPercent = Math.round((currentPlayers / maxCapacity) * 100);
    
    // Determine status based on current capacity
    // Since Arena entity doesn't have status field, infer from capacity
    let status: ArenaCatalogEntry['status'];
    if (currentPlayers >= maxCapacity) {
      status = 'full';
    } else if (currentPlayers >= capacityConfig.optimal) {
      status = 'in_progress';
    } else {
      status = 'available';
    }

    // Estimate wait time if not immediately available
    const estimatedWaitTime = status === 'available' 
      ? 0 
      : this.estimateWaitTime(tier, utilizationPercent);

    return {
      arenaId: arena.id,
      tier,
      currentPlayers,
      maxCapacity,
      utilizationPercent,
      status,
      estimatedWaitTime,
      // Note: Arena entity doesn't have instanceId field - would need to be added or fetched separately
    };
  }

  /**
   * Get all arenas across all tiers
   */
  private async getAllArenas(minCapacity: number): Promise<Arena[]> {
    const allArenas: Arena[] = [];
    
    for (const tier of ['tutorial', 'skirmish', 'epic'] as ArenaTier[]) {
      try {
        const tierArenas = await this.sessionsRepo.findAvailableArenas(tier, minCapacity);
        allArenas.push(...tierArenas);
      } catch (error) {
        this.serviceLogger.warn({
          event: 'tier_fetch_error',
          tier,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, `Failed to fetch arenas for tier ${tier}`);
      }
    }
    
    return allArenas;
  }

  /**
   * Estimate wait time based on tier and utilization
   */
  private estimateWaitTime(tier: ArenaTier, utilizationPercent: number): number {
    // Base wait times in seconds by tier
    const baseWaitTimes = {
      tutorial: 30,   // Tutorial games are quick
      skirmish: 90,   // Medium wait for skirmish
      epic: 300,      // Longer wait for epic battles
    };

    const baseWait = baseWaitTimes[tier];
    
    // Increase wait time based on utilization
    if (utilizationPercent < 50) return 0;           // No wait if low utilization
    if (utilizationPercent < 70) return baseWait;    // Base wait if moderate
    if (utilizationPercent < 90) return baseWait * 2; // Double wait if high
    return baseWait * 3; // Triple wait if very high
  }
}

// Factory function
export function createArenaCatalogService(sessionsRepo: ISessionsRepository): ArenaCatalogService {
  return new ArenaCatalogService(sessionsRepo);
}