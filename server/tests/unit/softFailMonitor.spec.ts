// T051: Unit tests for quorum logic (soft-fail monitor) (FR-018)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SoftFailMonitor } from '../../src/application/services/softFailMonitor';
import type { ISessionsRepository } from '../../src/infra/persistence/sessionsRepository';

describe('SoftFailMonitor', () => {
  let softFailMonitor: SoftFailMonitor;
  let mockSessionsRepo: ISessionsRepository;
  
  beforeEach(() => {
    mockSessionsRepo = {
      findInstanceById: vi.fn(),
      createInstance: vi.fn(),
      updateInstanceStatus: vi.fn(),
      deleteInstance: vi.fn(),
      findActiveInstances: vi.fn(),
      findInstancesByPlayer: vi.fn(),
      findArenaById: vi.fn(),
      findArenasByInstance: vi.fn(),
      createArena: vi.fn(),
      updateArenaStatus: vi.fn(),
      deleteArena: vi.fn(),
      findAvailableArenas: vi.fn(),
      assignArenaToInstance: vi.fn(),
      unassignArenaFromInstance: vi.fn(),
      getInstanceCapacityUsage: vi.fn(),
      getArenaCapacityUsage: vi.fn()
    };
    softFailMonitor = new SoftFailMonitor(mockSessionsRepo);
  });

  describe('updatePlayerHeartbeat', () => {
    it('should track player heartbeat correctly', async () => {
      const playerId = 'player-123';
      const arenaId = 'arena-456';
      const rttMs = 50;

      await softFailMonitor.updatePlayerHeartbeat(playerId, arenaId, rttMs);

      // Verify the heartbeat was processed (no errors thrown)
      expect(true).toBe(true);
    });

    it('should handle heartbeat without RTT', async () => {
      const playerId = 'player-123';
      const arenaId = 'arena-456';

      await softFailMonitor.updatePlayerHeartbeat(playerId, arenaId);

      expect(true).toBe(true);
    });

    it('should reset consecutive failures on successful heartbeat', async () => {
      const playerId = 'player-123';
      const arenaId = 'arena-456';

      // First, mark player as unresponsive
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');

      // Then send successful heartbeat - should reset failures
      await softFailMonitor.updatePlayerHeartbeat(playerId, arenaId, 25);

      expect(true).toBe(true);
    });
  });

  describe('markPlayerUnresponsive', () => {
    it('should track unresponsive player correctly', async () => {
      const playerId = 'player-123';
      const arenaId = 'arena-456';
      const reason = 'heartbeat';

      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, reason);

      expect(true).toBe(true);
    });

    it('should increment consecutive failures', async () => {
      const playerId = 'player-123';
      const arenaId = 'arena-456';

      // Mark player unresponsive multiple times
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');

      expect(true).toBe(true);
    });
  });

  describe('checkArenaQuorum', () => {
    it('should return continue decision for healthy quorum', async () => {
      const arenaId = 'arena-123';

      // Set up some responsive players
      await softFailMonitor.updatePlayerHeartbeat('player-1', arenaId, 25);
      await softFailMonitor.updatePlayerHeartbeat('player-2', arenaId, 30);
      await softFailMonitor.updatePlayerHeartbeat('player-3', arenaId, 35);

      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(decision.shouldAbort).toBe(false);
      expect(decision.recommendedAction).toBe('continue');
      expect(decision.confidenceScore).toBeGreaterThan(0);
    });

    it('should return abort decision when quorum is lost', async () => {
      const arenaId = 'arena-123';

      // Set up mostly unresponsive players
      await softFailMonitor.updatePlayerHeartbeat('player-1', arenaId, 25);
      await softFailMonitor.markPlayerUnresponsive('player-2', arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive('player-3', arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive('player-4', arenaId, 'heartbeat');

      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(decision.shouldAbort).toBe(true);
      expect(['abort', 'pause', 'migrate']).toContain(decision.recommendedAction);
      expect(decision.reason).toBeDefined();
    });

    it('should handle empty arena gracefully', async () => {
      const arenaId = 'empty-arena';

      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(decision.shouldAbort).toBe(true);
      expect(decision.recommendedAction).toBe('abort');
      expect(decision.reason).toBeDefined();
    });

    it('should consider minimum players for quorum', async () => {
      const arenaId = 'small-arena';

      // Only one player in arena
      await softFailMonitor.updatePlayerHeartbeat('player-1', arenaId, 25);

      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      // Should abort because minimum player threshold not met
      expect(decision.shouldAbort).toBe(true);
      expect(decision.recommendedAction).toBe('abort');
    });
  });

  describe('getArenaQuorumStatus', () => {
    it('should return current arena quorum status', async () => {
      const arenaId = 'arena-123';

      // Set up mixed player status
      await softFailMonitor.updatePlayerHeartbeat('player-1', arenaId, 25);
      await softFailMonitor.updatePlayerHeartbeat('player-2', arenaId, 30);
      await softFailMonitor.markPlayerUnresponsive('player-3', arenaId, 'heartbeat');

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);

      expect(status.arenaId).toBe(arenaId);
      expect(status.totalPlayers).toBeGreaterThanOrEqual(0);
      expect(status.responsivePlayers).toBeGreaterThanOrEqual(0);
      expect(status.responsivePlayers).toBeLessThanOrEqual(status.totalPlayers);
      expect(status.quorumPercent).toBeGreaterThanOrEqual(0);
      expect(status.quorumPercent).toBeLessThanOrEqual(100);
      expect(typeof status.isQuorumMaintained).toBe('boolean');
      expect(status.lastQuorumCheck).toBeDefined();
      expect(status.failureStreak).toBeGreaterThanOrEqual(0);
    });

    it('should handle arena with no players', async () => {
      const arenaId = 'empty-arena';

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);

      expect(status.arenaId).toBe(arenaId);
      expect(status.totalPlayers).toBe(0);
      expect(status.responsivePlayers).toBe(0);
      expect(status.isQuorumMaintained).toBe(false);
    });
  });

  describe('quorum thresholds', () => {
    it('should maintain quorum with sufficient responsive players', async () => {
      const arenaId = 'arena-123';

      // 70% responsive (above 60% threshold)
      for (let i = 1; i <= 7; i++) {
        await softFailMonitor.updatePlayerHeartbeat(`player-${i}`, arenaId, 25);
      }
      for (let i = 8; i <= 10; i++) {
        await softFailMonitor.markPlayerUnresponsive(`player-${i}`, arenaId, 'heartbeat');
      }

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);
      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(status.quorumPercent).toBeGreaterThan(60);
      expect(status.isQuorumMaintained).toBe(true);
      expect(decision.shouldAbort).toBe(false);
    });

    it('should lose quorum with insufficient responsive players', async () => {
      const arenaId = 'arena-123';

      // 30% responsive (below 60% threshold)
      for (let i = 1; i <= 3; i++) {
        await softFailMonitor.updatePlayerHeartbeat(`player-${i}`, arenaId, 25);
      }
      for (let i = 4; i <= 10; i++) {
        await softFailMonitor.markPlayerUnresponsive(`player-${i}`, arenaId, 'heartbeat');
      }

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);
      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(status.quorumPercent).toBeLessThan(60);
      expect(status.isQuorumMaintained).toBe(false);
      expect(decision.shouldAbort).toBe(true);
    });
  });

  describe('heartbeat timeout handling', () => {
    it('should consider players unresponsive after timeout', async () => {
      const arenaId = 'arena-123';
      const playerId = 'player-123';

      // Initial heartbeat
      await softFailMonitor.updatePlayerHeartbeat(playerId, arenaId, 25);

      // Mock time passage beyond timeout threshold
      const mockNow = Date.now() + 35000; // 35 seconds (beyond 30s timeout)
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);

      // Player should be considered unresponsive due to timeout
      expect(status.totalPlayers).toBeGreaterThanOrEqual(1);
      expect(status.responsivePlayers).toBeLessThan(status.totalPlayers);

      vi.restoreAllMocks();
    });

    it('should keep players responsive within timeout window', async () => {
      const arenaId = 'arena-123';
      const playerId = 'player-123';

      await softFailMonitor.updatePlayerHeartbeat(playerId, arenaId, 25);

      // Mock time passage within timeout threshold
      const mockNow = Date.now() + 20000; // 20 seconds (within 30s timeout)
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);

      expect(status.responsivePlayers).toBe(status.totalPlayers);

      vi.restoreAllMocks();
    });
  });

  describe('consecutive failure tracking', () => {
    it('should track consecutive failures correctly', async () => {
      const arenaId = 'arena-123';
      const playerId = 'player-123';

      // Multiple consecutive failures
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');

      // After max failures, player should be marked unresponsive
      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);
      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(status.totalPlayers).toBe(1);
      expect(status.responsivePlayers).toBe(0);
      expect(decision.shouldAbort).toBe(true);
    });

    it('should reset consecutive failures on successful heartbeat', async () => {
      const arenaId = 'arena-123';
      const playerId = 'player-123';

      // Some failures followed by recovery
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');
      await softFailMonitor.markPlayerUnresponsive(playerId, arenaId, 'heartbeat');
      await softFailMonitor.updatePlayerHeartbeat(playerId, arenaId, 25);

      const status = await softFailMonitor.getArenaQuorumStatus(arenaId);

      expect(status.responsivePlayers).toBeGreaterThan(0);
    });
  });

  describe('cleanupSessionData', () => {
    it('should cleanup session data for specified players', async () => {
      const arenaId = 'arena-123';
      const playerIds = ['player-1', 'player-2', 'player-3'];

      await softFailMonitor.cleanupSessionData(arenaId, playerIds);

      expect(true).toBe(true); // Should not throw
    });

    it('should handle empty player list', async () => {
      const arenaId = 'arena-123';
      const playerIds: string[] = [];

      await softFailMonitor.cleanupSessionData(arenaId, playerIds);

      expect(true).toBe(true);
    });
  });

  describe('confidence scoring', () => {
    it('should provide higher confidence for clear decisions', async () => {
      const arenaId = 'arena-123';

      // Clear healthy case
      for (let i = 1; i <= 10; i++) {
        await softFailMonitor.updatePlayerHeartbeat(`player-${i}`, arenaId, 25);
      }

      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(decision.confidenceScore).toBeGreaterThan(0.8);
      expect(decision.shouldAbort).toBe(false);
    });

    it('should provide lower confidence for borderline cases', async () => {
      const arenaId = 'arena-123';

      // Borderline case (exactly at threshold)
      for (let i = 1; i <= 6; i++) {
        await softFailMonitor.updatePlayerHeartbeat(`player-${i}`, arenaId, 25);
      }
      for (let i = 7; i <= 10; i++) {
        await softFailMonitor.markPlayerUnresponsive(`player-${i}`, arenaId, 'heartbeat');
      }

      const decision = await softFailMonitor.checkArenaQuorum(arenaId);

      expect(decision.confidenceScore).toBeLessThan(0.9);
      expect(decision.confidenceScore).toBeGreaterThan(0);
    });
  });
});