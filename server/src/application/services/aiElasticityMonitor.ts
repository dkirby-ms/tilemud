import { z } from 'zod';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { updateAiEntityCount, updateArenaCapacityUtilization, recordPlayerAction } from '../../infra/monitoring/metrics';

// AI elasticity monitoring schemas
export const AiElasticityConfigSchema = z.object({
  minAiRatio: z.number().min(0).max(1).default(0.3), // Minimum AI to player ratio
  maxAiRatio: z.number().min(0).max(1).default(0.8), // Maximum AI to player ratio
  scaleUpThreshold: z.number().min(0).max(1).default(0.7), // When to add AI (utilization %)
  scaleDownThreshold: z.number().min(0).max(1).default(0.4), // When to remove AI (utilization %)
  cooldownPeriodMs: z.number().int().min(1000).default(30000), // 30s between scaling actions
  maxConcurrentOperations: z.number().int().min(1).default(5), // Max simultaneous scaling ops
});

export const AiEntityTypeSchema = z.object({
  type: z.enum(['merchant', 'guard', 'monster', 'ambient']),
  priority: z.number().int().min(1).max(10), // 1=highest priority, 10=lowest
  cpuCost: z.number().min(0.1).max(10.0), // CPU cost multiplier
  memoryCost: z.number().int().min(1), // Memory cost in MB
  canScale: z.boolean().default(true), // Whether this type can be scaled up/down
});

export const ArenaAiStatusSchema = z.object({
  arenaId: z.string().uuid(),
  currentPlayers: z.number().int().min(0),
  currentAi: z.object({
    merchant: z.number().int().min(0).default(0),
    guard: z.number().int().min(0).default(0),
    monster: z.number().int().min(0).default(0),
    ambient: z.number().int().min(0).default(0),
  }),
  targetAi: z.object({
    merchant: z.number().int().min(0).default(0),
    guard: z.number().int().min(0).default(0),
    monster: z.number().int().min(0).default(0),
    ambient: z.number().int().min(0).default(0),
  }),
  utilizationPercent: z.number().min(0).max(200), // Can exceed 100% in overload
  aiRatio: z.number().min(0).max(1),
  lastScalingAction: z.date().optional(),
  pendingOperations: z.number().int().min(0).default(0),
});

export type AiElasticityConfig = z.infer<typeof AiElasticityConfigSchema>;
export type AiEntityType = z.infer<typeof AiEntityTypeSchema>;
export type ArenaAiStatus = z.infer<typeof ArenaAiStatusSchema>;

export interface ScalingDecision {
  action: 'scale_up' | 'scale_down' | 'maintain' | 'throttle';
  entityType?: 'merchant' | 'guard' | 'monster' | 'ambient';
  deltaCount: number; // Positive for scale up, negative for scale down
  reason: string;
  priority: number; // 1-10, higher = more urgent
  estimatedCpuImpact: number;
  estimatedMemoryImpact: number; // MB
}

/**
 * AI elasticity monitor implementing FR-004
 * Monitors arena utilization and scales AI entities up/down automatically
 */
export class AiElasticityMonitor {
  private readonly serviceLogger = createServiceLogger('AiElasticityMonitor');

  // Default AI entity configurations
  private readonly AI_ENTITY_TYPES: Record<string, AiEntityType> = {
    merchant: { type: 'merchant', priority: 2, cpuCost: 1.2, memoryCost: 8, canScale: true },
    guard: { type: 'guard', priority: 3, cpuCost: 0.8, memoryCost: 6, canScale: true },
    monster: { type: 'monster', priority: 1, cpuCost: 2.0, memoryCost: 12, canScale: true },
    ambient: { type: 'ambient', priority: 5, cpuCost: 0.4, memoryCost: 3, canScale: true },
  };

  // In-memory tracking (would be Redis/DB in production)
  private readonly arenaStatus = new Map<string, ArenaAiStatus>();
  private readonly scalingHistory = new Map<string, Date[]>(); // Arena -> timestamps of recent scaling
  private readonly pendingOperations = new Set<string>(); // Track ongoing scaling operations

  constructor(
    private readonly config: AiElasticityConfig = AiElasticityConfigSchema.parse({})
  ) {}

