import { z } from 'zod';

// Chat Channel Type Enum
export const ChatChannelType = {
  PRIVATE: 'private',
  GUILD: 'guild', 
  PARTY: 'party',
  ARENA: 'arena',
  SYSTEM: 'system'
} as const;

export type ChatChannelTypeType = typeof ChatChannelType[keyof typeof ChatChannelType];

export const ChatChannelTypeSchema = z.enum(['private', 'guild', 'party', 'arena', 'system']);

// Retention Policy Enum
export const RetentionPolicy = {
  PRIVATE_7D: 'private7d',
  GUILD_7D: 'guild7d',
  PARTY_24H: 'party24h',
  PUBLIC_12H: 'public12h',
  SYSTEM_30D: 'system30d'
} as const;

export type RetentionPolicyType = typeof RetentionPolicy[keyof typeof RetentionPolicy];

export const RetentionPolicySchema = z.enum(['private7d', 'guild7d', 'party24h', 'public12h', 'system30d']);

// Chat Channel Entity
export interface ChatChannel {
  readonly id: string; // UUID
  readonly channelType: ChatChannelTypeType;
  readonly scopeRef?: string; // UUID - guildId, arenaId, etc.
  readonly retentionPolicy: RetentionPolicyType;
  readonly createdAt: Date;
  readonly lastActiveAt?: Date;
}

export const ChatChannelSchema = z.object({
  id: z.string().uuid(),
  channelType: ChatChannelTypeSchema,
  scopeRef: z.string().uuid().optional(),
  retentionPolicy: RetentionPolicySchema,
  createdAt: z.date(),
  lastActiveAt: z.date().optional()
});

// Chat Message Entity
export interface ChatMessage {
  readonly id: string; // UUID
  readonly channelId: string; // UUID
  readonly senderPlayerId: string; // UUID
  readonly seq: number; // Monotonic per-channel sequence
  readonly createdAt: Date;
  readonly content: string;
  readonly editedAt?: Date;
  readonly deletedAt?: Date;
}

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  senderPlayerId: z.string().uuid(),
  seq: z.number().int().min(1),
  createdAt: z.date(),
  content: z.string().min(1).max(512), // Max 512 chars as per spec
  editedAt: z.date().optional(),
  deletedAt: z.date().optional()
});

// Create Chat Channel Input
export interface CreateChatChannelInput {
  readonly channelType: ChatChannelTypeType;
  readonly scopeRef?: string;
}

export const CreateChatChannelInputSchema = z.object({
  channelType: ChatChannelTypeSchema,
  scopeRef: z.string().uuid().optional()
});

// Send Chat Message Input
export interface SendChatMessageInput {
  readonly channelId: string;
  readonly senderPlayerId: string;
  readonly content: string;
}

export const SendChatMessageInputSchema = z.object({
  channelId: z.string().uuid(),
  senderPlayerId: z.string().uuid(),
  content: z.string().min(1).max(512).transform(content => content.trim())
});

// Retention Policy Helpers
export function getRetentionPolicyForChannelType(channelType: ChatChannelTypeType): RetentionPolicyType {
  const mapping: Record<ChatChannelTypeType, RetentionPolicyType> = {
    [ChatChannelType.PRIVATE]: RetentionPolicy.PRIVATE_7D,
    [ChatChannelType.GUILD]: RetentionPolicy.GUILD_7D,
    [ChatChannelType.PARTY]: RetentionPolicy.PARTY_24H,
    [ChatChannelType.ARENA]: RetentionPolicy.PUBLIC_12H,
    [ChatChannelType.SYSTEM]: RetentionPolicy.SYSTEM_30D
  };
  return mapping[channelType];
}

export function getRetentionDurationMs(policy: RetentionPolicyType): number {
  const durations: Record<RetentionPolicyType, number> = {
    [RetentionPolicy.PRIVATE_7D]: 7 * 24 * 60 * 60 * 1000, // 7 days
    [RetentionPolicy.GUILD_7D]: 7 * 24 * 60 * 60 * 1000,   // 7 days
    [RetentionPolicy.PARTY_24H]: 24 * 60 * 60 * 1000,      // 24 hours
    [RetentionPolicy.PUBLIC_12H]: 12 * 60 * 60 * 1000,     // 12 hours
    [RetentionPolicy.SYSTEM_30D]: 30 * 24 * 60 * 60 * 1000 // 30 days
  };
  return durations[policy];
}

export function calculateExpirationDate(policy: RetentionPolicyType, createdAt: Date = new Date()): Date {
  const durationMs = getRetentionDurationMs(policy);
  return new Date(createdAt.getTime() + durationMs);
}

// Delivery Semantics Helpers
export function requiresExactlyOnceDelivery(channelType: ChatChannelTypeType): boolean {
  return channelType === ChatChannelType.PRIVATE || 
         channelType === ChatChannelType.GUILD || 
         channelType === ChatChannelType.PARTY;
}

export function isHighVolumeChannel(channelType: ChatChannelTypeType): boolean {
  return channelType === ChatChannelType.ARENA || 
         channelType === ChatChannelType.SYSTEM;
}

// Message Sanitization
export function sanitizeChatContent(content: string): string {
  // Basic sanitization - remove excessive whitespace, trim
  return content
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 512); // Enforce max length
}

// Channel ID Generation Helpers
export function generatePrivateChannelId(playerId1: string, playerId2: string): string {
  // Deterministic channel ID for private chats between two players
  const sortedIds = [playerId1, playerId2].sort();
  return `private_${sortedIds[0]}_${sortedIds[1]}`;
}

export function generateGuildChannelId(guildId: string): string {
  return `guild_${guildId}`;
}

export function generateArenaChannelId(arenaId: string): string {
  return `arena_${arenaId}`;
}

export function generateSystemChannelId(): string {
  return 'system_global';
}

// Message Sequence Helpers
export function isValidSequenceNumber(seq: number, lastSeq?: number): boolean {
  if (lastSeq === undefined) return seq === 1;
  return seq === lastSeq + 1;
}

// Chat History Query Helper Types
export interface ChatHistoryQuery {
  readonly channelId: string;
  readonly limit?: number;
  readonly beforeSeq?: number;
  readonly afterSeq?: number;
  readonly playerId?: string; // For access control
}

export const ChatHistoryQuerySchema = z.object({
  channelId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  beforeSeq: z.number().int().min(1).optional(),
  afterSeq: z.number().int().min(1).optional(),
  playerId: z.string().uuid().optional()
});