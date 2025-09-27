import { z } from 'zod';

// Guild Role Enum
export const GuildRole = {
  LEADER: 'leader',
  OFFICER: 'officer',
  VETERAN: 'veteran',
  MEMBER: 'member'
} as const;

export type GuildRoleType = typeof GuildRole[keyof typeof GuildRole];

export const GuildRoleSchema = z.enum(['leader', 'officer', 'veteran', 'member']);

// Guild Entity
export interface Guild {
  readonly id: string; // UUID
  readonly name: string;
  readonly leaderPlayerId: string; // UUID
  readonly createdAt: Date;
  readonly deletedAt?: Date;
  readonly memberCount: number; // Cached denormalized count
}

export const GuildSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(32),
  leaderPlayerId: z.string().uuid(),
  createdAt: z.date(),
  deletedAt: z.date().optional(),
  memberCount: z.number().int().min(0).max(1000)
});

// Guild Membership Entity
export interface GuildMembership {
  readonly playerId: string; // UUID
  readonly guildId: string; // UUID  
  readonly role: GuildRoleType;
  readonly joinedAt: Date;
}

export const GuildMembershipSchema = z.object({
  playerId: z.string().uuid(),
  guildId: z.string().uuid(),
  role: GuildRoleSchema,
  joinedAt: z.date()
});

// Guild Creation Input
export interface CreateGuildInput {
  readonly name: string;
  readonly leaderPlayerId: string;
}

export const CreateGuildInputSchema = z.object({
  name: z.string()
    .min(3, 'Guild name must be at least 3 characters')
    .max(32, 'Guild name cannot exceed 32 characters')
    .regex(/^[a-zA-Z0-9\s_-]+$/, 'Guild name must contain only letters, numbers, spaces, underscores, and hyphens')
    .transform(name => name.trim()),
  leaderPlayerId: z.string().uuid()
});

// Guild Membership Operations
export interface AddMemberInput {
  readonly guildId: string;
  readonly playerId: string;
  readonly role: GuildRoleType;
  readonly invitedBy: string; // UUID of inviting player
}

export const AddMemberInputSchema = z.object({
  guildId: z.string().uuid(),
  playerId: z.string().uuid(),
  role: GuildRoleSchema,
  invitedBy: z.string().uuid()
});

export interface UpdateMemberRoleInput {
  readonly guildId: string;
  readonly playerId: string;
  readonly newRole: GuildRoleType;
  readonly updatedBy: string; // UUID of player making the change
}

export const UpdateMemberRoleInputSchema = z.object({
  guildId: z.string().uuid(),
  playerId: z.string().uuid(),
  newRole: GuildRoleSchema,
  updatedBy: z.string().uuid()
});

export interface RemoveMemberInput {
  readonly guildId: string;
  readonly playerId: string;
  readonly removedBy: string; // UUID of player removing (or self for leaving)
}

export const RemoveMemberInputSchema = z.object({
  guildId: z.string().uuid(),
  playerId: z.string().uuid(),
  removedBy: z.string().uuid()
});

// Guild Name Normalization Utility
export function normalizeGuildName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Role Permission Helpers
export function canInviteMembers(role: GuildRoleType): boolean {
  return role === GuildRole.LEADER || role === GuildRole.OFFICER || role === GuildRole.VETERAN;
}

export function canKickMembers(role: GuildRoleType): boolean {
  return role === GuildRole.LEADER || role === GuildRole.OFFICER;
}

export function canPromoteMembers(role: GuildRoleType): boolean {
  return role === GuildRole.LEADER || role === GuildRole.OFFICER;
}

export function canManageGuild(role: GuildRoleType): boolean {
  return role === GuildRole.LEADER;
}

export function isHigherRole(role1: GuildRoleType, role2: GuildRoleType): boolean {
  const hierarchy = {
    [GuildRole.LEADER]: 4,
    [GuildRole.OFFICER]: 3,
    [GuildRole.VETERAN]: 2,
    [GuildRole.MEMBER]: 1
  };
  return hierarchy[role1]! > hierarchy[role2]!;
}