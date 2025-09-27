import { z } from 'zod';
import { ISessionsRepository } from '../../infra/persistence/sessionsRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { updatePlayerQuorumStatus, updateArenaQuorumPercent, recordSoftFailDecision } from '../../infra/monitoring/metrics';

// Soft-fail detection schemas
export const QuorumCheckRequestSchema = z.object({
  arenaId: z.string().uuid(),
  instanceId: z.string().uuid().optional(),
  checkType: z.enum(['heartbeat', 'message_ack', 'tile_response']).default('heartbeat'),
});

export const PlayerQuorumStatusSchema = z.object({
  playerId: z.string().uuid(),
  lastHeartbeat: z.date(),
  consecutiveFailures: z.number().int().min(0),
  isResponsive: z.boolean(),
  rttMs: z.number().min(0).optional(),
});

export const ArenaQuorumStatusSchema = z.object({
  arenaId: z.string().uuid(),
  totalPlayers: z.number().int().min(0),
  responsivePlayers: z.number().int().min(0),
  quorumPercent: z.number().min(0).max(100),
  isQuorumMaintained: z.boolean(),
  lastQuorumCheck: z.date(),
  failureStreak: z.number().int().min(0),
});

export type QuorumCheckRequest = z.infer<typeof QuorumCheckRequestSchema>;
export type PlayerQuorumStatus = z.infer<typeof PlayerQuorumStatusSchema>;
export type ArenaQuorumStatus = z.infer<typeof ArenaQuorumStatusSchema>;

export interface SoftFailDecision {
  shouldAbort: boolean;
  reason?: string;
  affectedPlayers?: string[];
  recommendedAction: 'continue' | 'pause' | 'abort' | 'migrate';
  confidenceScore: number; // 0-1, how confident we are in this decision
}

/**
 * Soft-fail detection monitor implementing FR-018
 * Tracks player quorum and decides when to abort sessions gracefully
 */
export class SoftFailMonitor {
  private readonly serviceLogger = createServiceLogger('SoftFailMonitor');

  // Quorum thresholds and configuration
  private readonly QUORUM_THRESHOLD_PERCENT = 60; // Minimum % of players needed
  private readonly HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds without heartbeat = unresponsive
  private readonly MAX_CONSECUTIVE_FAILURES = 3; // Max failed heartbeats before marking unresponsive
  private readonly MIN_PLAYERS_FOR_QUORUM = 2; // Minimum players needed to maintain session

  // In-memory tracking (would be Redis in production)
  private readonly playerStatus = new Map<string, PlayerQuorumStatus>();
  private readonly arenaQuorum = new Map<string, ArenaQuorumStatus>();
  private readonly abortDecisions = new Map<string, { timestamp: Date; decision: SoftFailDecision }>();

  constructor(private readonly sessionsRepo: ISessionsRepository) {}

