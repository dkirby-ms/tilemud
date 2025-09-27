import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ReplayWriter, ReplayWriterConfig, ReplayEventInput } from '../../src/application/services/replayWriter';
import { IReplayRepository, RecordEventInput } from '../../src/infra/persistence/replayRepository';
import { ReplayMetadata, CreateReplayInput } from '../../src/domain/entities/replay';

// Mock the logger module
vi.mock('../../src/infra/monitoring/logger', () => ({
  createServiceLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ReplayWriter', () => {
  let replayWriter: ReplayWriter;
  let mockReplayRepo: IReplayRepository;
  
  const testReplayId = 'b47ac10b-58cc-4372-a567-0e02b2c3d479';
  const testInstanceId = 'instance-123';

  // Helper function to create mock replay metadata
  const createMockReplayMetadata = (
    id: string = testReplayId,
    instanceId: string = testInstanceId,
    status: 'recording' | 'completed' = 'recording',
    eventCount?: number,
    sizeBytes: number = 0
  ): ReplayMetadata => ({
    id,
    instanceId,
    storageRef: `replays/${instanceId}/test.jsonl`,
    createdAt: new Date(),
    completedAt: status === 'completed' ? new Date() : undefined,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    status,
    eventCount,
    sizeBytes,
  });

  beforeEach(() => {
    // Mock repository implementation
    mockReplayRepo = {
      findReplayById: vi.fn(),
      createReplay: vi.fn(),
      updateReplayDuration: vi.fn(),
      finalizeReplay: vi.fn(),
      deleteReplay: vi.fn(),
      findReplaysByInstance: vi.fn(),
      findReplaysByPlayer: vi.fn(),
      findExpiredReplays: vi.fn(),
      recordEvent: vi.fn(),
      getEventsByReplay: vi.fn(),
      getEventsStream: vi.fn(),
      cleanupExpiredReplays: vi.fn(),
      getReplayStats: vi.fn(),
      validateReplayIntegrity: vi.fn(),
    };

    replayWriter = new ReplayWriter(mockReplayRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup any active timers
    replayWriter.shutdown();
  });

  describe('configuration validation', () => {
    it('should accept valid configuration parameters', () => {
      const config: ReplayWriterConfig = {
        batchSize: 50,
        flushIntervalMs: 2000,
        maxBufferSize: 5000,
        enableCompression: false,
      };

      const customReplayWriter = new ReplayWriter(mockReplayRepo, config);
      expect(customReplayWriter).toBeDefined();
    });

    it('should use default values when no config provided', () => {
      const defaultReplayWriter = new ReplayWriter(mockReplayRepo);
      expect(defaultReplayWriter).toBeDefined();
    });

    it('should reject invalid configuration values', () => {
      expect(() => new ReplayWriter(mockReplayRepo, {
        batchSize: 0, // Invalid: must be >= 1
      })).toThrow();

      expect(() => new ReplayWriter(mockReplayRepo, {
        batchSize: 2000, // Invalid: must be <= 1000
      })).toThrow();

      expect(() => new ReplayWriter(mockReplayRepo, {
        flushIntervalMs: 50, // Invalid: must be >= 100
      })).toThrow();

      expect(() => new ReplayWriter(mockReplayRepo, {
        maxBufferSize: 500, // Invalid: must be >= 1000
      })).toThrow();
    });
  });

  describe('replay initialization', () => {
    it('should initialize new replay successfully', async () => {
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);

      const replayId = await replayWriter.initializeReplay(testInstanceId);

      expect(replayId).toBe(testReplayId);
      expect(mockReplayRepo.createReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: testInstanceId,
          storageRef: expect.stringContaining(`replays/${testInstanceId}/`),
        })
      );
    });

    it('should handle initialization errors gracefully', async () => {
      vi.mocked(mockReplayRepo.createReplay).mockRejectedValue(new Error('Database connection failed'));

      await expect(replayWriter.initializeReplay(testInstanceId))
        .rejects.toThrow('Database connection failed');
    });
  });

  describe('event sequence integrity', () => {
    beforeEach(async () => {
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      vi.mocked(mockReplayRepo.recordEvent).mockResolvedValue({} as any);

      await replayWriter.initializeReplay(testInstanceId);
    });

    it('should append events in sequence', async () => {
      const event1: ReplayEventInput = {
        type: 'player_move',
        playerId: 'player-1',
        data: { x: 10, y: 20 },
        metadata: { tick: 100 },
      };

      const event2: ReplayEventInput = {
        type: 'player_attack',
        playerId: 'player-1',
        data: { target: 'monster-1', damage: 15 },
        metadata: { tick: 105 },
      };

      const result1 = await replayWriter.appendEvent(testReplayId, event1);
      const result2 = await replayWriter.appendEvent(testReplayId, event2);

      expect(result1.success).toBe(true);
      expect(result1.eventsWritten).toBe(1);
      expect(result2.success).toBe(true);
      expect(result2.eventsWritten).toBe(1);
    });

    it('should validate event input schema', async () => {
      const invalidEvent = {
        type: '', // Invalid: empty string
        data: { test: 'data' },
      };

      const result = await replayWriter.appendEvent(testReplayId, invalidEvent as ReplayEventInput);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_EVENT');
      expect(result.error).toBe('Invalid event data');
    });

    it('should handle events with valid optional fields', async () => {
      const eventWithOptionals: ReplayEventInput = {
        type: 'system_message',
        data: { message: 'Server maintenance in 5 minutes' },
        // No playerId, no metadata - should still be valid
      };

      const result = await replayWriter.appendEvent(testReplayId, eventWithOptionals);

      expect(result.success).toBe(true);
      expect(result.eventsWritten).toBe(1);
    });

    it('should reject events for non-existent replay', async () => {
      const nonExistentReplayId = 'b47ac10b-58cc-4372-a567-0e02b2c3d000';
      const event: ReplayEventInput = {
        type: 'test_event',
        data: { test: 'data' },
      };

      const result = await replayWriter.appendEvent(nonExistentReplayId, event);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('REPLAY_NOT_FOUND');
      expect(result.error).toBe('Replay not found or not recording');
    });
  });

  describe('buffering and batching', () => {
    beforeEach(async () => {
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      vi.mocked(mockReplayRepo.recordEvent).mockResolvedValue({} as any);

      await replayWriter.initializeReplay(testInstanceId);
    });

    it('should flush buffer when batch size is reached', async () => {
      // Create writer with small batch size for testing
      const testReplayWriter = new ReplayWriter(mockReplayRepo, { batchSize: 3 });
      
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      const recordEventMock = vi.mocked(mockReplayRepo.recordEvent);
      recordEventMock.mockResolvedValue({} as any);

      await testReplayWriter.initializeReplay(testInstanceId);

      // Add events - should flush after 3rd event
      const event: ReplayEventInput = {
        type: 'test_event',
        data: { counter: 0 },
      };

      await testReplayWriter.appendEvent(testReplayId, event);
      await testReplayWriter.appendEvent(testReplayId, { ...event, data: { counter: 1 } });
      await testReplayWriter.appendEvent(testReplayId, { ...event, data: { counter: 2 } });

      // Should have flushed 3 events to repository
      expect(recordEventMock).toHaveBeenCalledTimes(3);

      await testReplayWriter.shutdown();
    });

    it('should handle buffer overflow by forcing flush', async () => {
      // Create writer with tiny buffer for testing
      const testReplayWriter = new ReplayWriter(mockReplayRepo, { 
        maxBufferSize: 2,
        batchSize: 10 // Higher than maxBufferSize to force overflow
      });

      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      const recordEventMock = vi.mocked(mockReplayRepo.recordEvent);
      recordEventMock.mockResolvedValue({} as any);

      await testReplayWriter.initializeReplay(testInstanceId);

      // Add events to trigger overflow
      const event: ReplayEventInput = {
        type: 'test_event',
        data: { counter: 0 },
      };

      await testReplayWriter.appendEvent(testReplayId, event);
      await testReplayWriter.appendEvent(testReplayId, { ...event, data: { counter: 1 } });
      await testReplayWriter.appendEvent(testReplayId, { ...event, data: { counter: 2 } }); // Should trigger flush

      // Should have flushed events due to overflow
      expect(recordEventMock).toHaveBeenCalled();

      await testReplayWriter.shutdown();
    });
  });

  describe('automatic flushing', () => {
    beforeEach(async () => {
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      vi.mocked(mockReplayRepo.recordEvent).mockResolvedValue({} as any);
    });

    it('should flush buffer based on timer interval', async () => {
      // Create writer with short flush interval for testing
      const testReplayWriter = new ReplayWriter(mockReplayRepo, { 
        flushIntervalMs: 100,
        batchSize: 100 // Large batch size so timer triggers first
      });

      await testReplayWriter.initializeReplay(testInstanceId);

      // Add single event (won't trigger batch flush)
      const event: ReplayEventInput = {
        type: 'test_event',
        data: { test: 'timer_flush' },
      };

      await testReplayWriter.appendEvent(testReplayId, event);

      // Wait for timer to trigger flush
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have flushed the event via timer
      expect(mockReplayRepo.recordEvent).toHaveBeenCalled();

      await testReplayWriter.shutdown();
    });

    it('should handle flush errors gracefully', async () => {
      const testReplayWriter = new ReplayWriter(mockReplayRepo, { 
        flushIntervalMs: 100,
      });

      await testReplayWriter.initializeReplay(testInstanceId);

      // Make recordEvent fail
      vi.mocked(mockReplayRepo.recordEvent).mockRejectedValue(new Error('Storage failure'));

      const event: ReplayEventInput = {
        type: 'test_event',
        data: { test: 'error_handling' },
      };

      // Event should still be appended to buffer successfully
      const result = await testReplayWriter.appendEvent(testReplayId, event);
      expect(result.success).toBe(true);

      // Wait for timer flush (which should fail)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Error should be logged but not throw
      await testReplayWriter.shutdown();
    });
  });

  describe('replay finalization', () => {
    beforeEach(async () => {
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      vi.mocked(mockReplayRepo.recordEvent).mockResolvedValue({} as any);

      await replayWriter.initializeReplay(testInstanceId);
    });

    it('should finalize replay with pending events', async () => {
      const finalizedMetadata = createMockReplayMetadata('completed');

      vi.mocked(mockReplayRepo.finalizeReplay).mockResolvedValue(finalizedMetadata);

      // Add some events
      const event1: ReplayEventInput = {
        type: 'test_event_1',
        data: { test: 'data1' },
      };
      const event2: ReplayEventInput = {
        type: 'test_event_2',
        data: { test: 'data2' },
      };

      await replayWriter.appendEvent(testReplayId, event1);
      await replayWriter.appendEvent(testReplayId, event2);

      const result = await replayWriter.finalizeReplay(testReplayId);

      expect(result.success).toBe(true);
      expect(result.replay).toBeDefined();
      expect(result.totalEvents).toBe(2);
      expect(result.finalSize).toBe(1024);

      // Should have called repository methods
      expect(mockReplayRepo.recordEvent).toHaveBeenCalledTimes(2);
      expect(mockReplayRepo.finalizeReplay).toHaveBeenCalledWith(testReplayId);
    });

    it('should handle finalization errors gracefully', async () => {
      vi.mocked(mockReplayRepo.finalizeReplay).mockRejectedValue(new Error('Finalization failed'));

      const result = await replayWriter.finalizeReplay(testReplayId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to finalize replay');
    });

    it('should clean up resources after finalization', async () => {
      const finalizedMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.finalizeReplay).mockResolvedValue(finalizedMetadata);

      await replayWriter.finalizeReplay(testReplayId);

      // Try to append event after finalization - should fail
      const event: ReplayEventInput = {
        type: 'test_event',
        data: { test: 'after_finalize' },
      };

      const result = await replayWriter.appendEvent(testReplayId, event);
      
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('REPLAY_NOT_FOUND');
    });
  });

  describe('service shutdown', () => {
    it('should finalize all active replays on shutdown', async () => {
      const mockReplayMetadata1 = createMockReplayMetadata('replay-1', 'instance-1', 'recording');
      const mockReplayMetadata2 = createMockReplayMetadata('replay-2', 'instance-2', 'recording');

      const finalizedMetadata = createMockReplayMetadata('replay-1', 'instance-1', 'completed');

      vi.mocked(mockReplayRepo.createReplay)
        .mockResolvedValueOnce(mockReplayMetadata1)
        .mockResolvedValueOnce(mockReplayMetadata2);
      vi.mocked(mockReplayRepo.recordEvent).mockResolvedValue({} as any);
      vi.mocked(mockReplayRepo.finalizeReplay).mockResolvedValue(finalizedMetadata);

      // Initialize multiple replays
      await replayWriter.initializeReplay('instance-1');
      await replayWriter.initializeReplay('instance-2');

      await replayWriter.shutdown();

      // Should have finalized both replays
      expect(mockReplayRepo.finalizeReplay).toHaveBeenCalledTimes(2);
      expect(mockReplayRepo.finalizeReplay).toHaveBeenCalledWith('replay-1');
      expect(mockReplayRepo.finalizeReplay).toHaveBeenCalledWith('replay-2');
    });

    it('should handle shutdown gracefully with no active replays', async () => {
      await expect(replayWriter.shutdown()).resolves.not.toThrow();
    });
  });

  describe('event data integrity', () => {
    beforeEach(async () => {
      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      vi.mocked(mockReplayRepo.recordEvent).mockResolvedValue({} as any);

      await replayWriter.initializeReplay(testInstanceId);
    });

    it('should preserve event data exactly as provided', async () => {
      const complexEventData = {
        coordinates: { x: 10.5, y: 20.3, z: -5.7 },
        inventory: [
          { item: 'sword', durability: 0.8 },
          { item: 'potion', quantity: 3 }
        ],
        metadata: {
          serverTick: 12345,
          timestamp: '2023-01-01T10:00:00.000Z',
          flags: { pvp: true, combat: false }
        }
      };

      const event: ReplayEventInput = {
        type: 'complex_event',
        playerId: 'player-123',
        data: complexEventData,
        metadata: { tick: 100, roomId: 'room-456' },
      };

      await replayWriter.appendEvent(testReplayId, event);

      // Force flush to repository
      await replayWriter.finalizeReplay(testReplayId);

      // Verify the event was recorded with correct data
      const recordEventCall = vi.mocked(mockReplayRepo.recordEvent).mock.calls[0];
      const recordedEvent = recordEventCall[0].event;

      expect(recordedEvent.type).toBe('complex_event');
      expect(recordedEvent.playerId).toBe('player-123');
      expect(recordedEvent.data).toEqual(complexEventData);
      expect(recordedEvent.metadata).toEqual({ tick: 100, roomId: 'room-456' });
      expect(recordedEvent.seq).toBe(0); // First event should have sequence 0
      expect(recordedEvent.timestamp).toBeTypeOf('number');
    });

    it('should handle unicode and special characters in event data', async () => {
      const unicodeData = {
        playerName: '🎮Player名前✨',
        chatMessage: 'Hello 世界! Special chars: @#$%^&*()',
        emoji: '😀😃😄😁😆',
      };

      const event: ReplayEventInput = {
        type: 'unicode_test',
        data: unicodeData,
      };

      const result = await replayWriter.appendEvent(testReplayId, event);

      expect(result.success).toBe(true);
    });

    it('should maintain sequence numbers correctly across flushes', async () => {
      // Create writer that flushes after each event
      const testReplayWriter = new ReplayWriter(mockReplayRepo, { batchSize: 1 });

      const mockReplayMetadata = createMockReplayMetadata();

      vi.mocked(mockReplayRepo.createReplay).mockResolvedValue(mockReplayMetadata);
      const recordEventMock = vi.mocked(mockReplayRepo.recordEvent);
      recordEventMock.mockResolvedValue({} as any);

      await testReplayWriter.initializeReplay(testInstanceId);

      // Add multiple events
      for (let i = 0; i < 5; i++) {
        const event: ReplayEventInput = {
          type: 'sequence_test',
          data: { counter: i },
        };
        await testReplayWriter.appendEvent(testReplayId, event);
      }

      // Verify sequence numbers are correct
      expect(recordEventMock).toHaveBeenCalledTimes(5);
      
      for (let i = 0; i < 5; i++) {
        const call = recordEventMock.mock.calls[i];
        const recordedEvent = call[0].event;
        expect(recordedEvent.seq).toBe(i);
        expect(recordedEvent.data.counter).toBe(i);
      }

      await testReplayWriter.shutdown();
    });
  });
});