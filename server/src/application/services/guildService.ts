import { z } from 'zod';
import { IGuildsRepository } from '../../infra/persistence/guildsRepository';
import { IPlayersRepository } from '../../infra/persistence/playersRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  Guild, 
  CreateGuildInput, 
  GuildMembership, 
  AddMemberInput, 
  normalizeGuildName,
  GuildRole,
  canInviteMembers,
  canKickMembers,
  canPromoteMembers,
  isHigherRole
} from '../../domain/entities/guilds';

// Guild service schemas
export const GuildCreationRequestSchema = z.object({
  name: z.string().min(3).max(32),
  leaderPlayerId: z.string().uuid(),
});

export const GuildInviteRequestSchema = z.object({
  guildId: z.string().uuid(),
  playerId: z.string().uuid(),
  inviterPlayerId: z.string().uuid(),
  role: z.enum(['member', 'veteran']).default('member'),
});

export const GuildPromoteRequestSchema = z.object({
  guildId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  promoterPlayerId: z.string().uuid(),
  newRole: z.enum(['member', 'veteran', 'officer', 'leader']),
});

export const GuildKickRequestSchema = z.object({
  guildId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  kickerPlayerId: z.string().uuid(),
  reason: z.string().max(256).optional(),
});

export type GuildCreationRequest = z.infer<typeof GuildCreationRequestSchema>;
export type GuildInviteRequest = z.infer<typeof GuildInviteRequestSchema>;
export type GuildPromoteRequest = z.infer<typeof GuildPromoteRequestSchema>;
export type GuildKickRequest = z.infer<typeof GuildKickRequestSchema>;

export interface GuildOperationResult {
  success: boolean;
  guild?: Guild;
  membership?: GuildMembership;
  error?: string;
  errorCode?: 'DUPLICATE_NAME' | 'PLAYER_NOT_FOUND' | 'GUILD_NOT_FOUND' | 'INSUFFICIENT_PERMISSIONS' | 'ALREADY_MEMBER' | 'GUILD_FULL' | 'VALIDATION_ERROR';
}

/**
 * Guild service implementing FR-006: Guild creation and management
 * Enforces name uniqueness, permissions, and member limits
 */
export class GuildService {
  private readonly serviceLogger = createServiceLogger('GuildService');

