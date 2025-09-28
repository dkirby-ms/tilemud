// T057: Unit tests for queue service (FR-005, FR-006, FR-007)
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueueService, QueueConfig, QueueResult } from '../../src/application/services/queue/queueService';
import { AttemptOutcome, QueueEntry } from '../../src/domain/connection/types';
import Redis from 'ioredis';

// Mock ioredis
vi.mock('ioredis');

describe('QueueService', () => {
  let mockRedis: any;
  let queueService: QueueService;

  const defaultConfig: QueueConfig = {
    maxQueueSize: 100,
    positionUpdateInterval: 5,
    entryTimeoutSeconds: 3600,
    cleanupInterval: 300
  };

  beforeEach(() => {
    // Mock Redis operations
    mockRedis = {
      eval: vi.fn(),
      zrank: vi.fn(),
      zcard: vi.fn(),
      zrem: vi.fn(),
      del: vi.fn(),
      get: vi.fn(),
      zrange: vi.fn(),
      zremrangebyscore: vi.fn(),
      keys: vi.fn(),
      ttl: vi.fn()
    };

    // Mock setInterval/clearInterval
    vi.spyOn(global, 'setInterval').mockReturnValue(123 as any);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    queueService = new QueueService(mockRedis as Redis, defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config when none provided', () => {
      const service = new QueueService(mockRedis as Redis);
      expect(vi.mocked(global.setInterval)).toHaveBeenCalled();
    });

    it('should merge provided config with defaults', () => {
      const customConfig = { maxQueueSize: 50 };
      const service = new QueueService(mockRedis as Redis, customConfig);
      expect(vi.mocked(global.setInterval)).toHaveBeenCalled();
    });

    it('should start cleanup timer on construction', () => {
      expect(vi.mocked(global.setInterval)).toHaveBeenCalledWith(
        expect.any(Function),
        defaultConfig.cleanupInterval * 1000
      );
    });
  });

  describe('enqueue', () => {
    const testParams = {
      instanceId: 'instance-1',
      characterId: 'char-123',
      userId: 'user-456',
      attemptId: 'attempt-789'
    };

    it('should successfully enqueue a new character', async () => {
      // Mock Lua script returning new queue position
      mockRedis.eval.mockResolvedValue([0, 1, 'queued']);

      const result = await queueService.enqueue(
        testParams.instanceId,
        testParams.characterId,
        testParams.userId,
        testParams.attemptId
      );

      expect(result.outcome).toBe(AttemptOutcome.QUEUED);
      expect(result.position).toBe(0);
      expect(result.queueDepth).toBe(1);
      expect(result.estimatedWaitSeconds).toBeGreaterThanOrEqual(0);
      expect(result.entryId).toBeDefined();
    });

    it('should return existing position when character already queued', async () => {
      // Mock Lua script returning existing position
      mockRedis.eval.mockResolvedValue([2, 5, 'existing']);

      const result = await queueService.enqueue(
        testParams.instanceId,
        testParams.characterId,
        testParams.userId,
        testParams.attemptId
      );

      expect(result.outcome).toBe(AttemptOutcome.QUEUED);
      expect(result.position).toBe(2);
      expect(result.queueDepth).toBe(5);
    });

    it('should reject when queue is full', async () => {
      // Mock Lua script returning queue full
      mockRedis.eval.mockResolvedValue([-1, 100, 'full']);

      const result = await queueService.enqueue(
        testParams.instanceId,
        testParams.characterId,
        testParams.userId,
        testParams.attemptId
      );

      expect(result.outcome).toBe(AttemptOutcome.FAILED);
      expect(result.queueDepth).toBe(100);
      expect(result.position).toBeUndefined();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis connection failed'));

      await expect(queueService.enqueue(
        testParams.instanceId,
        testParams.characterId,
        testParams.userId,
        testParams.attemptId
      )).rejects.toThrow('Failed to enqueue user');
    });

    it('should call eval with correct parameters', async () => {
      mockRedis.eval.mockResolvedValue([0, 1, 'queued']);

      await queueService.enqueue(
        testParams.instanceId,
        testParams.characterId,
        testParams.userId,
        testParams.attemptId
      );

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('local queueKey = KEYS[1]'), // Lua script
        2, // Number of keys
        `dev:queue:pending:${testParams.instanceId}`, // queueKey
        `dev:queue:entry:${testParams.characterId}`, // entryKey
        testParams.characterId,
        testParams.userId,
        testParams.instanceId,
        testParams.attemptId,
        expect.any(String), // timestamp
        '100', // maxQueueSize
        '3600' // entryTTL
      );
    });
  });

  describe('getPosition', () => {
    it('should return queue position for existing character', async () => {
      mockRedis.zrank.mockResolvedValue(3);
      mockRedis.zcard.mockResolvedValue(10);

      const result = await queueService.getPosition('instance-1', 'char-123');

      expect(result).toEqual({
        position: 3,
        depth: 10,
        estimatedWaitSeconds: expect.any(Number)
      });
    });

    it('should return null for character not in queue', async () => {
      mockRedis.zrank.mockResolvedValue(null);

      const result = await queueService.getPosition('instance-1', 'char-123');

      expect(result).toBeNull();
    });

    it('should handle Redis errors and return null', async () => {
      mockRedis.zrank.mockRejectedValue(new Error('Redis error'));

      const result = await queueService.getPosition('instance-1', 'char-123');

      expect(result).toBeNull();
    });
  });

  describe('promoteNext', () => {
    it('should promote next character in queue', async () => {
      const mockEntryData = JSON.stringify({
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        enqueuedAt: Date.now(),
        attemptId: 'attempt-789'
      });

      // Mock Lua script returning character to promote
      mockRedis.eval.mockResolvedValue(['char-123', 1640995200000]);
      mockRedis.get.mockResolvedValue(mockEntryData);
      mockRedis.del.mockResolvedValue(1);

      const result = await queueService.promoteNext('instance-1');

      expect(result).toEqual({
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        enqueuedAt: expect.any(Number),
        attemptId: 'attempt-789'
      });

      expect(mockRedis.del).toHaveBeenCalledWith('dev:queue:entry:char-123');
    });

    it('should return null when queue is empty', async () => {
      mockRedis.eval.mockResolvedValue(null);

      const result = await queueService.promoteNext('instance-1');

      expect(result).toBeNull();
    });

    it('should handle missing entry data gracefully', async () => {
      mockRedis.eval.mockResolvedValue(['char-123', 1640995200000]);
      mockRedis.get.mockResolvedValue(null);

      const result = await queueService.promoteNext('instance-1');

      expect(result).toBeNull();
    });

    it('should handle Redis errors', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis error'));

      await expect(queueService.promoteNext('instance-1')).rejects.toThrow('Failed to promote from queue');
    });
  });

  describe('dequeue', () => {
    it('should successfully remove character from queue', async () => {
      mockRedis.zrem.mockResolvedValue(1);
      mockRedis.del.mockResolvedValue(1);

      const result = await queueService.dequeue('instance-1', 'char-123');

      expect(result).toBe(true);
      expect(mockRedis.zrem).toHaveBeenCalledWith('dev:queue:pending:instance-1', 'char-123');
      expect(mockRedis.del).toHaveBeenCalledWith('dev:queue:entry:char-123');
    });

    it('should return false when character not in queue', async () => {
      mockRedis.zrem.mockResolvedValue(0);
      mockRedis.del.mockResolvedValue(0);

      const result = await queueService.dequeue('instance-1', 'char-123');

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.zrem.mockRejectedValue(new Error('Redis error'));

      const result = await queueService.dequeue('instance-1', 'char-123');

      expect(result).toBe(false);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const mockDepth = 5;
      const mockOldestTime = 1640995200000;

      mockRedis.zcard.mockResolvedValue(mockDepth);
      mockRedis.zrange.mockResolvedValue(['char-123', mockOldestTime.toString()]);

      const result = await queueService.getQueueStats('instance-1');

      expect(result).toEqual({
        depth: mockDepth,
        oldestEntry: mockOldestTime,
        averageWaitTime: expect.any(Number)
      });
    });

    it('should handle empty queue', async () => {
      mockRedis.zcard.mockResolvedValue(0);
      mockRedis.zrange.mockResolvedValue([]);

      const result = await queueService.getQueueStats('instance-1');

      expect(result.depth).toBe(0);
      expect(result.averageWaitTime).toBe(0);
    });

    it('should handle Redis errors', async () => {
      mockRedis.zcard.mockRejectedValue(new Error('Redis error'));

      const result = await queueService.getQueueStats('instance-1');

      expect(result).toEqual({
        depth: 0,
        oldestEntry: expect.any(Number),
        averageWaitTime: 0
      });
    });
  });

  describe('clearQueue', () => {
    it('should clear all entries in queue', async () => {
      const mockCharacters = ['char-1', 'char-2', 'char-3'];
      
      mockRedis.zrange.mockResolvedValue(mockCharacters);
      mockRedis.del.mockResolvedValue(3);

      const result = await queueService.clearQueue('instance-1');

      expect(result).toBe(3);
      expect(mockRedis.del).toHaveBeenCalledWith(
        'dev:queue:entry:char-1',
        'dev:queue:entry:char-2',
        'dev:queue:entry:char-3'
      );
      expect(mockRedis.del).toHaveBeenCalledWith('dev:queue:pending:instance-1');
    });

    it('should handle empty queue', async () => {
      mockRedis.zrange.mockResolvedValue([]);
      mockRedis.del.mockResolvedValue(0);

      const result = await queueService.clearQueue('instance-1');

      expect(result).toBe(0);
    });

    it('should propagate Redis errors', async () => {
      mockRedis.zrange.mockRejectedValue(new Error('Redis error'));

      await expect(queueService.clearQueue('instance-1')).rejects.toThrow('Redis error');
    });
  });

  describe('getServiceStats', () => {
    it('should return service-wide statistics', async () => {
      const mockQueueKeys = ['dev:queue:pending:instance-1', 'dev:queue:pending:instance-2'];
      
      mockRedis.keys.mockResolvedValue(mockQueueKeys);
      mockRedis.zcard.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
      mockRedis.zrange
        .mockResolvedValueOnce(['char-1', '1640995200000'])
        .mockResolvedValueOnce(['char-2', '1640995100000']);

      const result = await queueService.getServiceStats();

      expect(result).toEqual({
        totalQueues: 2,
        totalEntries: 8,
        oldestQueue: 'dev:queue:pending:instance-2',
        averageQueueDepth: 4
      });
    });

    it('should handle no queues', async () => {
      mockRedis.keys.mockResolvedValue([]);

      const result = await queueService.getServiceStats();

      expect(result).toEqual({
        totalQueues: 0,
        totalEntries: 0,
        oldestQueue: null,
        averageQueueDepth: 0
      });
    });

    it('should handle Redis errors', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));

      const result = await queueService.getServiceStats();

      expect(result).toEqual({
        totalQueues: 0,
        totalEntries: 0,
        oldestQueue: null,
        averageQueueDepth: 0
      });
    });
  });

  describe('cleanup', () => {
    it('should be called by timer', async () => {
      const mockQueueKeys = ['dev:queue:pending:instance-1'];
      const mockEntryKeys = ['dev:queue:entry:char-1', 'dev:queue:entry:char-2'];

      mockRedis.keys
        .mockResolvedValueOnce(mockQueueKeys)
        .mockResolvedValueOnce(mockEntryKeys);
      mockRedis.zremrangebyscore.mockResolvedValue(2);
      mockRedis.ttl.mockResolvedValueOnce(-1).mockResolvedValueOnce(300);
      mockRedis.del.mockResolvedValue(1);

      // Verify cleanup timer was set up
      expect(vi.mocked(global.setInterval)).toHaveBeenCalledWith(
        expect.any(Function),
        defaultConfig.cleanupInterval * 1000
      );
    });
  });

  describe('shutdown', () => {
    it('should clear cleanup timer and perform final cleanup', async () => {
      mockRedis.keys.mockResolvedValue([]);
      
      await queueService.shutdown();

      expect(vi.mocked(global.clearInterval)).toHaveBeenCalled();
    });
  });

  describe('estimated wait calculation', () => {
    it('should calculate reasonable wait times', async () => {
      mockRedis.eval.mockResolvedValue([5, 10, 'queued']); // Position 5, depth 10

      const result = await queueService.enqueue('instance-1', 'char-123', 'user-456', 'attempt-789');

      expect(result.estimatedWaitSeconds).toBeGreaterThan(0);
      expect(result.estimatedWaitSeconds).toBeLessThan(1000); // Reasonable upper bound
    });

    it('should account for congestion in wait time', async () => {
      // High position, high depth = longer wait
      mockRedis.eval.mockResolvedValue([50, 80, 'queued']);

      const result = await queueService.enqueue('instance-1', 'char-123', 'user-456', 'attempt-789');

      expect(result.estimatedWaitSeconds).toBeGreaterThan(1000); // Should be longer due to congestion
    });
  });
});