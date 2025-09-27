import { z } from 'zod';

// Replay Status Enum
export const ReplayStatus = {
  RECORDING: 'recording',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PURGED: 'purged'
} as const;

export type ReplayStatusType = typeof ReplayStatus[keyof typeof ReplayStatus];

export const ReplayStatusSchema = z.enum(['recording', 'completed', 'failed', 'purged']);

// Replay Metadata Entity
export interface ReplayMetadata {
  readonly id: string; // UUID
  readonly instanceId: string; // UUID - reference to Instance
  readonly status: ReplayStatusType;
  readonly createdAt: Date;
  readonly completedAt?: Date;
  readonly sizeBytes: number;
  readonly expiresAt: Date; // 7 days from completion
  readonly storageRef: string; // Path or object key for actual replay data
  readonly eventCount?: number; // Number of events recorded
  readonly checksum?: string; // Data integrity verification
}

export const ReplayMetadataSchema = z.object({
  id: z.string().uuid(),
  instanceId: z.string().uuid(),
  status: ReplayStatusSchema,
  createdAt: z.date(),
  completedAt: z.date().optional(),
  sizeBytes: z.number().int().min(0),
  expiresAt: z.date(),
  storageRef: z.string().min(1),
  eventCount: z.number().int().min(0).optional(),
  checksum: z.string().optional()
});

// Replay Event Entry (for JSON Lines format)
export interface ReplayEvent {
  readonly seq: number; // Monotonic sequence number
  readonly timestamp: number; // Unix timestamp in milliseconds
  readonly type: string; // Event type (e.g., "tile_placed", "player_joined")
  readonly playerId?: string; // UUID - actor (if applicable)
  readonly data: Record<string, unknown>; // Event-specific payload
  readonly metadata?: {
    readonly tick?: number; // Game tick when event occurred
    readonly ruleVersion?: string;
  };
}

export const ReplayEventSchema = z.object({
  seq: z.number().int().min(1),
  timestamp: z.number().int().min(0),
  type: z.string().min(1),
  playerId: z.string().uuid().optional(),
  data: z.record(z.unknown()),
  metadata: z.object({
    tick: z.number().int().min(0).optional(),
    ruleVersion: z.string().optional()
  }).optional()
});

// Create Replay Input
export interface CreateReplayInput {
  readonly instanceId: string;
  readonly storageRef: string;
}

export const CreateReplayInputSchema = z.object({
  instanceId: z.string().uuid(),
  storageRef: z.string().min(1)
});

// Update Replay Input
export interface UpdateReplayInput {
  readonly id: string;
  readonly status?: ReplayStatusType;
  readonly sizeBytes?: number;
  readonly eventCount?: number;
  readonly checksum?: string;
}

export const UpdateReplayInputSchema = z.object({
  id: z.string().uuid(),
  status: ReplayStatusSchema.optional(),
  sizeBytes: z.number().int().min(0).optional(),
  eventCount: z.number().int().min(0).optional(),
  checksum: z.string().optional()
});

// Replay Query Input
export interface ReplayQueryInput {
  readonly replayId: string;
  readonly requesterId?: string; // Player ID for access control
}

export const ReplayQueryInputSchema = z.object({
  replayId: z.string().uuid(),
  requesterId: z.string().uuid().optional()
});

// Constants
export const REPLAY_RETENTION_DAYS = 7;
export const REPLAY_RETENTION_MS = REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Helper Functions
export function calculateExpirationDate(completedAt: Date = new Date()): Date {
  return new Date(completedAt.getTime() + REPLAY_RETENTION_MS);
}

export function isReplayExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

export function isReplayAvailable(replay: ReplayMetadata): boolean {
  return replay.status === ReplayStatus.COMPLETED && !isReplayExpired(replay.expiresAt);
}

export function generateStorageRef(instanceId: string, timestamp: number = Date.now()): string {
  return `replays/${instanceId}/${timestamp}.jsonl.gz`;
}

export function estimateReplaySize(eventCount: number): number {
  // Rough estimation: ~200 bytes per event after compression
  const avgEventSizeBytes = 200;
  return eventCount * avgEventSizeBytes;
}

// Replay Event Builders
export function createTilePlacedEvent(
  seq: number,
  playerId: string,
  x: number,
  y: number,
  tileType: string,
  tick: number
): ReplayEvent {
  return {
    seq,
    timestamp: Date.now(),
    type: 'tile_placed',
    playerId,
    data: { x, y, tileType },
    metadata: { tick }
  };
}

export function createPlayerJoinedEvent(
  seq: number,
  playerId: string,
  displayName: string
): ReplayEvent {
  return {
    seq,
    timestamp: Date.now(),
    type: 'player_joined',
    playerId,
    data: { displayName },
    metadata: {}
  };
}

export function createPlayerLeftEvent(
  seq: number,
  playerId: string,
  reason: 'disconnect' | 'kicked' | 'finished'
): ReplayEvent {
  return {
    seq,
    timestamp: Date.now(),
    type: 'player_left',
    playerId,
    data: { reason },
    metadata: {}
  };
}

export function createInstanceResolvedEvent(
  seq: number,
  outcome: 'victory' | 'draw' | 'aborted',
  winners?: string[]
): ReplayEvent {
  return {
    seq,
    timestamp: Date.now(),
    type: 'instance_resolved',
    data: { outcome, winners: winners || [] },
    metadata: {}
  };
}

// Replay Validation
export function validateReplayEvent(event: unknown): event is ReplayEvent {
  try {
    ReplayEventSchema.parse(event);
    return true;
  } catch {
    return false;
  }
}

export function validateReplaySequence(events: ReplayEvent[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (events.length === 0) {
    return { isValid: true, errors: [] };
  }
  
  // Check sequence numbers are continuous starting from 1
  for (let i = 0; i < events.length; i++) {
    const expectedSeq = i + 1;
    if (events[i]!.seq !== expectedSeq) {
      errors.push(`Expected sequence ${expectedSeq} but got ${events[i]!.seq} at index ${i}`);
    }
  }
  
  // Check timestamps are non-decreasing
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.timestamp < events[i - 1]!.timestamp) {
      errors.push(`Timestamp decreased between events ${i - 1} and ${i}`);
    }
  }
  
  return { isValid: errors.length === 0, errors };
}