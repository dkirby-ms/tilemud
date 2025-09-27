import { z } from 'zod';

// Instance/Session Mode Enum
export const SessionMode = {
  BATTLE: 'battle',
  ARENA: 'arena'
} as const;

export type SessionModeType = typeof SessionMode[keyof typeof SessionMode];

export const SessionModeSchema = z.enum(['battle', 'arena']);

// Instance State Enum
export const InstanceState = {
  PENDING: 'pending',
  ACTIVE: 'active', 
  RESOLVED: 'resolved',
  ABORTED: 'aborted'
} as const;

export type InstanceStateType = typeof InstanceState[keyof typeof InstanceState];

export const InstanceStateSchema = z.enum(['pending', 'active', 'resolved', 'aborted']);

// Arena Tier Enum  
export const ArenaTier = {
  SMALL: 'small',
  LARGE: 'large',
  EPIC: 'epic'
} as const;

export type ArenaTierType = typeof ArenaTier[keyof typeof ArenaTier];

export const ArenaTierSchema = z.enum(['small', 'large', 'epic']);

// Instance (Battle) Entity
export interface Instance {
  readonly id: string; // UUID
  readonly mode: SessionModeType;
  readonly state: InstanceStateType;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly resolvedAt?: Date;
  readonly ruleConfigVersion: string;
  readonly replayId?: string; // UUID
  readonly initialHumanCount: number;
  readonly shardKey: string; // Mode|Region|ShardIndex composite
}

export const InstanceSchema = z.object({
  id: z.string().uuid(),
  mode: SessionModeSchema,
  state: InstanceStateSchema,
  createdAt: z.date(),
  startedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  ruleConfigVersion: z.string().min(1),
  replayId: z.string().uuid().optional(),
  initialHumanCount: z.number().int().min(1).max(1000),
  shardKey: z.string().min(1)
});

// Arena Entity
export interface Arena {
  readonly id: string; // UUID
  readonly tier: ArenaTierType;
  readonly currentHumanCount: number;
  readonly currentAICount: number;
  readonly region: string;
  readonly shardKey: string; // Mode|Region|ShardIndex composite
  readonly createdAt: Date;
}

export const ArenaSchema = z.object({
  id: z.string().uuid(),
  tier: ArenaTierSchema,
  currentHumanCount: z.number().int().min(0).max(300),
  currentAICount: z.number().int().min(0).max(100),
  region: z.string().min(1),
  shardKey: z.string().min(1),
  createdAt: z.date()
});

// Create Instance Input
export interface CreateInstanceInput {
  readonly mode: SessionModeType;
  readonly ruleConfigVersion: string;
  readonly region: string;
  readonly initialHumanCount: number;
}

export const CreateInstanceInputSchema = z.object({
  mode: SessionModeSchema,
  ruleConfigVersion: z.string().min(1),
  region: z.string().min(1),
  initialHumanCount: z.number().int().min(1).max(1000)
});

// Create Arena Input
export interface CreateArenaInput {
  readonly tier: ArenaTierType;
  readonly region: string;
}

export const CreateArenaInputSchema = z.object({
  tier: ArenaTierSchema,
  region: z.string().min(1)
});

// State Machine Helpers
export function canTransitionTo(currentState: InstanceStateType, newState: InstanceStateType): boolean {
  const transitions: Record<InstanceStateType, InstanceStateType[]> = {
    [InstanceState.PENDING]: [InstanceState.ACTIVE],
    [InstanceState.ACTIVE]: [InstanceState.RESOLVED, InstanceState.ABORTED],
    [InstanceState.RESOLVED]: [], // Terminal state
    [InstanceState.ABORTED]: []   // Terminal state
  };
  
  return transitions[currentState]?.includes(newState) ?? false;
}

export function isTerminalState(state: InstanceStateType): boolean {
  return state === InstanceState.RESOLVED || state === InstanceState.ABORTED;
}

// Arena Capacity Helpers
export function getArenaCapacity(tier: ArenaTierType): number {
  const capacities = {
    [ArenaTier.SMALL]: 80,
    [ArenaTier.LARGE]: 160,
    [ArenaTier.EPIC]: 300
  };
  return capacities[tier];
}

export function getArenaUtilization(arena: Arena): number {
  const capacity = getArenaCapacity(arena.tier);
  return arena.currentHumanCount / capacity;
}

export function isArenaAtQueueThreshold(arena: Arena): boolean {
  return getArenaUtilization(arena) >= 0.9; // 90% threshold for queueing
}

export function isArenaAtCapacity(arena: Arena): boolean {
  return arena.currentHumanCount >= getArenaCapacity(arena.tier);
}

// Shard Key Generation
export function generateShardKey(mode: SessionModeType, region: string, shardIndex: number): string {
  return `${mode}|${region}|${shardIndex}`;
}

export function parseShardKey(shardKey: string): { mode: SessionModeType; region: string; shardIndex: number } | null {
  const parts = shardKey.split('|');
  if (parts.length !== 3) return null;
  
  const [mode, region, shardIndexStr] = parts;
  const shardIndex = parseInt(shardIndexStr!, 10);
  
  if (!mode || !region || isNaN(shardIndex) || shardIndex < 0) return null;
  if (!Object.values(SessionMode).includes(mode as SessionModeType)) return null;
  
  return { 
    mode: mode as SessionModeType, 
    region: region, 
    shardIndex 
  };
}

// Quorum Calculation (for soft-fail detection)
export function calculateQuorum(initialHumanCount: number): number {
  return Math.min(Math.floor(initialHumanCount / 2), 3);
}