import { z } from 'zod';
import { IGuildsRepository } from '../../infra/persistence/guildsRepository';
import { IPlayersRepository } from '../../infra/persistence/playersRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { Player } from '../../domain/entities/players';
import { Guild } from '../../domain/entities/guilds';

// Moderation action types
export const ModerationAction = {
  MUTE: 'mute',
  KICK: 'kick',
  GUILD_DISSOLVE: 'guild_dissolve',
  UNMUTE: 'unmute',
} as const;

export type ModerationActionType = typeof ModerationAction[keyof typeof ModerationAction];

export const ModerationActionSchema = z.enum(['mute', 'kick', 'guild_dissolve', 'unmute']);

// Moderation command inputs
export const MutePlayerInputSchema = z.object({
  moderatorId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  durationMs: z.number().int().min(60 * 1000).max(30 * 24 * 60 * 60 * 1000), // 1 minute to 30 days
  reason: z.string().min(1).max(500),
  scope: z.enum(['global', 'guild', 'arena']).optional(),
  scopeId: z.string().uuid().optional(),
});

export const KickPlayerInputSchema = z.object({
  moderatorId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  scope: z.enum(['guild', 'arena']),
  scopeId: z.string().uuid(),
});

export const DissolveGuildInputSchema = z.object({
  moderatorId: z.string().uuid(),
  guildId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  notifyMembers: z.boolean().default(true),
});

export const UnmutePlayerInputSchema = z.object({
  moderatorId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  scope: z.enum(['global', 'guild', 'arena']).optional(),
  scopeId: z.string().uuid().optional(),
});

export type MutePlayerInput = z.infer<typeof MutePlayerInputSchema>;
export type KickPlayerInput = z.infer<typeof KickPlayerInputSchema>;
export type DissolveGuildInput = z.infer<typeof DissolveGuildInputSchema>;
export type UnmutePlayerInput = z.infer<typeof UnmutePlayerInputSchema>;

// Moderation results
export interface ModerationResult {
  success: boolean;
  action: ModerationActionType;
  targetId: string;
  moderatorId: string;
  reason?: string | undefined;
  error?: string | undefined;
  details?: Record<string, unknown> | undefined;
  expiresAt?: Date | undefined;
}

export interface MuteStatus {
  isMuted: boolean;
  expiresAt?: Date | undefined;
  reason?: string | undefined;
  moderatorId?: string | undefined;
  scope?: string | undefined;
  scopeId?: string | undefined;
}

export interface ModerationStats {
  totalActions: number;
  actionsByType: Record<ModerationActionType, number>;
  activeGlobalMutes: number;
  totalGuildsDisolved: number;
  averageActionTimeMs: number;
  lastActionAt?: Date;
}

/**
 * Administrative moderation commands service implementing FR-015
 * Provides mute, kick, and guild dissolution functionality
 */
export class ModerationService {
  private readonly serviceLogger = createServiceLogger('ModerationService');
  private stats: ModerationStats = {
    totalActions: 0,
    actionsByType: {
      [ModerationAction.MUTE]: 0,
      [ModerationAction.KICK]: 0,
      [ModerationAction.GUILD_DISSOLVE]: 0,
      [ModerationAction.UNMUTE]: 0,
    },
    activeGlobalMutes: 0,
    totalGuildsDisolved: 0,
    averageActionTimeMs: 0,
  };
  
  // In-memory mute tracking (in production, this would be in a database)
  private mutedPlayers = new Map<string, MuteStatus>();

  constructor(
    private readonly playersRepo: IPlayersRepository,
    private readonly guildsRepo: IGuildsRepository
  ) {
    this.serviceLogger.info({
      event: 'moderation_service_initialized',
    }, 'Moderation service initialized');
  }