  /**
   * Update player heartbeat status
   */
  async updatePlayerHeartbeat(
    playerId: string, 
    arenaId: string, 
    rttMs?: number
  ): Promise<void> {
    try {
      const now = new Date();
      const currentStatus = this.playerStatus.get(playerId);

      const updatedStatus: PlayerQuorumStatus = {
        playerId,
        lastHeartbeat: now,
        consecutiveFailures: 0, // Reset on successful heartbeat
        isResponsive: true,
        rttMs,
      };

      this.playerStatus.set(playerId, updatedStatus);

      this.serviceLogger.debug({
        event: 'player_heartbeat_updated',
        playerId,
        arenaId,
        rttMs,
        previousFailures: currentStatus?.consecutiveFailures || 0,
      }, `Player heartbeat updated: ${playerId}`);

      // Update arena quorum status
      await this.updateArenaQuorum(arenaId);

    } catch (error) {
      this.serviceLogger.error({
        event: 'heartbeat_update_error',
        playerId,
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to update player heartbeat');
    }
  }

  /**
   * Mark a player as unresponsive (failed heartbeat or message)
   */
  async markPlayerUnresponsive(
    playerId: string, 
    arenaId: string, 
    failureType: 'heartbeat' | 'message_ack' | 'tile_response' = 'heartbeat'
  ): Promise<void> {
    try {
      const currentStatus = this.playerStatus.get(playerId);
      const consecutiveFailures = (currentStatus?.consecutiveFailures || 0) + 1;
      const isResponsive = consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES;

      const updatedStatus: PlayerQuorumStatus = {
        playerId,
        lastHeartbeat: currentStatus?.lastHeartbeat || new Date(Date.now() - this.HEARTBEAT_TIMEOUT_MS),
        consecutiveFailures,
        isResponsive,
        rttMs: currentStatus?.rttMs,
      };

      this.playerStatus.set(playerId, updatedStatus);

      this.serviceLogger.warn({
        event: 'player_marked_unresponsive',
        playerId,
        arenaId,
        failureType,
        consecutiveFailures,
        isResponsive,
      }, `Player marked unresponsive: ${playerId} (${consecutiveFailures} failures)`);

      // Update arena quorum status
      await this.updateArenaQuorum(arenaId);

    } catch (error) {
      this.serviceLogger.error({
        event: 'unresponsive_marking_error',
        playerId,
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to mark player as unresponsive');
    }
  }

  /**
   * Check arena quorum status and return soft-fail decision
   */
  async checkArenaQuorum(arenaId: string): Promise<SoftFailDecision> {
    try {
      const quorumStatus = await this.getArenaQuorumStatus(arenaId);
      
      this.serviceLogger.debug({
        event: 'quorum_check_started',
        arenaId,
        quorumPercent: quorumStatus.quorumPercent,
        responsivePlayers: quorumStatus.responsivePlayers,
        totalPlayers: quorumStatus.totalPlayers,
      }, `Checking quorum for arena ${arenaId}`);

      // Check if we have enough players
      if (quorumStatus.totalPlayers < this.MIN_PLAYERS_FOR_QUORUM) {
        return {
          shouldAbort: true,
          reason: 'Insufficient players for meaningful session',
          recommendedAction: 'abort',
          confidenceScore: 0.95,
        };
      }

      // Check if quorum is maintained
      if (quorumStatus.isQuorumMaintained) {
        return {
          shouldAbort: false,
          recommendedAction: 'continue',
          confidenceScore: 0.9,
        };
      }

      // Quorum lost - determine action based on situation
      const decision = await this.analyzeQuorumLoss(arenaId, quorumStatus);
      
      // Cache decision for consistency
      this.abortDecisions.set(arenaId, {
        timestamp: new Date(),
        decision,
      });

      // Record decision in metrics
      recordSoftFailDecision(arenaId, decision.recommendedAction);

      this.serviceLogger.info({
        event: 'quorum_decision_made',
        arenaId,
        shouldAbort: decision.shouldAbort,
        recommendedAction: decision.recommendedAction,
        reason: decision.reason,
        confidenceScore: decision.confidenceScore,
      }, `Quorum decision for ${arenaId}: ${decision.recommendedAction}`);

      return decision;

    } catch (error) {
      this.serviceLogger.error({
        event: 'quorum_check_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Quorum check failed');

      // Fail-safe: recommend pause on error
      return {
        shouldAbort: false,
        reason: 'Quorum check failed - defaulting to pause',
        recommendedAction: 'pause',
        confidenceScore: 0.1,
      };
    }
  }

  /**
   * Get current quorum status for an arena
   */
  async getArenaQuorumStatus(arenaId: string): Promise<ArenaQuorumStatus> {
    await this.updateArenaQuorum(arenaId);
    
    const status = this.arenaQuorum.get(arenaId);
    if (!status) {
      // Return default status if not found
      return {
        arenaId,
        totalPlayers: 0,
        responsivePlayers: 0,
        quorumPercent: 0,
        isQuorumMaintained: false,
        lastQuorumCheck: new Date(),
        failureStreak: 0,
      };
    }

    return status;
  }

  /**
   * Cleanup tracking data for completed sessions
   */
  async cleanupSessionData(arenaId: string, playerIds: string[]): Promise<void> {
    try {
      // Remove player status tracking
      for (const playerId of playerIds) {
        this.playerStatus.delete(playerId);
      }

      // Remove arena quorum tracking
      this.arenaQuorum.delete(arenaId);
      this.abortDecisions.delete(arenaId);

      this.serviceLogger.debug({
        event: 'session_data_cleaned',
        arenaId,
        playersRemoved: playerIds.length,
      }, `Cleaned up tracking data for arena ${arenaId}`);

    } catch (error) {
      this.serviceLogger.error({
        event: 'cleanup_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to cleanup session data');
    }
  }

  /**
   * Update arena quorum status based on current player states
   */
  private async updateArenaQuorum(arenaId: string): Promise<void> {
    try {
      // Get current arena capacity (would come from sessions repository)
      const currentCapacity = await this.sessionsRepo.getArenaCapacityUsage(arenaId);
      
      // Find all players in this arena
      const arenaPlayerIds = Array.from(this.playerStatus.keys()).filter(_playerId => {
        // TODO: Need to track player-arena mapping more explicitly
        return true; // Placeholder - would filter by actual arena membership
      });

      const totalPlayers = Math.max(currentCapacity, arenaPlayerIds.length);
      let responsivePlayers = 0;
      
      const now = new Date();

      // Count responsive players
      for (const playerId of arenaPlayerIds) {
        const status = this.playerStatus.get(playerId);
        if (!status) continue;

        const timeSinceHeartbeat = now.getTime() - status.lastHeartbeat.getTime();
        const isRecentlyActive = timeSinceHeartbeat < this.HEARTBEAT_TIMEOUT_MS;
        const isResponsive = status.isResponsive && isRecentlyActive;

        if (isResponsive) {
          responsivePlayers++;
        } else if (!status.isResponsive) {
          // Auto-cleanup very old unresponsive players
          if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT_MS * 3) {
            this.playerStatus.delete(playerId);
          }
        }
      }

      const quorumPercent = totalPlayers > 0 
        ? Math.round((responsivePlayers / totalPlayers) * 100)
        : 0;

      const isQuorumMaintained = quorumPercent >= this.QUORUM_THRESHOLD_PERCENT && 
                                responsivePlayers >= this.MIN_PLAYERS_FOR_QUORUM;

      const currentStatus = this.arenaQuorum.get(arenaId);
      const failureStreak = isQuorumMaintained 
        ? 0 
        : (currentStatus?.failureStreak || 0) + 1;

      const updatedStatus: ArenaQuorumStatus = {
        arenaId,
        totalPlayers,
        responsivePlayers,
        quorumPercent,
        isQuorumMaintained,
        lastQuorumCheck: now,
        failureStreak,
      };

      this.arenaQuorum.set(arenaId, updatedStatus);

      // Update Prometheus metrics
      updateArenaQuorumPercent(arenaId, quorumPercent);
      updatePlayerQuorumStatus(arenaId, responsivePlayers, totalPlayers - responsivePlayers);

      if (!isQuorumMaintained) {
        this.serviceLogger.warn({
          event: 'quorum_lost',
          arenaId,
          quorumPercent,
          responsivePlayers,
          totalPlayers,
          failureStreak,
        }, `Quorum lost in arena ${arenaId}: ${quorumPercent}% (${responsivePlayers}/${totalPlayers})`);
      }

    } catch (error) {
      this.serviceLogger.error({
        event: 'arena_quorum_update_error',
        arenaId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to update arena quorum');
    }
  }

  /**
   * Analyze quorum loss situation and decide on action
   */
  private async analyzeQuorumLoss(
    _arenaId: string, 
    quorumStatus: ArenaQuorumStatus
  ): Promise<SoftFailDecision> {
    const { quorumPercent, responsivePlayers, totalPlayers, failureStreak } = quorumStatus;

    // Severe quorum loss - immediate abort
    if (quorumPercent < 30 || responsivePlayers < 2) {
      return {
        shouldAbort: true,
        reason: `Severe quorum loss: ${quorumPercent}% responsive (${responsivePlayers}/${totalPlayers})`,
        recommendedAction: 'abort',
        confidenceScore: 0.9,
      };
    }

    // Moderate quorum loss - consider context
    if (quorumPercent < this.QUORUM_THRESHOLD_PERCENT) {
      // Sustained failure - abort after grace period
      if (failureStreak > 3) {
        return {
          shouldAbort: true,
          reason: `Sustained quorum failure: ${failureStreak} consecutive checks below threshold`,
          recommendedAction: 'abort',
          confidenceScore: 0.8,
        };
      }

      // Recent loss - pause and wait
      if (failureStreak <= 2) {
        return {
          shouldAbort: false,
          reason: `Recent quorum loss: ${quorumPercent}% responsive, pausing for recovery`,
          recommendedAction: 'pause',
          confidenceScore: 0.7,
        };
      }

      // Consider migration for borderline cases
      if (responsivePlayers >= 3 && quorumPercent > 40) {
        return {
          shouldAbort: false,
          reason: `Partial quorum loss: considering migration to smaller arena`,
          recommendedAction: 'migrate',
          confidenceScore: 0.6,
        };
      }
    }

    // Default: continue monitoring
    return {
      shouldAbort: false,
      recommendedAction: 'continue',
      confidenceScore: 0.8,
    };
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats(): {
    trackedPlayers: number;
    trackedArenas: number;
    responsivePlayers: number;
    averageQuorumPercent: number;
  } {
    const trackedPlayers = this.playerStatus.size;
    const trackedArenas = this.arenaQuorum.size;
    
    let responsivePlayers = 0;
    for (const status of this.playerStatus.values()) {
      if (status.isResponsive) responsivePlayers++;
    }

    let totalQuorumPercent = 0;
    for (const status of this.arenaQuorum.values()) {
      totalQuorumPercent += status.quorumPercent;
    }
    const averageQuorumPercent = trackedArenas > 0 ? totalQuorumPercent / trackedArenas : 0;

    return {
      trackedPlayers,
      trackedArenas,
      responsivePlayers,
      averageQuorumPercent: Math.round(averageQuorumPercent),
    };
  }
}

// Factory function
export function createSoftFailMonitor(sessionsRepo: ISessionsRepository): SoftFailMonitor {
  return new SoftFailMonitor(sessionsRepo);
}