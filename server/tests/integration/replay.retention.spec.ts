import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ReplayService, ReplayAccessResult } from '../../src/application/services/replayService';
import { ReplayPurgeJob } from '../../src/application/jobs/replayPurgeJob';
import { IReplayRepository } from '../../src/infra/persistence/replayRepository';
import { createServiceLogger } from '../../src/infra/monitoring/logger';
import { 
  ReplayMetadata, 
  ReplayEvent, 
  ReplayStatus,
  REPLAY_RETENTION_DAYS,
  isReplayAvailable,
  isReplayExpired,
  CreateReplayInput,
} from '../../src/domain/entities/replay';
import { randomUUID } from 'crypto';

const logger = createServiceLogger('ReplayRetentionIntegrationTest');

// Mock repository implementation for testing
class MockReplayRepository implements IReplayRepository {
  private replays = new Map<string, ReplayMetadata>();
  private events = new Map<string, ReplayEvent[]>();

  async findReplayById(id: string): Promise<ReplayMetadata | null> {
    return this.replays.get(id) || null;
  }

  async createReplay(input: CreateReplayInput): Promise<ReplayMetadata> {
    const replayId = randomUUID();
    const metadata: ReplayMetadata = {
      id: replayId,
      instanceId: input.instanceId,
      status: ReplayStatus.RECORDING,
      createdAt: new Date(),
      sizeBytes: 0,
      expiresAt: new Date(Date.now() + (REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
      storageRef: input.storageRef,
    };
    this.replays.set(replayId, metadata);
    return metadata;
  }

  async updateReplayDuration(id: string, durationMs: number): Promise<ReplayMetadata | null> {
    const replay = this.replays.get(id);
    if (!replay) return null;
    // Mock implementation - would update duration
    return replay;
  }

  async finalizeReplay(id: string): Promise<ReplayMetadata | null> {
    const replay = this.replays.get(id);
    if (!replay) return null;
    
    const finalized: ReplayMetadata = {
      ...replay,
      status: ReplayStatus.COMPLETED,
      completedAt: new Date(),
    };
    this.replays.set(id, finalized);
    return finalized;
  }

  async deleteReplay(id: string): Promise<boolean> {
    const deleted = this.replays.delete(id);
    this.events.delete(id);
    return deleted;
  }

  async findReplaysByInstance(instanceId: string): Promise<ReplayMetadata[]> {
    return Array.from(this.replays.values()).filter(r => r.instanceId === instanceId);
  }

  async findReplaysByPlayer(playerId: string): Promise<ReplayMetadata[]> {
    // Mock implementation - would filter by player participation
    return Array.from(this.replays.values());
  }

  async findExpiredReplays(): Promise<ReplayMetadata[]> {
    const now = new Date();
    return Array.from(this.replays.values()).filter(r => r.expiresAt < now);
  }

  async recordEvent(input: { replayId: string; event: ReplayEvent }): Promise<ReplayEvent> {
    const events = this.events.get(input.replayId) || [];
    events.push(input.event);
    this.events.set(input.replayId, events);
    return input.event;
  }

  async getEventsByReplay(replayId: string): Promise<ReplayEvent[]> {
    return this.events.get(replayId) || [];
  }

  async *getEventsStream(replayId: string): AsyncIterable<ReplayEvent> {
    const events = this.events.get(replayId) || [];
    for (const event of events) {
      yield event;
    }
  }

  async cleanupExpiredReplays(): Promise<number> {
    const expired = await this.findExpiredReplays();
    let cleaned = 0;
    for (const replay of expired) {
      if (await this.deleteReplay(replay.id)) {
        cleaned++;
      }
    }
    return cleaned;
  }

  async getReplayStats(replayId: string): Promise<{
    eventCount: number;
    fileSizeBytes: number;
    compressionRatio: number;
  }> {
    const events = this.events.get(replayId) || [];
    const replay = this.replays.get(replayId);
    return {
      eventCount: events.length,
      fileSizeBytes: replay?.sizeBytes || 0,
      compressionRatio: 0.8, // Mock compression
    };
  }

  async validateReplayIntegrity(replayId: string): Promise<boolean> {
    return this.replays.has(replayId) && this.events.has(replayId);
  }

  // Test helper methods
  async saveReplay(metadata: ReplayMetadata): Promise<void> {
    this.replays.set(metadata.id, metadata);
  }

  async saveReplayEvents(replayId: string, events: ReplayEvent[]): Promise<void> {
    this.events.set(replayId, events);
  }

  async getReplayCount(): Promise<number> {
    return this.replays.size;
  }

  async clear(): Promise<void> {
    this.replays.clear();
    this.events.clear();
  }
}

describe('Replay Retention Integration', () => {
  let replayService: ReplayService;
  let replayPurgeJob: ReplayPurgeJob;
  let mockReplayRepo: MockReplayRepository;
  const testStartTime = Date.now();
  
  beforeAll(async () => {
    // Initialize mock repository and services
    mockReplayRepo = new MockReplayRepository();
    replayService = new ReplayService(mockReplayRepo as IReplayRepository);
    replayPurgeJob = new ReplayPurgeJob(mockReplayRepo as IReplayRepository, {
      intervalMs: 60000, // Minimum valid value (1 minute)
      batchSize: 50,
      retentionDays: REPLAY_RETENTION_DAYS,
      dryRun: false,
      enabled: true,
    });
    
    logger.info('Replay retention services initialized for integration testing');
  });

  afterAll(async () => {
    if (replayPurgeJob) {
      replayPurgeJob.stop();
    }
    logger.info('Replay retention test cleanup complete');
  });

  beforeEach(() => {
    // Reset any test state if needed
  });

  afterEach(async () => {
    // Clean up test data after each test
    await mockReplayRepo.clear();
  });

  describe('FR-017: Replay Availability & Purge After Expire', () => {
    it('should provide access to replays within 7-day retention window', async () => {
      const testStart = Date.now();
      const instanceId = randomUUID();
      const replayId = randomUUID();
      
      // Create a recently completed replay (within retention window)
      const completedAt = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)); // 2 days ago
      const expiresAt = new Date(completedAt.getTime() + (REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
      
      const replayMetadata: ReplayMetadata = {
        id: replayId,
        instanceId,
        status: ReplayStatus.COMPLETED,
        createdAt: new Date(completedAt.getTime() - (60 * 60 * 1000)), // 1 hour before completion
        completedAt,
        sizeBytes: 50000,
        expiresAt,
        storageRef: `replays/${instanceId}/${replayId}.jsonl`,
        eventCount: 250,
        checksum: 'sha256:abc123def456',
      };

      // Mock events for the replay
      const replayEvents: ReplayEvent[] = [
        {
          seq: 1,
          timestamp: completedAt.getTime() - 3600000,
          type: 'instance_started',
          data: { instanceId, playerCount: 4 },
        },
        {
          seq: 2,
          timestamp: completedAt.getTime() - 3500000,
          type: 'player_joined',
          playerId: randomUUID(),
          data: { position: { x: 0, y: 0 } },
        },
        {
          seq: 3,
          timestamp: completedAt.getTime() - 1000,
          type: 'instance_completed',
          data: { winner: randomUUID(), duration: 3599000 },
        },
      ];

      logger.info({
        event: 'test_start',
        testCase: 'replay_within_retention',
        metadata: {
          replayId,
          instanceId,
          completedAt,
          expiresAt,
          daysUntilExpiry: Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
          testStart,
        },
      }, 'Starting replay retention window access test');

      // Store replay in repository
      await mockReplayRepo.saveReplay(replayMetadata);
      await mockReplayRepo.saveReplayEvents(replayId, replayEvents);

      // Test replay access
      const accessResult: ReplayAccessResult = await replayService.getReplayMetadata({ 
        replayId,
        requesterId: randomUUID() 
      });

      expect(accessResult.success).toBe(true);
      expect(accessResult.replay).toBeDefined();
      expect(accessResult.replay!.id).toBe(replayId);
      expect(accessResult.replay!.status).toBe(ReplayStatus.COMPLETED);
      expect(accessResult.replay!.instanceId).toBe(instanceId);
      expect(accessResult.errorCode).toBeUndefined();

      // Verify replay is considered available
      expect(isReplayAvailable(accessResult.replay!)).toBe(true);
      expect(isReplayExpired(accessResult.replay!.expiresAt)).toBe(false);

      // Test event retrieval
      const eventStream = await replayService.getReplayEvents({ 
        replayId,
        requesterId: randomUUID() 
      });
      
      expect(eventStream.success).toBe(true);
      expect(eventStream.events).toBeDefined();
      expect(eventStream.events!.length).toBe(3);
      expect(eventStream.events![0].type).toBe('instance_started');
      expect(eventStream.events![2].type).toBe('instance_completed');

      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'replay_within_retention',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          replayAccessible: accessResult.success,
          eventCount: eventStream.events?.length,
          retentionDaysRemaining: Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        },
      }, 'Replay retention window access test completed successfully');
    });

    it('should deny access to expired replays beyond 7-day window', async () => {
      const testStart = Date.now();
      const instanceId = randomUUID();
      const replayId = randomUUID();
      
      // Create an expired replay (beyond 7-day retention)
      const completedAt = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)); // 10 days ago
      const expiresAt = new Date(completedAt.getTime() + (REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000)); // Expired 3 days ago
      
      const expiredReplay: ReplayMetadata = {
        id: replayId,
        instanceId,
        status: ReplayStatus.COMPLETED,
        createdAt: new Date(completedAt.getTime() - (60 * 60 * 1000)),
        completedAt,
        sizeBytes: 75000,
        expiresAt,
        storageRef: `replays/${instanceId}/${replayId}.jsonl`,
        eventCount: 320,
        checksum: 'sha256:expired123',
      };

      logger.info({
        event: 'test_start',
        testCase: 'expired_replay_access',
        metadata: {
          replayId,
          instanceId,
          completedAt,
          expiresAt,
          daysExpired: Math.ceil((Date.now() - expiresAt.getTime()) / (24 * 60 * 60 * 1000)),
          testStart,
        },
      }, 'Starting expired replay access denial test');

      // Store expired replay
      await mockReplayRepo.saveReplay(expiredReplay);

      // Test replay access should be denied
      const accessResult: ReplayAccessResult = await replayService.getReplayMetadata({ 
        replayId,
        requesterId: randomUUID() 
      });

      expect(accessResult.success).toBe(false);
      expect(accessResult.replay).toBeUndefined();
      expect(accessResult.error).toContain('expired');
      expect(accessResult.errorCode).toBe('EXPIRED');

      // Verify replay is considered expired
      expect(isReplayExpired(expiredReplay.expiresAt)).toBe(true);
      expect(isReplayAvailable(expiredReplay)).toBe(false); // Status is completed, but expired

      // Test event stream access should also fail
      const eventStream = await replayService.getReplayEvents({ 
        replayId,
        requesterId: randomUUID() 
      });
      
      expect(eventStream.success).toBe(false);
      expect(eventStream.events).toBeUndefined();
      expect(eventStream.errorCode).toBe('EXPIRED');

      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'expired_replay_access',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          accessDenied: !accessResult.success,
          errorCode: accessResult.errorCode,
          daysExpired: Math.ceil((Date.now() - expiresAt.getTime()) / (24 * 60 * 60 * 1000)),
        },
      }, 'Expired replay access denial test completed successfully');
    });

    it('should purge expired replays through scheduled job', async () => {
      const testStart = Date.now();
      const instanceIds = [randomUUID(), randomUUID(), randomUUID()];
      const replayIds = [randomUUID(), randomUUID(), randomUUID()];
      
      logger.info({
        event: 'test_start',
        testCase: 'replay_purge_job',
        metadata: {
          instanceIds,
          replayIds,
          testStart,
        },
      }, 'Starting replay purge job integration test');

      // Create mix of active and expired replays
      const activeReplay: ReplayMetadata = {
        id: replayIds[0],
        instanceId: instanceIds[0],
        status: ReplayStatus.COMPLETED,
        createdAt: new Date(Date.now() - (1 * 24 * 60 * 60 * 1000)),
        completedAt: new Date(Date.now() - (1 * 24 * 60 * 60 * 1000)),
        sizeBytes: 40000,
        expiresAt: new Date(Date.now() + (6 * 24 * 60 * 60 * 1000)), // Expires in 6 days
        storageRef: `replays/${instanceIds[0]}/${replayIds[0]}.jsonl`,
        eventCount: 180,
        checksum: 'sha256:active123',
      };

      const expiredReplay1: ReplayMetadata = {
        id: replayIds[1],
        instanceId: instanceIds[1],
        status: ReplayStatus.COMPLETED,
        createdAt: new Date(Date.now() - (9 * 24 * 60 * 60 * 1000)),
        completedAt: new Date(Date.now() - (9 * 24 * 60 * 60 * 1000)),
        sizeBytes: 85000,
        expiresAt: new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)), // Expired 2 days ago
        storageRef: `replays/${instanceIds[1]}/${replayIds[1]}.jsonl`,
        eventCount: 450,
        checksum: 'sha256:expired1',
      };

      const expiredReplay2: ReplayMetadata = {
        id: replayIds[2],
        instanceId: instanceIds[2],
        status: ReplayStatus.COMPLETED,
        createdAt: new Date(Date.now() - (12 * 24 * 60 * 60 * 1000)),
        completedAt: new Date(Date.now() - (12 * 24 * 60 * 60 * 1000)),
        sizeBytes: 120000,
        expiresAt: new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)), // Expired 5 days ago
        storageRef: `replays/${instanceIds[2]}/${replayIds[2]}.jsonl`,
        eventCount: 680,
        checksum: 'sha256:expired2',
      };

      // Store all replays
      await mockReplayRepo.saveReplay(activeReplay);
      await mockReplayRepo.saveReplay(expiredReplay1);
      await mockReplayRepo.saveReplay(expiredReplay2);

      // Verify initial state - all replays present
      const initialCount = await mockReplayRepo.getReplayCount();
      expect(initialCount).toBe(3);

      // Run purge job manually
      const purgeResult = await replayPurgeJob.runPurge();

      expect(purgeResult.success).toBe(true);
      expect(purgeResult.totalScanned).toBe(2); // Only scans expired replays
      expect(purgeResult.totalPurged).toBe(2); // Two expired replays should be purged
      expect(purgeResult.errors).toBe(0);

      // Verify post-purge state - only active replay remains
      const finalCount = await mockReplayRepo.getReplayCount();
      expect(finalCount).toBe(1);

      // Verify active replay is still accessible
      const activeAccessResult = await replayService.getReplayMetadata({ 
        replayId: replayIds[0]
      });
      expect(activeAccessResult.success).toBe(true);
      expect(activeAccessResult.replay!.id).toBe(replayIds[0]);

      // Verify expired replays are no longer found
      const expired1AccessResult = await replayService.getReplayMetadata({ 
        replayId: replayIds[1]
      });
      expect(expired1AccessResult.success).toBe(false);
      expect(expired1AccessResult.errorCode).toBe('NOT_FOUND');

      const expired2AccessResult = await replayService.getReplayMetadata({ 
        replayId: replayIds[2]
      });
      expect(expired2AccessResult.success).toBe(false);
      expect(expired2AccessResult.errorCode).toBe('NOT_FOUND');

      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'replay_purge_job',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          initialCount,
          finalCount,
          purgedCount: purgeResult.totalPurged,
          activeReplayAccessible: activeAccessResult.success,
          expiredReplaysRemoved: !expired1AccessResult.success && !expired2AccessResult.success,
        },
      }, 'Replay purge job integration test completed successfully');
    });

    it('should support deterministic reconstruction with metadata', async () => {
      const testStart = Date.now();
      const instanceId = randomUUID();
      const replayId = randomUUID();
      const playerId1 = randomUUID();
      const playerId2 = randomUUID();
      
      logger.info({
        event: 'test_start',
        testCase: 'deterministic_reconstruction',
        metadata: {
          replayId,
          instanceId,
          playerId1,
          playerId2,
          testStart,
        },
      }, 'Starting deterministic reconstruction test');

      // Create detailed replay with comprehensive metadata for reconstruction
      const replayMetadata: ReplayMetadata = {
        id: replayId,
        instanceId,
        status: ReplayStatus.COMPLETED,
        createdAt: new Date(Date.now() - (3 * 60 * 60 * 1000)),
        completedAt: new Date(Date.now() - (60 * 60 * 1000)),
        sizeBytes: 125000,
        expiresAt: new Date(Date.now() + (6 * 24 * 60 * 60 * 1000)),
        storageRef: `replays/${instanceId}/${replayId}.jsonl`,
        eventCount: 542,
        checksum: 'sha256:deterministic123',
      };

      // Create comprehensive event sequence for deterministic replay
      const deterministicEvents: ReplayEvent[] = [
        {
          seq: 1,
          timestamp: replayMetadata.createdAt.getTime(),
          type: 'instance_initialized',
          data: { 
            ruleVersion: 'v1.2.3',
            boardDimensions: { width: 10, height: 10 },
            gameMode: 'tactical',
            maxPlayers: 4,
          },
          metadata: { tick: 0 },
        },
        {
          seq: 2,
          timestamp: replayMetadata.createdAt.getTime() + 1000,
          type: 'player_joined',
          playerId: playerId1,
          data: { 
            position: { x: 2, y: 2 },
            characterClass: 'warrior',
            initialHealth: 100,
          },
          metadata: { tick: 1 },
        },
        {
          seq: 3,
          timestamp: replayMetadata.createdAt.getTime() + 2000,
          type: 'player_joined',
          playerId: playerId2,
          data: { 
            position: { x: 7, y: 7 },
            characterClass: 'mage',
            initialHealth: 80,
          },
          metadata: { tick: 2 },
        },
        {
          seq: 4,
          timestamp: replayMetadata.createdAt.getTime() + 5000,
          type: 'tile_placed',
          playerId: playerId1,
          data: { 
            position: { x: 3, y: 2 },
            tileType: 'attack',
            cost: 2,
          },
          metadata: { tick: 5 },
        },
        {
          seq: 5,
          timestamp: replayMetadata.completedAt!.getTime(),
          type: 'instance_resolved',
          data: { 
            winner: playerId1,
            finalScore: { [playerId1]: 150, [playerId2]: 120 },
            duration: 7200000, // 2 hours
            endReason: 'victory_condition_met',
          },
          metadata: { tick: 720 },
        },
      ];

      // Store replay with deterministic events
      await mockReplayRepo.saveReplay(replayMetadata);
      await mockReplayRepo.saveReplayEvents(replayId, deterministicEvents);

      // Test metadata access for reconstruction information
      const metadataResult = await replayService.getReplayMetadata({ replayId });
      
      expect(metadataResult.success).toBe(true);
      expect(metadataResult.replay!.eventCount).toBe(542);
      expect(metadataResult.replay!.checksum).toBe('sha256:deterministic123');
      expect(metadataResult.replay!.sizeBytes).toBe(125000);

      // Test event stream retrieval for reconstruction
      const eventStream = await replayService.getReplayEvents({ replayId });
      
      expect(eventStream.success).toBe(true);
      expect(eventStream.events).toBeDefined();
      expect(eventStream.events!.length).toBe(5);

      // Verify deterministic event sequence
      const events = eventStream.events!;
      expect(events[0].seq).toBe(1);
      expect(events[0].type).toBe('instance_initialized');
      expect(events[0].data.ruleVersion).toBe('v1.2.3');
      expect(events[0].metadata?.tick).toBe(0);

      expect(events[1].seq).toBe(2);
      expect(events[1].type).toBe('player_joined');
      expect(events[1].playerId).toBe(playerId1);
      expect(events[1].metadata?.tick).toBe(1);

      expect(events[4].seq).toBe(5);
      expect(events[4].type).toBe('instance_resolved');
      expect(events[4].data.winner).toBe(playerId1);
      expect(events[4].metadata?.tick).toBe(720);

      // Verify monotonic sequence and timestamps for deterministic reconstruction
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
        expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
      }

      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'deterministic_reconstruction',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          eventCount: events.length,
          sequenceIntegrity: true,
          timestampIntegrity: true,
          metadataComplete: true,
          ruleVersionRecorded: events[0].data.ruleVersion,
          participantCount: 2,
          gameDurationMs: events[4].data.duration,
        },
      }, 'Deterministic reconstruction test completed successfully');
    });

    it('should handle concurrent replay access and purge operations', async () => {
      const testStart = Date.now();
      const concurrentReplays = 5;
      const replayData: Array<{ id: string; instanceId: string; metadata: ReplayMetadata }> = [];
      
      // Create multiple replays with different expiration times
      for (let i = 0; i < concurrentReplays; i++) {
        const replayId = randomUUID();
        const instanceId = randomUUID();
        const isExpired = i >= 3; // Last 2 replays are expired
        
        const completedAt = new Date(Date.now() - (isExpired ? 10 : 2) * 24 * 60 * 60 * 1000);
        const expiresAt = new Date(completedAt.getTime() + (REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
        
        const metadata: ReplayMetadata = {
          id: replayId,
          instanceId,
          status: ReplayStatus.COMPLETED,
          createdAt: new Date(completedAt.getTime() - 3600000),
          completedAt,
          sizeBytes: 30000 + (i * 10000),
          expiresAt,
          storageRef: `replays/${instanceId}/${replayId}.jsonl`,
          eventCount: 100 + (i * 50),
          checksum: `sha256:concurrent${i}`,
        };
        
        replayData.push({ id: replayId, instanceId, metadata });
        await mockReplayRepo.saveReplay(metadata);
      }

      logger.info({
        event: 'test_start',
        testCase: 'concurrent_access_purge',
        metadata: {
          totalReplays: concurrentReplays,
          activeReplays: 3,
          expiredReplays: 2,
          testStart,
        },
      }, 'Starting concurrent replay access and purge test');

      // Perform concurrent access attempts while purge job runs
      const accessPromises = replayData.map(({ id }) => 
        replayService.getReplayMetadata({ replayId: id })
      );

      const purgePromise = replayPurgeJob.runPurge();

      // Wait for all operations to complete
      const [accessResults, purgeResult] = await Promise.all([
        Promise.all(accessPromises),
        purgePromise,
      ]);

      // Verify purge operation
      expect(purgeResult.success).toBe(true);
      expect(purgeResult.totalPurged).toBe(2); // 2 expired replays
      expect(purgeResult.totalScanned).toBe(2); // Only scans expired replays

      // Verify access results - first 3 should succeed, last 2 should fail (expired/purged)
      for (let i = 0; i < concurrentReplays; i++) {
        const result = accessResults[i];
        if (i < 3) {
          // Active replays should be accessible
          expect(result.success).toBe(true);
          expect(result.replay?.id).toBe(replayData[i].id);
        } else {
          // Expired replays should be denied access or not found
          expect(result.success).toBe(false);
          expect(result.errorCode).toMatch(/EXPIRED|NOT_FOUND/);
        }
      }

      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'concurrent_access_purge',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          purgeSuccessful: purgeResult.success,
          replaysProcessed: purgeResult.totalScanned,
          replaysPurged: purgeResult.totalPurged,
          activeAccessSuccessful: accessResults.slice(0, 3).every(r => r.success),
          expiredAccessDenied: accessResults.slice(3, 5).every(r => !r.success),
        },
      }, 'Concurrent replay access and purge test completed successfully');
    });
  });
});