import { z } from 'zod';

// Player Status Enum
export const PlayerStatus = {
  ACTIVE: 'active',
  BANNED: 'banned', 
  DORMANT: 'dormant'
} as const;

export type PlayerStatusType = typeof PlayerStatus[keyof typeof PlayerStatus];

export const PlayerStatusSchema = z.enum(['active', 'banned', 'dormant']);

// Player Entity
export interface Player {
  readonly id: string; // UUID
  readonly displayName: string;
  readonly createdAt: Date;
  readonly lastLoginAt: Date;
  readonly status: PlayerStatusType;
  readonly blockListVersion: number;
}

export const PlayerSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(32),
  createdAt: z.date(),
  lastLoginAt: z.date(),
  status: PlayerStatusSchema,
  blockListVersion: z.number().int().min(0)
});

// Block List Entry Entity
export interface BlockListEntry {
  readonly ownerPlayerId: string; // UUID
  readonly blockedPlayerId: string; // UUID
  readonly createdAt: Date;
}

export const BlockListEntrySchema = z.object({
  ownerPlayerId: z.string().uuid(),
  blockedPlayerId: z.string().uuid(),
  createdAt: z.date()
}).refine(
  data => data.ownerPlayerId !== data.blockedPlayerId,
  { message: "Cannot block yourself" }
);

// Player Creation Input
export interface CreatePlayerInput {
  readonly displayName: string;
}

export const CreatePlayerInputSchema = z.object({
  displayName: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Display name must be alphanumeric with underscores/hyphens only')
});

// Player Update Input
export interface UpdatePlayerInput {
  readonly displayName?: string;
  readonly status?: PlayerStatusType;
}

export const UpdatePlayerInputSchema = z.object({
  displayName: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  status: PlayerStatusSchema.optional()
});

// Block List Operations
export interface BlockPlayerInput {
  readonly ownerPlayerId: string;
  readonly blockedPlayerId: string;
}

export const BlockPlayerInputSchema = z.object({
  ownerPlayerId: z.string().uuid(),
  blockedPlayerId: z.string().uuid()
}).refine(
  data => data.ownerPlayerId !== data.blockedPlayerId,
  { message: "Cannot block yourself" }
);