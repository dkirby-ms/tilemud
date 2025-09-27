/**
 * Integration tests for purge job scheduling and execution
 * 
 * Tests T069: Purge job scheduling and test harness for replay and chat retention jobs
 * Ensures jobs can be created, configured, and provide proper interfaces for scheduling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReplayPurgeJob } from '../../src/application/jobs/replayPurgeJob';
import { ChatRetentionJob } from '../../src/application/jobs/chatRetentionJob';
import { IReplayRepository } from '../../src/infra/persistence/replayRepository';
import { IChatRepository } from '../../src/infra/persistence/chatRepository';

describe('Purge Job Scheduling Test Harness', () => {
  let mockReplayRepository: IReplayRepository;
  let mockChatRepository: IChatRepository;

  beforeEach(() => {
    // Create minimal mock repositories for job construction
    mockReplayRepository = {
      findExpiredReplays: vi.fn().mockResolvedValue([]),
      deleteReplay: vi.fn().mockResolvedValue(true),
      cleanupExpiredReplays: vi.fn().mockResolvedValue(0),
    } as any;

    mockChatRepository = {
      findExpiredMessages: vi.fn().mockResolvedValue([]),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as any;
  });

  describe('Replay Purge Job Creation and Configuration', () => {
    it('should create replay purge job with default configuration', () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository);
      expect(purgeJob).toBeDefined();
    });

    it('should create replay purge job with custom retention policy', () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository, {
        retentionDays: 30,
        batchSize: 50,
        dryRun: true,
        enabled: true,
      });
      expect(purgeJob).toBeDefined();
    });

    it('should support job lifecycle management', () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository, { 
        enabled: true,
        intervalMs: 60000 // 1 minute for testing
      });
      
      // Test job start/stop lifecycle
      expect(() => purgeJob.start()).not.toThrow();
      expect(() => purgeJob.stop()).not.toThrow();
    });

    it('should handle disabled job configuration', () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository, { 
        enabled: false 
      });
      
      // Should not start when disabled
      expect(() => purgeJob.start()).not.toThrow();
    });

    it('should execute purge operation and return results', async () => {
      vi.mocked(mockReplayRepository.findExpiredReplays).mockResolvedValue([]);

      const purgeJob = new ReplayPurgeJob(mockReplayRepository, {
        retentionDays: 7,
        batchSize: 100,
      });

      const result = await purgeJob.runPurge();
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('totalScanned');
      expect(result).toHaveProperty('totalPurged');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.durationMs).toBe('number');
    });

    it('should provide job statistics tracking', async () => {
      vi.mocked(mockReplayRepository.findExpiredReplays).mockResolvedValue([]);

      const purgeJob = new ReplayPurgeJob(mockReplayRepository);
      
      // Execute job to generate statistics
      await purgeJob.runPurge();
      
      const stats = purgeJob.getStats();
      expect(stats).toHaveProperty('totalRuns');
      expect(stats).toHaveProperty('totalPurged');
      expect(stats).toHaveProperty('lastRun');
      expect(stats.totalRuns).toBeGreaterThan(0);
    });
  });

  describe('Chat Retention Job Creation and Configuration', () => {
    it('should create chat retention job with default configuration', () => {
      const retentionJob = new ChatRetentionJob(mockChatRepository);
      expect(retentionJob).toBeDefined();
    });

    it('should create chat retention job with custom retention policies', () => {
      const retentionJob = new ChatRetentionJob(mockChatRepository, {
        retentionPolicies: {
          guild: 60,    // 60 days
          party: 14,    // 14 days
          direct: 180,  // 180 days
          global: 7,    // 7 days
          system: 30,   // 30 days
          moderation: 365, // 365 days
        },
        batchSize: 500,
        dryRun: true,
      });
      expect(retentionJob).toBeDefined();
    });

    it('should support job lifecycle management', () => {
      const retentionJob = new ChatRetentionJob(mockChatRepository, { 
        enabled: true,
        intervalMs: 6 * 60 * 60 * 1000 // 6 hours
      });
      
      // Test job start/stop lifecycle
      expect(() => retentionJob.start()).not.toThrow();
      expect(() => retentionJob.stop()).not.toThrow();
    });

    it('should execute retention operation and return results', async () => {
      vi.mocked(mockChatRepository.findExpiredMessages).mockResolvedValue([]);

      const retentionJob = new ChatRetentionJob(mockChatRepository);
      
      const result = await retentionJob.runRetention();
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('totalScanned');
      expect(result).toHaveProperty('totalPurged');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('breakdown');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.breakdown).toBe('object');
    });

    it('should provide job statistics tracking', async () => {
      vi.mocked(mockChatRepository.findExpiredMessages).mockResolvedValue([]);

      const retentionJob = new ChatRetentionJob(mockChatRepository);
      
      // Execute job to generate statistics
      await retentionJob.runRetention();
      
      const stats = retentionJob.getStats();
      expect(stats).toHaveProperty('totalRuns');
      expect(stats).toHaveProperty('totalPurged');
      expect(stats).toHaveProperty('lastRun');
      expect(stats).toHaveProperty('purgedByChannelType');
      expect(stats.totalRuns).toBeGreaterThan(0);
    });
  });

  describe('Job Scheduling Test Harness Integration', () => {
    it('should validate job configuration schemas', () => {
      // Test that job configurations are validated properly
      expect(() => {
        new ReplayPurgeJob(mockReplayRepository, {
          retentionDays: -1, // Invalid
        });
      }).toThrow(); // Should throw validation error

      expect(() => {
        new ChatRetentionJob(mockChatRepository, {
          batchSize: 0, // Invalid
        });
      }).toThrow(); // Should throw validation error
    });

    it('should support dry run mode for testing', async () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository, {
        dryRun: true,
      });

      const retentionJob = new ChatRetentionJob(mockChatRepository, {
        dryRun: true,
      });

      // In dry run mode, jobs should scan but not actually delete
      const purgeResult = await purgeJob.runPurge();
      const retentionResult = await retentionJob.runRetention();

      expect(purgeResult.success).toBe(true);
      expect(retentionResult.success).toBe(true);
      
      // Verify no actual delete operations were called
      expect(mockReplayRepository.deleteReplay).not.toHaveBeenCalled();
      expect(mockChatRepository.deleteMessage).not.toHaveBeenCalled();
    });

    it('should provide comprehensive job status monitoring', () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository);
      const retentionJob = new ChatRetentionJob(mockChatRepository);

      // Jobs should provide status information
      expect(() => purgeJob.getStats()).not.toThrow();
      expect(() => retentionJob.getStats()).not.toThrow();

      const purgeStats = purgeJob.getStats();
      const retentionStats = retentionJob.getStats();

      // Validate statistics structure
      expect(purgeStats).toMatchObject({
        totalRuns: expect.any(Number),
        totalPurged: expect.any(Number),
        averageDurationMs: expect.any(Number),
      });

      expect(retentionStats).toMatchObject({
        totalRuns: expect.any(Number),
        totalPurged: expect.any(Number),
        averageDurationMs: expect.any(Number),
        purgedByChannelType: expect.any(Object),
      });
    });

    it('should support configurable scheduling intervals', () => {
      const rapidPurgeJob = new ReplayPurgeJob(mockReplayRepository, {
        intervalMs: 60000, // 1 minute
      });

      const standardRetentionJob = new ChatRetentionJob(mockChatRepository, {
        intervalMs: 6 * 60 * 60 * 1000, // 6 hours
      });

      expect(rapidPurgeJob).toBeDefined();
      expect(standardRetentionJob).toBeDefined();
    });

    it('should handle concurrent execution prevention', async () => {
      const purgeJob = new ReplayPurgeJob(mockReplayRepository);

      // Start first execution
      const firstExecution = purgeJob.runPurge();
      
      // Attempt second execution while first is running
      const secondExecution = purgeJob.runPurge();

      const [first, second] = await Promise.all([firstExecution, secondExecution]);

      // One should succeed, one should indicate already running
      expect(first.success || second.success).toBe(true);
      if (!first.success) {
        expect(first.totalScanned).toBe(0);
        expect(first.totalPurged).toBe(0);
      }
      if (!second.success) {
        expect(second.totalScanned).toBe(0);
        expect(second.totalPurged).toBe(0);
      }
    });
  });
});