  /**
   * Update arena player count and trigger scaling assessment
   */
  async updateArenaPlayerCount(
    arenaId: string, 
    playerCount: number, 
    capacityLimit: number
  ): Promise<void> {
    try {
      const currentStatus = this.arenaStatus.get(arenaId) || this.createDefaultArenaStatus(arenaId);
      
      // Update player count and utilization
      currentStatus.currentPlayers = playerCount;
      currentStatus.utilizationPercent = Math.round((playerCount / capacityLimit) * 100);
      
      // Update AI ratio
      const totalAi = Object.values(currentStatus.currentAi).reduce((sum, count) => sum + count, 0);
      currentStatus.aiRatio = playerCount > 0 ? totalAi / (playerCount + totalAi) : 0;

      this.arenaStatus.set(arenaId, currentStatus);

      this.serviceLogger.debug({
        event: 'arena_status_updated',
        arenaId,
        playerCount,
        totalAi,
        utilizationPercent: currentStatus.utilizationPercent,
        aiRatio: currentStatus.aiRatio,
      }, `Arena status updated: ${arenaId}`);

      // Update metrics
      updateArenaCapacityUtilization(arenaId, 'dynamic', currentStatus.utilizationPercent);
      for (const [aiType, count] of Object.entries(currentStatus.currentAi)) {
        updateAiEntityCount(arenaId, aiType, count);
      }

      // Assess if scaling is needed
      await this.assessScalingNeeds(arenaId);

    } catch (error) {
      this.serviceLogger.error({
        event: 'arena_status_update_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to update arena player count');
    }
  }

  /**
   * Manually trigger AI entity addition/removal
   */
  async adjustAiEntities(
    arenaId: string, 
    entityType: 'merchant' | 'guard' | 'monster' | 'ambient',
    deltaCount: number,
    reason: string = 'manual_adjustment'
  ): Promise<boolean> {
    try {
      const currentStatus = this.arenaStatus.get(arenaId);
      if (!currentStatus) {
        this.serviceLogger.warn({
          event: 'arena_not_found_for_adjustment',
          arenaId,
          entityType,
          deltaCount,
        }, `Arena not found for AI adjustment: ${arenaId}`);
        return false;
      }

      // Check if operation is valid
      const newCount = currentStatus.currentAi[entityType] + deltaCount;
      if (newCount < 0) {
        this.serviceLogger.warn({
          event: 'invalid_ai_adjustment',
          arenaId,
          entityType,
          currentCount: currentStatus.currentAi[entityType],
          deltaCount,
          reason: 'Cannot reduce below zero',
        }, `Invalid AI adjustment: would result in negative count`);
        return false;
      }

      // Apply the change
      currentStatus.currentAi[entityType] = newCount;
      currentStatus.lastScalingAction = new Date();

      this.arenaStatus.set(arenaId, currentStatus);

      // Update metrics
      updateAiEntityCount(arenaId, entityType, newCount);
      recordPlayerAction('ai_scaling', arenaId, 'success');

      this.serviceLogger.info({
        event: 'ai_entities_adjusted',
        arenaId,
        entityType,
        deltaCount,
        newCount,
        reason,
      }, `AI entities adjusted in ${arenaId}: ${entityType} ${deltaCount > 0 ? '+' : ''}${deltaCount} -> ${newCount}`);

      return true;

    } catch (error) {
      this.serviceLogger.error({
        event: 'ai_adjustment_error',
        arenaId,
        entityType,
        deltaCount,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to adjust AI entities');

      recordPlayerAction('ai_scaling', arenaId, 'failure');
      return false;
    }
  }

  /**
   * Get scaling recommendations for an arena
   */
  async getScalingRecommendations(arenaId: string): Promise<ScalingDecision[]> {
    try {
      const status = this.arenaStatus.get(arenaId);
      if (!status) {
        return [];
      }

      const recommendations: ScalingDecision[] = [];

      // Check if we're in cooldown period
      if (this.isInCooldownPeriod(arenaId)) {
        return [{
          action: 'throttle',
          deltaCount: 0,
          reason: 'In cooldown period after recent scaling action',
          priority: 10,
          estimatedCpuImpact: 0,
          estimatedMemoryImpact: 0,
        }];
      }

      // Scale up recommendations
      if (status.utilizationPercent >= (this.config.scaleUpThreshold * 100)) {
        const scaleUpRecs = this.generateScaleUpRecommendations(status);
        recommendations.push(...scaleUpRecs);
      }
      
      // Scale down recommendations  
      else if (status.utilizationPercent <= (this.config.scaleDownThreshold * 100)) {
        const scaleDownRecs = this.generateScaleDownRecommendations(status);
        recommendations.push(...scaleDownRecs);
      }

      // AI ratio balancing recommendations
      if (status.aiRatio < this.config.minAiRatio) {
        const balancingRecs = this.generateAiRatioBalancingRecommendations(status, 'increase');
        recommendations.push(...balancingRecs);
      } else if (status.aiRatio > this.config.maxAiRatio) {
        const balancingRecs = this.generateAiRatioBalancingRecommendations(status, 'decrease');
        recommendations.push(...balancingRecs);
      }

      // Sort by priority (lower number = higher priority)
      recommendations.sort((a, b) => a.priority - b.priority);

      return recommendations.slice(0, this.config.maxConcurrentOperations);

    } catch (error) {
      this.serviceLogger.error({
        event: 'scaling_recommendations_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to get scaling recommendations');
      return [];
    }
  }

  /**
   * Execute scaling recommendations automatically
   */
  async executeScalingRecommendations(arenaId: string): Promise<number> {
    try {
      const recommendations = await this.getScalingRecommendations(arenaId);
      let executedCount = 0;

      for (const rec of recommendations) {
        if (rec.action === 'maintain' || rec.action === 'throttle') {
          continue;
        }

        if (rec.entityType && rec.deltaCount !== 0) {
          const success = await this.adjustAiEntities(
            arenaId, 
            rec.entityType, 
            rec.deltaCount, 
            `auto_scaling: ${rec.reason}`
          );

          if (success) {
            executedCount++;
          }
        }
      }

      if (executedCount > 0) {
        this.recordScalingAction(arenaId);
      }

      this.serviceLogger.debug({
        event: 'scaling_recommendations_executed',
        arenaId,
        totalRecommendations: recommendations.length,
        executedCount,
      }, `Executed ${executedCount}/${recommendations.length} scaling recommendations`);

      return executedCount;

    } catch (error) {
      this.serviceLogger.error({
        event: 'scaling_execution_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to execute scaling recommendations');
      return 0;
    }
  }

  /**
   * Get current arena AI status
   */
  getArenaAiStatus(arenaId: string): ArenaAiStatus | null {
    return this.arenaStatus.get(arenaId) || null;
  }

  /**
   * Get system-wide monitoring statistics
   */
  getMonitoringStats(): {
    trackedArenas: number;
    totalPlayers: number;
    totalAiEntities: number;
    averageUtilization: number;
    averageAiRatio: number;
    pendingOperations: number;
  } {
    const arenas = Array.from(this.arenaStatus.values());
    
    const totalPlayers = arenas.reduce((sum, status) => sum + status.currentPlayers, 0);
    const totalAiEntities = arenas.reduce((sum, status) => 
      sum + Object.values(status.currentAi).reduce((aiSum, count) => aiSum + count, 0), 0);
    
    const averageUtilization = arenas.length > 0 
      ? Math.round(arenas.reduce((sum, status) => sum + status.utilizationPercent, 0) / arenas.length)
      : 0;
    
    const averageAiRatio = arenas.length > 0 
      ? Math.round((arenas.reduce((sum, status) => sum + status.aiRatio, 0) / arenas.length) * 100) / 100
      : 0;

    return {
      trackedArenas: arenas.length,
      totalPlayers,
      totalAiEntities,
      averageUtilization,
      averageAiRatio,
      pendingOperations: this.pendingOperations.size,
    };
  }

  /**
   * Cleanup tracking data for completed arenas
   */
  async cleanupArenaData(arenaId: string): Promise<void> {
    try {
      this.arenaStatus.delete(arenaId);
      this.scalingHistory.delete(arenaId);
      this.pendingOperations.delete(arenaId);

      this.serviceLogger.debug({
        event: 'arena_data_cleaned',
        arenaId,
      }, `Cleaned up AI monitoring data for arena ${arenaId}`);

    } catch (error) {
      this.serviceLogger.error({
        event: 'cleanup_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to cleanup arena data');
    }
  }

  // Private helper methods

  private createDefaultArenaStatus(arenaId: string): ArenaAiStatus {
    return {
      arenaId,
      currentPlayers: 0,
      currentAi: { merchant: 1, guard: 1, monster: 0, ambient: 2 }, // Default baseline AI
      targetAi: { merchant: 1, guard: 1, monster: 0, ambient: 2 },
      utilizationPercent: 0,
      aiRatio: 0.8, // Start with high AI ratio for empty arenas
      pendingOperations: 0,
    };
  }

  private async assessScalingNeeds(arenaId: string): Promise<void> {
    // Auto-execute scaling recommendations if enabled
    if (this.config.maxConcurrentOperations > 0) {
      await this.executeScalingRecommendations(arenaId);
    }
  }

  private isInCooldownPeriod(arenaId: string): boolean {
    const history = this.scalingHistory.get(arenaId);
    if (!history || history.length === 0) {
      return false;
    }

    const lastAction = Math.max(...history.map(date => date.getTime()));
    const now = Date.now();
    
    return (now - lastAction) < this.config.cooldownPeriodMs;
  }

  private generateScaleUpRecommendations(status: ArenaAiStatus): ScalingDecision[] {
    const recommendations: ScalingDecision[] = [];

    // Add monsters for engagement
    if (status.currentPlayers >= 3 && status.currentAi.monster < status.currentPlayers / 2) {
      const entityType = this.AI_ENTITY_TYPES['monster'];
      if (entityType) {
        recommendations.push({
          action: 'scale_up',
          entityType: 'monster',
          deltaCount: 1,
          reason: `High utilization (${status.utilizationPercent}%) - adding monsters for engagement`,
          priority: entityType.priority,
          estimatedCpuImpact: entityType.cpuCost,
          estimatedMemoryImpact: entityType.memoryCost,
        });
      }
    }

    // Add ambient entities for immersion
    if (status.currentPlayers >= 2 && status.currentAi.ambient < 3) {
      const entityType = this.AI_ENTITY_TYPES['ambient'];
      if (entityType) {
        recommendations.push({
          action: 'scale_up',
          entityType: 'ambient',
          deltaCount: 1,
          reason: `High utilization - adding ambient AI for immersion`,
          priority: entityType.priority,
          estimatedCpuImpact: entityType.cpuCost,
          estimatedMemoryImpact: entityType.memoryCost,
        });
      }
    }

    return recommendations;
  }

  private generateScaleDownRecommendations(status: ArenaAiStatus): ScalingDecision[] {
    const recommendations: ScalingDecision[] = [];

    // Remove excess ambient entities first (lowest priority)
    if (status.currentAi.ambient > 2) {
      const entityType = this.AI_ENTITY_TYPES['ambient'];
      if (entityType) {
        recommendations.push({
          action: 'scale_down',
          entityType: 'ambient',
          deltaCount: -1,
          reason: `Low utilization (${status.utilizationPercent}%) - removing excess ambient AI`,
          priority: entityType.priority,
          estimatedCpuImpact: -entityType.cpuCost,
          estimatedMemoryImpact: -entityType.memoryCost,
        });
      }
    }

    // Remove excess monsters if very low utilization
    if (status.utilizationPercent < 20 && status.currentAi.monster > 0) {
      const entityType = this.AI_ENTITY_TYPES['monster'];
      if (entityType) {
        recommendations.push({
          action: 'scale_down',
          entityType: 'monster',
          deltaCount: -1,
          reason: `Very low utilization - removing monsters to save resources`,
          priority: entityType.priority + 1, // Lower priority than adding
          estimatedCpuImpact: -entityType.cpuCost,
          estimatedMemoryImpact: -entityType.memoryCost,
        });
      }
    }

    return recommendations;
  }

  private generateAiRatioBalancingRecommendations(
    status: ArenaAiStatus, 
    direction: 'increase' | 'decrease'
  ): ScalingDecision[] {
    const recommendations: ScalingDecision[] = [];

    if (direction === 'increase') {
      // Add the most efficient AI type first
      const entityType = this.AI_ENTITY_TYPES['ambient'];
      if (entityType) {
        recommendations.push({
          action: 'scale_up',
          entityType: 'ambient',
          deltaCount: 1,
          reason: `AI ratio too low (${Math.round(status.aiRatio * 100)}%) - adding efficient ambient AI`,
          priority: entityType.priority,
          estimatedCpuImpact: entityType.cpuCost,
          estimatedMemoryImpact: entityType.memoryCost,
        });
      }
    } else {
      // Remove the least essential AI type first
      if (status.currentAi.ambient > 1) {
        const entityType = this.AI_ENTITY_TYPES['ambient'];
        if (entityType) {
          recommendations.push({
            action: 'scale_down',
            entityType: 'ambient',
            deltaCount: -1,
            reason: `AI ratio too high (${Math.round(status.aiRatio * 100)}%) - removing ambient AI`,
            priority: entityType.priority,
            estimatedCpuImpact: -entityType.cpuCost,
            estimatedMemoryImpact: -entityType.memoryCost,
          });
        }
      }
    }

    return recommendations;
  }

  private recordScalingAction(arenaId: string): void {
    const history = this.scalingHistory.get(arenaId) || [];
    history.push(new Date());
    
    // Keep only recent history (last 10 actions)
    if (history.length > 10) {
      history.shift();
    }
    
    this.scalingHistory.set(arenaId, history);
  }
}

// Factory function
export function createAiElasticityMonitor(config?: Partial<AiElasticityConfig>): AiElasticityMonitor {
  const fullConfig = AiElasticityConfigSchema.parse(config || {});
  return new AiElasticityMonitor(fullConfig);
}