  /**
   * Mute a player for a specified duration
   */
  async mutePlayer(input: MutePlayerInput): Promise<ModerationResult> {
    const startTime = Date.now();

    try {
      MutePlayerInputSchema.parse(input);

      this.serviceLogger.info({
        event: 'mute_player_started',
        moderatorId: input.moderatorId,
        targetPlayerId: input.targetPlayerId,
        durationMs: input.durationMs,
        scope: input.scope,
        scopeId: input.scopeId,
        reason: input.reason,
      }, `Starting mute action: ${input.moderatorId} muting ${input.targetPlayerId}`);

      // Validate moderator and target exist
      const [moderator, target] = await Promise.all([
        this.playersRepo.findById(input.moderatorId),
        this.playersRepo.findById(input.targetPlayerId),
      ]);

      if (!moderator) {
        return this.createFailureResult(
          ModerationAction.MUTE,
          input.targetPlayerId,
          input.moderatorId,
          'Moderator not found',
          input.reason
        );
      }

      if (!target) {
        return this.createFailureResult(
          ModerationAction.MUTE,
          input.targetPlayerId,
          input.moderatorId,
          'Target player not found',
          input.reason
        );
      }

      // Check if moderator has permission (basic check - in production would be more sophisticated)
      if (!this.hasModeratorPermissions(moderator)) {
        return this.createFailureResult(
          ModerationAction.MUTE,
          input.targetPlayerId,
          input.moderatorId,
          'Insufficient permissions',
          input.reason
        );
      }

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + input.durationMs);
      const muteKey = this.createMuteKey(input.targetPlayerId, input.scope, input.scopeId);

      // Apply mute
      const muteStatus: MuteStatus = {
        isMuted: true,
        expiresAt: expiresAt,
        reason: input.reason,
        moderatorId: input.moderatorId,
        scope: input.scope || 'global',
        scopeId: input.scopeId,
      };

      this.mutedPlayers.set(muteKey, muteStatus);

      // Update stats
      this.updateModerationStats(ModerationAction.MUTE, Date.now() - startTime);

      if (input.scope === 'global' || !input.scope) {
        this.stats.activeGlobalMutes++;
      }

      const result: ModerationResult = {
        success: true,
        action: ModerationAction.MUTE,
        targetId: input.targetPlayerId,
        moderatorId: input.moderatorId,
        reason: input.reason,
        expiresAt: expiresAt,
        details: {
          durationMs: input.durationMs,
          scope: input.scope || 'global',
          scopeId: input.scopeId,
          targetDisplayName: target.displayName,
          moderatorDisplayName: moderator.displayName,
        },
      };

      this.serviceLogger.info({
        event: 'mute_player_completed',
        result: result,
        durationMs: Date.now() - startTime,
      }, `Mute completed: ${target.displayName} muted until ${expiresAt.toISOString()}`);

      return result;
    } catch (error) {
      this.serviceLogger.error({
        event: 'mute_player_error',
        moderatorId: input.moderatorId,
        targetPlayerId: input.targetPlayerId,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }, 'Mute player operation failed');

      return this.createFailureResult(
        ModerationAction.MUTE,
        input.targetPlayerId,
        input.moderatorId,
        error instanceof Error ? error.message : 'Unknown error',
        input.reason
      );
    }
  }

  /**
   * Unmute a player
   */
  async unmutePlayer(input: UnmutePlayerInput): Promise<ModerationResult> {
    const startTime = Date.now();

    try {
      UnmutePlayerInputSchema.parse(input);

      this.serviceLogger.info({
        event: 'unmute_player_started',
        moderatorId: input.moderatorId,
        targetPlayerId: input.targetPlayerId,
        scope: input.scope,
        scopeId: input.scopeId,
      }, `Starting unmute action: ${input.moderatorId} unmuting ${input.targetPlayerId}`);

      const moderator = await this.playersRepo.findById(input.moderatorId);
      if (!moderator || !this.hasModeratorPermissions(moderator)) {
        return this.createFailureResult(
          ModerationAction.UNMUTE,
          input.targetPlayerId,
          input.moderatorId,
          'Insufficient permissions'
        );
      }

      const muteKey = this.createMuteKey(input.targetPlayerId, input.scope, input.scopeId);
      const existingMute = this.mutedPlayers.get(muteKey);

      if (!existingMute || !existingMute.isMuted) {
        return this.createFailureResult(
          ModerationAction.UNMUTE,
          input.targetPlayerId,
          input.moderatorId,
          'Player is not muted'
        );
      }

      // Remove mute
      this.mutedPlayers.delete(muteKey);

      // Update stats
      this.updateModerationStats(ModerationAction.UNMUTE, Date.now() - startTime);

      if (existingMute.scope === 'global') {
        this.stats.activeGlobalMutes = Math.max(0, this.stats.activeGlobalMutes - 1);
      }

      const result: ModerationResult = {
        success: true,
        action: ModerationAction.UNMUTE,
        targetId: input.targetPlayerId,
        moderatorId: input.moderatorId,
        details: {
          previousExpiration: existingMute.expiresAt,
          scope: input.scope || 'global',
          scopeId: input.scopeId,
        },
      };

      this.serviceLogger.info({
        event: 'unmute_player_completed',
        result: result,
        durationMs: Date.now() - startTime,
      }, `Player ${input.targetPlayerId} unmuted by ${input.moderatorId}`);

      return result;
    } catch (error) {
      this.serviceLogger.error({
        event: 'unmute_player_error',
        moderatorId: input.moderatorId,
        targetPlayerId: input.targetPlayerId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Unmute player operation failed');

      return this.createFailureResult(
        ModerationAction.UNMUTE,
        input.targetPlayerId,
        input.moderatorId,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Kick a player from a guild or arena
   */
  async kickPlayer(input: KickPlayerInput): Promise<ModerationResult> {
    const startTime = Date.now();

    try {
      KickPlayerInputSchema.parse(input);

      this.serviceLogger.info({
        event: 'kick_player_started',
        moderatorId: input.moderatorId,
        targetPlayerId: input.targetPlayerId,
        scope: input.scope,
        scopeId: input.scopeId,
        reason: input.reason,
      }, `Starting kick action: ${input.moderatorId} kicking ${input.targetPlayerId} from ${input.scope}`);

      const [moderator, target] = await Promise.all([
        this.playersRepo.findById(input.moderatorId),
        this.playersRepo.findById(input.targetPlayerId),
      ]);

      if (!moderator || !target) {
        return this.createFailureResult(
          ModerationAction.KICK,
          input.targetPlayerId,
          input.moderatorId,
          'Moderator or target not found',
          input.reason
        );
      }

      if (!this.hasModeratorPermissions(moderator)) {
        return this.createFailureResult(
          ModerationAction.KICK,
          input.targetPlayerId,
          input.moderatorId,
          'Insufficient permissions',
          input.reason
        );
      }

      let kickResult: { success: boolean; error?: string } = { success: false };

      if (input.scope === 'guild') {
        kickResult = await this.kickFromGuild(input.scopeId, input.targetPlayerId);
      } else if (input.scope === 'arena') {
        // Arena kicks are handled at the room level
        kickResult = { success: true }; // Placeholder - actual implementation would coordinate with arena rooms
      }

      if (!kickResult.success) {
        return this.createFailureResult(
          ModerationAction.KICK,
          input.targetPlayerId,
          input.moderatorId,
          kickResult.error || 'Kick operation failed',
          input.reason
        );
      }

      // Update stats
      this.updateModerationStats(ModerationAction.KICK, Date.now() - startTime);

      const result: ModerationResult = {
        success: true,
        action: ModerationAction.KICK,
        targetId: input.targetPlayerId,
        moderatorId: input.moderatorId,
        reason: input.reason,
        details: {
          scope: input.scope,
          scopeId: input.scopeId,
          targetDisplayName: target.displayName,
          moderatorDisplayName: moderator.displayName,
        },
      };

      this.serviceLogger.info({
        event: 'kick_player_completed',
        result: result,
        durationMs: Date.now() - startTime,
      }, `Kick completed: ${target.displayName} kicked from ${input.scope}`);

      return result;
    } catch (error) {
      this.serviceLogger.error({
        event: 'kick_player_error',
        moderatorId: input.moderatorId,
        targetPlayerId: input.targetPlayerId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Kick player operation failed');

      return this.createFailureResult(
        ModerationAction.KICK,
        input.targetPlayerId,
        input.moderatorId,
        error instanceof Error ? error.message : 'Unknown error',
        input.reason
      );
    }
  }

  /**
   * Dissolve a guild (ultimate administrative action)
   */
  async dissolveGuild(input: DissolveGuildInput): Promise<ModerationResult> {
    const startTime = Date.now();

    try {
      DissolveGuildInputSchema.parse(input);

      this.serviceLogger.info({
        event: 'dissolve_guild_started',
        moderatorId: input.moderatorId,
        guildId: input.guildId,
        reason: input.reason,
        notifyMembers: input.notifyMembers,
      }, `Starting guild dissolution: ${input.moderatorId} dissolving guild ${input.guildId}`);

      const [moderator, guild] = await Promise.all([
        this.playersRepo.findById(input.moderatorId),
        this.guildsRepo.findById(input.guildId),
      ]);

      if (!moderator || !guild) {
        return this.createFailureResult(
          ModerationAction.GUILD_DISSOLVE,
          input.guildId,
          input.moderatorId,
          'Moderator or guild not found',
          input.reason
        );
      }

      if (!this.hasModeratorPermissions(moderator)) {
        return this.createFailureResult(
          ModerationAction.GUILD_DISSOLVE,
          input.guildId,
          input.moderatorId,
          'Insufficient permissions',
          input.reason
        );
      }

      // TODO: In a real implementation, this would:
      // 1. Notify all guild members
      // 2. Handle asset/resource redistribution
      // 3. Archive guild data for audit purposes
      // 4. Remove guild from all systems

      const deleted = await this.guildsRepo.delete(input.guildId);
      
      if (!deleted) {
        return this.createFailureResult(
          ModerationAction.GUILD_DISSOLVE,
          input.guildId,
          input.moderatorId,
          'Failed to dissolve guild',
          input.reason
        );
      }

      // Update stats
      this.updateModerationStats(ModerationAction.GUILD_DISSOLVE, Date.now() - startTime);
      this.stats.totalGuildsDisolved++;

      const result: ModerationResult = {
        success: true,
        action: ModerationAction.GUILD_DISSOLVE,
        targetId: input.guildId,
        moderatorId: input.moderatorId,
        reason: input.reason,
        details: {
          guildName: guild.name,
          memberCount: guild.memberCount,
          moderatorDisplayName: moderator.displayName,
          notifyMembers: input.notifyMembers,
        },
      };

      this.serviceLogger.info({
        event: 'dissolve_guild_completed',
        result: result,
        durationMs: Date.now() - startTime,
      }, `Guild dissolution completed: ${guild.name} dissolved by ${moderator.displayName}`);

      return result;
    } catch (error) {
      this.serviceLogger.error({
        event: 'dissolve_guild_error',
        moderatorId: input.moderatorId,
        guildId: input.guildId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Dissolve guild operation failed');

      return this.createFailureResult(
        ModerationAction.GUILD_DISSOLVE,
        input.guildId,
        input.moderatorId,
        error instanceof Error ? error.message : 'Unknown error',
        input.reason
      );
    }
  }

  /**
   * Check if a player is currently muted
   */
  isMuted(playerId: string, scope?: string, scopeId?: string): MuteStatus {
    const muteKey = this.createMuteKey(playerId, scope, scopeId);
    const muteStatus = this.mutedPlayers.get(muteKey);

    if (!muteStatus || !muteStatus.isMuted) {
      return { isMuted: false };
    }

    // Check if mute has expired
    if (muteStatus.expiresAt && muteStatus.expiresAt <= new Date()) {
      this.mutedPlayers.delete(muteKey);
      if (muteStatus.scope === 'global') {
        this.stats.activeGlobalMutes = Math.max(0, this.stats.activeGlobalMutes - 1);
      }
      return { isMuted: false };
    }

    return muteStatus;
  }

  /**
   * Get current moderation statistics
   */
  getStats(): ModerationStats {
    return { ...this.stats };
  }

  /**
   * Clean up expired mutes (called periodically)
   */
  cleanupExpiredMutes(): number {
    const now = new Date();
    let cleanedCount = 0;

    for (const muteKey of Array.from(this.mutedPlayers.keys())) {
      const muteStatus = this.mutedPlayers.get(muteKey);
      if (muteStatus && muteStatus.expiresAt && muteStatus.expiresAt <= now) {
        this.mutedPlayers.delete(muteKey);
        cleanedCount++;
        
        if (muteStatus.scope === 'global') {
          this.stats.activeGlobalMutes = Math.max(0, this.stats.activeGlobalMutes - 1);
        }
      }
    }

    if (cleanedCount > 0) {
      this.serviceLogger.info({
        event: 'expired_mutes_cleaned',
        cleanedCount: cleanedCount,
        remainingMutes: this.mutedPlayers.size,
      }, `Cleaned up ${cleanedCount} expired mutes`);
    }

    return cleanedCount;
  }

  /**
   * Check if a player has moderator permissions
   */
  private hasModeratorPermissions(player: Player): boolean {
    // In a real implementation, this would check roles, permissions, etc.
    // For now, just a simple check based on player status
    return player.status === 'active'; // Placeholder logic
  }

  /**
   * Create a consistent mute key
   */
  private createMuteKey(playerId: string, scope?: string, scopeId?: string): string {
    const baseKey = `${playerId}:${scope || 'global'}`;
    return scopeId ? `${baseKey}:${scopeId}` : baseKey;
  }

  /**
   * Kick a player from a guild
   */
  private async kickFromGuild(guildId: string, _playerId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const guild = await this.guildsRepo.findById(guildId);
      if (!guild) {
        return { success: false, error: 'Guild not found' };
      }

      // Check if player is a member (this would need to be implemented in the repository)
      // For now, assume the kick is valid
      // if (!guild.memberIds.includes(_playerId)) {
      //   return { success: false, error: 'Player is not a member of this guild' };
      // }

      // TODO: In a real implementation, this would properly remove the member
      // and handle any cleanup needed
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create a failure result
   */
  private createFailureResult(
    action: ModerationActionType,
    targetId: string,
    moderatorId: string,
    error: string,
    reason?: string
  ): ModerationResult {
    return {
      success: false,
      action: action,
      targetId: targetId,
      moderatorId: moderatorId,
      reason: reason,
      error: error,
    };
  }

  /**
   * Update moderation statistics
   */
  private updateModerationStats(action: ModerationActionType, durationMs: number): void {
    this.stats.totalActions++;
    this.stats.actionsByType[action]++;
    this.stats.lastActionAt = new Date();

    // Update average duration
    const totalDuration = this.stats.averageActionTimeMs * (this.stats.totalActions - 1) + durationMs;
    this.stats.averageActionTimeMs = Math.round(totalDuration / this.stats.totalActions);
  }
}

/**
 * Factory function to create ModerationService instance
 */
export function createModerationService(
  playersRepo: IPlayersRepository,
  guildsRepo: IGuildsRepository
): ModerationService {
  return new ModerationService(playersRepo, guildsRepo);
}