  // Guild configuration
  private readonly MAX_GUILD_MEMBERS = 1000;
  // Guild name reservation time (reserved for future reservation feature)
  // private readonly GUILD_NAME_RESERVATION_TIME_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly guildsRepo: IGuildsRepository,
    private readonly playersRepo: IPlayersRepository
  ) {}

  /**
   * Create a new guild with uniqueness enforcement
   */
  async createGuild(request: GuildCreationRequest): Promise<GuildOperationResult> {
    try {
      // Validate input
      const validatedRequest = GuildCreationRequestSchema.parse(request);
      
      this.serviceLogger.info({
        event: 'guild_creation_attempt',
        guildName: validatedRequest.name,
        leaderPlayerId: validatedRequest.leaderPlayerId,
      }, `Attempting to create guild: ${validatedRequest.name}`);

      // Verify leader player exists and is active
      const leaderPlayer = await this.playersRepo.findById(validatedRequest.leaderPlayerId);
      if (!leaderPlayer || leaderPlayer.status !== 'active') {
        this.serviceLogger.warn({
          event: 'guild_creation_failed',
          reason: 'leader_not_found',
          playerId: validatedRequest.leaderPlayerId,
        }, 'Guild creation failed: leader player not found or inactive');
        
        return {
          success: false,
          error: 'Leader player not found or inactive',
          errorCode: 'PLAYER_NOT_FOUND',
        };
      }

      // Check if player is already in a guild as leader
      const existingMemberships = await this.guildsRepo.getPlayerMemberships(validatedRequest.leaderPlayerId);
      const existingLeaderRole = existingMemberships.find(m => m.role === GuildRole.LEADER);
      if (existingLeaderRole) {
        this.serviceLogger.warn({
          event: 'guild_creation_failed',
          reason: 'already_guild_leader',
          playerId: validatedRequest.leaderPlayerId,
          existingGuildId: existingLeaderRole.guildId,
        }, 'Player is already a guild leader');
        
        return {
          success: false,
          error: 'Player is already leading another guild',
          errorCode: 'ALREADY_MEMBER',
        };
      }

      // Normalize and check name uniqueness
      const normalizedName = normalizeGuildName(validatedRequest.name);
      const existingGuild = await this.guildsRepo.findByName(normalizedName);
      if (existingGuild && !existingGuild.deletedAt) {
        this.serviceLogger.warn({
          event: 'guild_creation_failed',
          reason: 'duplicate_name',
          requestedName: validatedRequest.name,
          normalizedName,
        }, 'Guild name already exists');
        
        return {
          success: false,
          error: 'Guild name is already taken',
          errorCode: 'DUPLICATE_NAME',
        };
      }

      // Create guild
      const guildInput: CreateGuildInput = {
        name: validatedRequest.name,
        leaderPlayerId: validatedRequest.leaderPlayerId,
      };

      const guild = await this.guildsRepo.create(guildInput);
      
      // Add leader as first member
      const leaderMembershipInput: AddMemberInput = {
        guildId: guild.id,
        playerId: validatedRequest.leaderPlayerId,
        role: GuildRole.LEADER,
        invitedBy: validatedRequest.leaderPlayerId, // Self-invited as leader
      };

      const newMembership = await this.guildsRepo.addMembership(leaderMembershipInput);

      this.serviceLogger.info({
        event: 'guild_created',
        guildId: guild.id,
        guildName: guild.name,
        leaderId: guild.leaderPlayerId,
        membershipId: newMembership.playerId,
      }, `Guild created successfully: ${guild.name}`);

      return {
        success: true,
        guild,
        membership: newMembership,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'guild_creation_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        request: { ...request, leaderPlayerId: request.leaderPlayerId },
      }, 'Guild creation failed');

      return {
        success: false,
        error: 'Failed to create guild',
        errorCode: 'VALIDATION_ERROR',
      };
    }
  }

  /**
   * Invite a player to join a guild
   */
  async invitePlayer(request: GuildInviteRequest): Promise<GuildOperationResult> {
    try {
      const validatedRequest = GuildInviteRequestSchema.parse(request);

      this.serviceLogger.info({
        event: 'guild_invite_attempt',
        guildId: validatedRequest.guildId,
        playerId: validatedRequest.playerId,
        inviterPlayerId: validatedRequest.inviterPlayerId,
        role: validatedRequest.role,
      }, 'Attempting to invite player to guild');

      // Verify guild exists
      const guild = await this.guildsRepo.findById(validatedRequest.guildId);
      if (!guild) {
        return {
          success: false,
          error: 'Guild not found',
          errorCode: 'GUILD_NOT_FOUND',
        };
      }

      // Verify inviter has permission
      const inviterMembership = await this.guildsRepo.getMembership(validatedRequest.guildId, validatedRequest.inviterPlayerId);
      if (!inviterMembership || !canInviteMembers(inviterMembership.role)) {
        return {
          success: false,
          error: 'Insufficient permissions to invite members',
          errorCode: 'INSUFFICIENT_PERMISSIONS',
        };
      }

      // Verify target player exists
      const targetPlayer = await this.playersRepo.findById(validatedRequest.playerId);
      if (!targetPlayer || targetPlayer.status !== 'active') {
        return {
          success: false,
          error: 'Player not found or inactive',
          errorCode: 'PLAYER_NOT_FOUND',
        };
      }

      // Check if player is already a member
      const existingMembership = await this.guildsRepo.getMembership(validatedRequest.guildId, validatedRequest.playerId);
      if (existingMembership) {
        return {
          success: false,
          error: 'Player is already a guild member',
          errorCode: 'ALREADY_MEMBER',
        };
      }

      // Check guild capacity
      if (guild.memberCount >= this.MAX_GUILD_MEMBERS) {
        return {
          success: false,
          error: 'Guild is at maximum capacity',
          errorCode: 'GUILD_FULL',
        };
      }

      // Create membership
      const membershipInput: AddMemberInput = {
        guildId: validatedRequest.guildId,
        playerId: validatedRequest.playerId,
        role: validatedRequest.role,
        invitedBy: validatedRequest.inviterPlayerId,
      };

      const membership = await this.guildsRepo.addMembership(membershipInput);

      this.serviceLogger.info({
        event: 'player_invited',
        guildId: validatedRequest.guildId,
        playerId: validatedRequest.playerId,
        inviterPlayerId: validatedRequest.inviterPlayerId,
        role: validatedRequest.role,
      }, 'Player successfully invited to guild');

      return {
        success: true,
        guild,
        membership,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'guild_invite_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        request,
      }, 'Guild invitation failed');

      return {
        success: false,
        error: 'Failed to invite player',
        errorCode: 'VALIDATION_ERROR',
      };
    }
  }

  /**
   * Promote or demote a guild member
   */
  async updateMemberRole(request: GuildPromoteRequest): Promise<GuildOperationResult> {
    try {
      const validatedRequest = GuildPromoteRequestSchema.parse(request);

      this.serviceLogger.info({
        event: 'role_update_attempt',
        guildId: validatedRequest.guildId,
        targetPlayerId: validatedRequest.targetPlayerId,
        promoterPlayerId: validatedRequest.promoterPlayerId,
        newRole: validatedRequest.newRole,
      }, 'Attempting to update member role');

      // Verify guild exists
      const guild = await this.guildsRepo.findById(validatedRequest.guildId);
      if (!guild) {
        return {
          success: false,
          error: 'Guild not found',
          errorCode: 'GUILD_NOT_FOUND',
        };
      }

      // Verify promoter has permission
      const promoterMembership = await this.guildsRepo.getMembership(validatedRequest.guildId, validatedRequest.promoterPlayerId);
      if (!promoterMembership || !canPromoteMembers(promoterMembership.role)) {
        return {
          success: false,
          error: 'Insufficient permissions to promote members',
          errorCode: 'INSUFFICIENT_PERMISSIONS',
        };
      }

      // Verify target member exists
      const targetMembership = await this.guildsRepo.getMembership(validatedRequest.guildId, validatedRequest.targetPlayerId);
      if (!targetMembership) {
        return {
          success: false,
          error: 'Target player is not a guild member',
          errorCode: 'PLAYER_NOT_FOUND',
        };
      }

      // Verify promoter has higher role than target
      if (!isHigherRole(promoterMembership.role, targetMembership.role)) {
        return {
          success: false,
          error: 'Cannot promote members of equal or higher rank',
          errorCode: 'INSUFFICIENT_PERMISSIONS',
        };
      }

      // Special handling for leader role changes
      if (validatedRequest.newRole === GuildRole.LEADER) {
        if (promoterMembership.role !== GuildRole.LEADER) {
          return {
            success: false,
            error: 'Only current leader can transfer leadership',
            errorCode: 'INSUFFICIENT_PERMISSIONS',
          };
        }
        // TODO: Implement leadership transfer logic (demote current leader to officer)
      }

      // Update role
      const updatedMembership = await this.guildsRepo.updateMembershipRole(
        validatedRequest.guildId,
        validatedRequest.targetPlayerId,
        validatedRequest.newRole
      );

      if (!updatedMembership) {
        return {
          success: false,
          error: 'Failed to update member role',
          errorCode: 'VALIDATION_ERROR',
        };
      }

      this.serviceLogger.info({
        event: 'role_updated',
        guildId: validatedRequest.guildId,
        targetPlayerId: validatedRequest.targetPlayerId,
        oldRole: targetMembership.role,
        newRole: validatedRequest.newRole,
        promoterPlayerId: validatedRequest.promoterPlayerId,
      }, `Member role updated from ${targetMembership.role} to ${validatedRequest.newRole}`);

      return {
        success: true,
        guild,
        membership: updatedMembership,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'role_update_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        request,
      }, 'Role update failed');

      return {
        success: false,
        error: 'Failed to update member role',
        errorCode: 'VALIDATION_ERROR',
      };
    }
  }

  /**
   * Remove a member from the guild
   */
  async kickMember(request: GuildKickRequest): Promise<GuildOperationResult> {
    try {
      const validatedRequest = GuildKickRequestSchema.parse(request);

      this.serviceLogger.info({
        event: 'kick_attempt',
        guildId: validatedRequest.guildId,
        targetPlayerId: validatedRequest.targetPlayerId,
        kickerPlayerId: validatedRequest.kickerPlayerId,
        reason: validatedRequest.reason,
      }, 'Attempting to kick guild member');

      // Verify guild exists
      const guild = await this.guildsRepo.findById(validatedRequest.guildId);
      if (!guild) {
        return {
          success: false,
          error: 'Guild not found',
          errorCode: 'GUILD_NOT_FOUND',
        };
      }

      // Verify kicker has permission (unless kicking themselves)
      const kickerMembership = await this.guildsRepo.getMembership(validatedRequest.guildId, validatedRequest.kickerPlayerId);
      const isSelfKick = validatedRequest.kickerPlayerId === validatedRequest.targetPlayerId;
      
      if (!isSelfKick && (!kickerMembership || !canKickMembers(kickerMembership.role))) {
        return {
          success: false,
          error: 'Insufficient permissions to kick members',
          errorCode: 'INSUFFICIENT_PERMISSIONS',
        };
      }

      // Verify target member exists
      const targetMembership = await this.guildsRepo.getMembership(validatedRequest.guildId, validatedRequest.targetPlayerId);
      if (!targetMembership) {
        return {
          success: false,
          error: 'Target player is not a guild member',
          errorCode: 'PLAYER_NOT_FOUND',
        };
      }

      // Prevent kicking higher or equal rank (unless self-kick)
      if (!isSelfKick && kickerMembership && !isHigherRole(kickerMembership.role, targetMembership.role)) {
        return {
          success: false,
          error: 'Cannot kick members of equal or higher rank',
          errorCode: 'INSUFFICIENT_PERMISSIONS',
        };
      }

      // Prevent leader from leaving without transferring leadership
      if (targetMembership.role === GuildRole.LEADER && guild.memberCount > 1) {
        return {
          success: false,
          error: 'Guild leader must transfer leadership before leaving',
          errorCode: 'INSUFFICIENT_PERMISSIONS',
        };
      }

      // Remove membership
      const removed = await this.guildsRepo.removeMembership(validatedRequest.guildId, validatedRequest.targetPlayerId);
      if (!removed) {
        return {
          success: false,
          error: 'Failed to remove member',
          errorCode: 'VALIDATION_ERROR',
        };
      }

      this.serviceLogger.info({
        event: 'member_kicked',
        guildId: validatedRequest.guildId,
        targetPlayerId: validatedRequest.targetPlayerId,
        kickerPlayerId: validatedRequest.kickerPlayerId,
        targetRole: targetMembership.role,
        reason: validatedRequest.reason,
        isSelfKick,
      }, `Member ${isSelfKick ? 'left' : 'kicked from'} guild`);

      return {
        success: true,
        guild,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'kick_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        request,
      }, 'Member kick failed');

      return {
        success: false,
        error: 'Failed to kick member',
        errorCode: 'VALIDATION_ERROR',
      };
    }
  }

  /**
   * Get guild information with member list
   */
  async getGuildInfo(guildId: string): Promise<{
    guild?: Guild;
    members?: GuildMembership[];
    error?: string;
  }> {
    try {
      const guild = await this.guildsRepo.findById(guildId);
      if (!guild) {
        return { error: 'Guild not found' };
      }

      const members = await this.guildsRepo.getMemberships(guildId);

      return { guild, members };
    } catch (error) {
      this.serviceLogger.error({
        event: 'guild_info_error',
        guildId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to get guild info');

      return { error: 'Failed to get guild information' };
    }
  }
}

// Factory function
export function createGuildService(
  guildsRepo: IGuildsRepository,
  playersRepo: IPlayersRepository
): GuildService {
  return new GuildService(guildsRepo, playersRepo);
}