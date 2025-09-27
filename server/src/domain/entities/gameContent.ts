import { z } from 'zod';

// AI Entity Type Classifications
export const AIEntityType = {
  BASIC_NPC: 'basic_npc',
  AGGRESSIVE_NPC: 'aggressive_npc',
  DEFENSIVE_NPC: 'defensive_npc',
  SCRIPTED_SCENARIO: 'scripted_scenario',
  ENVIRONMENTAL_AGENT: 'environmental_agent'
} as const;

export type AIEntityTypeType = typeof AIEntityType[keyof typeof AIEntityType];

export const AIEntityTypeSchema = z.enum(['basic_npc', 'aggressive_npc', 'defensive_npc', 'scripted_scenario', 'environmental_agent']);

// AI Entity
export interface AIEntity {
  readonly id: string; // UUID
  readonly instanceId?: string; // UUID - for battle instances
  readonly arenaId?: string; // UUID - for arena sessions
  readonly type: AIEntityTypeType;
  readonly spawnedAt: Date;
  readonly despawnedAt?: Date;
  readonly config?: Record<string, unknown>; // AI-specific configuration
}

export const AIEntitySchema = z.object({
  id: z.string().uuid(),
  instanceId: z.string().uuid().optional(),
  arenaId: z.string().uuid().optional(),
  type: AIEntityTypeSchema,
  spawnedAt: z.date(),
  despawnedAt: z.date().optional(),
  config: z.record(z.unknown()).optional()
}).refine(
  data => (data.instanceId && !data.arenaId) || (!data.instanceId && data.arenaId),
  { message: "AI Entity must belong to either an instance or arena, but not both" }
);

// Rule Config Version Entity
export interface RuleConfigVersion {
  readonly versionId: string; // Semantic version (e.g., "1.2.3")
  readonly createdAt: Date;
  readonly checksum: string; // SHA-256 hash for integrity
  readonly config: Record<string, unknown>; // Rule parameters as JSON
  readonly description?: string;
  readonly isActive: boolean;
}

export const RuleConfigVersionSchema = z.object({
  versionId: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning (x.y.z)'),
  createdAt: z.date(),
  checksum: z.string().length(64, 'Checksum must be a 64-character SHA-256 hash'),
  config: z.record(z.unknown()).refine(obj => Object.keys(obj).length > 0, 'Config cannot be empty'),
  description: z.string().max(500).optional(),
  isActive: z.boolean()
});

// AI Entity Creation Input
export interface CreateAIEntityInput {
  readonly instanceId?: string;
  readonly arenaId?: string;
  readonly type: AIEntityTypeType;
  readonly config?: Record<string, unknown>;
}

export const CreateAIEntityInputSchema = z.object({
  instanceId: z.string().uuid().optional(),
  arenaId: z.string().uuid().optional(),
  type: AIEntityTypeSchema,
  config: z.record(z.unknown()).optional()
}).refine(
  data => (data.instanceId && !data.arenaId) || (!data.instanceId && data.arenaId),
  { message: "AI Entity must belong to either an instance or arena, but not both" }
);

// Rule Config Creation Input
export interface CreateRuleConfigInput {
  readonly versionId: string;
  readonly config: Record<string, unknown>;
  readonly description?: string;
}

export const CreateRuleConfigInputSchema = z.object({
  versionId: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning (x.y.z)'),
  config: z.record(z.unknown()).refine(obj => Object.keys(obj).length > 0, 'Config cannot be empty'),
  description: z.string().max(500).optional()
});

// AI Capacity Management
export interface AICapacityConfig {
  readonly baseCaps: {
    readonly small: number;
    readonly standard: number; 
    readonly large: number;
    readonly epic: number;
  };
  readonly floors: {
    readonly small: number;
    readonly standard: number;
    readonly large: number; 
    readonly epic: number;
  };
  readonly reductionStepPercent: number;
  readonly maxReductionSteps: number;
}

export const DEFAULT_AI_CAPACITY_CONFIG: AICapacityConfig = {
  baseCaps: {
    small: 8,
    standard: 16,
    large: 40,
    epic: 100
  },
  floors: {
    small: 4,
    standard: 8,
    large: 20,
    epic: 50
  },
  reductionStepPercent: 25,
  maxReductionSteps: 2
} as const;

// AI Management Helpers
export function isAIEntityActive(entity: AIEntity): boolean {
  return !entity.despawnedAt;
}

export function getAICapacityForTier(tier: 'small' | 'standard' | 'large' | 'epic', config: AICapacityConfig = DEFAULT_AI_CAPACITY_CONFIG): number {
  return config.baseCaps[tier];
}

export function getAIFloorForTier(tier: 'small' | 'standard' | 'large' | 'epic', config: AICapacityConfig = DEFAULT_AI_CAPACITY_CONFIG): number {
  return config.floors[tier];
}

export function calculateReducedAICapacity(
  baseCap: number, 
  reductionSteps: number, 
  floor: number,
  config: AICapacityConfig = DEFAULT_AI_CAPACITY_CONFIG
): number {
  if (reductionSteps <= 0) return baseCap;
  
  const maxSteps = Math.min(reductionSteps, config.maxReductionSteps);
  const reductionAmount = Math.floor(baseCap * (config.reductionStepPercent / 100) * maxSteps);
  const reducedCap = baseCap - reductionAmount;
  
  return Math.max(reducedCap, floor);
}

// Rule Config Helpers
export function generateConfigChecksum(config: Record<string, unknown>): string {
  // Note: In real implementation, use crypto.createHash('sha256')
  // This is a placeholder that would need proper implementation
  const configString = JSON.stringify(config, Object.keys(config).sort());
  return `placeholder_checksum_${configString.length}_${Date.now()}`;
}

export function isNewerVersion(version1: string, version2: string): boolean {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;
    
    if (v1Part > v2Part) return true;
    if (v1Part < v2Part) return false;
  }
  
  return false;
}