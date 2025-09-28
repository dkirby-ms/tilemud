// T059: Core session service unit tests - focused on essential functionality
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionService, SessionConfig } from '../../src/application/services/session/sessionService';
import { AdmissionStatus, AttemptOutcome, FailureReason, SessionState, DisconnectReason } from '../../src/domain/connection/types';
import Redis from 'ioredis';

// Mock ioredis
vi.mock('ioredis');

// Mock UUID
vi.mock('uuid', () => ({
  v4: () => 'test-session-uuid'
}));

describe('SessionService - Core Tests', () => {
  let mockRedis: any;
  let sessionService: SessionService;

  const defaultConfig: SessionConfig = {
    maxActiveSessions: 100,
    gracePeriodSeconds: 30,
    sessionTimeoutSeconds: 3600,
    heartbeatIntervalSeconds: 60,
    reconnectionTokenTTL: 300
  };

  beforeEach(() => {
    // Mock Redis operations with comprehensive coverage
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      smembers: vi.fn(),
      sadd: vi.fn(),
      srem: vi.fn(),
      zadd: vi.fn(),
      zrem: vi.fn(),
      zcard: vi.fn(),
      keys: vi.fn(),
      hset: vi.fn(),
      expire: vi.fn()
    };

    sessionService = new SessionService(mockRedis as Redis, defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Admission Flow', () => {
    it('should admit new character successfully', async () => {
      const admitRequest = {
        instanceId: 'instance-1',
        characterId: 'char-123'
      };

      // Mock successful flow
      mockRedis.get.mockResolvedValue(null); // No existing session
      mockRedis.smembers.mockResolvedValue(['session-1', 'session-2']); // Under capacity
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const result = await sessionService.admit(admitRequest);

      expect(result.status).toBe(AdmissionStatus.ADMITTED);
      expect(result.sessionToken).toBe('test-session-uuid');
    });

    it('should reject when character already has active session', async () => {
      const admitRequest = {
        instanceId: 'instance-1',
        characterId: 'char-123'
      };

      const existingSessionData = JSON.stringify({
        sessionId: 'existing-session',
        characterId: 'char-123',
        state: SessionState.ACTIVE,
        createdAt: new Date().toISOString()
      });

      mockRedis.get
        .mockResolvedValueOnce('existing-session')
        .mockResolvedValueOnce(existingSessionData);

      const result = await sessionService.admit(admitRequest);

      expect(result.status).toBe(AdmissionStatus.REJECTED);
      expect(result.reason).toBe(FailureReason.ALREADY_IN_SESSION.toString());
    });
  });

  describe('Character Admission', () => {
    it('should successfully admit character to instance', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.smembers.mockResolvedValue(['session-1']); // Under capacity
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1');

      expect(result.outcome).toBe(AttemptOutcome.SUCCESS);
      expect(result.session).toBeDefined();
      expect(result.session!.characterId).toBe('char-123');
      expect(result.session!.state).toBe(SessionState.ACTIVE);
    });

    it('should reject when instance is at capacity', async () => {
      mockRedis.get.mockResolvedValue(null);
      // Mock 100 sessions (at capacity)
      mockRedis.smembers.mockResolvedValue(Array(100).fill(0).map((_, i) => `session-${i}`));

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1');

      expect(result.outcome).toBe(AttemptOutcome.FAILED);
      expect(result.failureReason).toBe(FailureReason.CAPACITY_FULL);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1');

      expect(result.outcome).toBe(AttemptOutcome.FAILED);
      expect(result.failureReason).toBe(FailureReason.INTERNAL_ERROR);
    });
  });

  describe('Session Management', () => {
    it('should terminate existing session', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'session-123',
        characterId: 'char-123',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE,
        reconnectionToken: 'reconnect-token'
      });

      mockRedis.get.mockResolvedValue(sessionData);
      mockRedis.del.mockResolvedValue(1);
      mockRedis.srem.mockResolvedValue(1);
      mockRedis.zrem.mockResolvedValue(1);

      const result = await sessionService.terminateSession('session-123', DisconnectReason.USER);

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledTimes(3); // Session data, character mapping, reconnection token
    });

    it('should return session data for existing session', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'session-123',
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE,
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString()
      });

      mockRedis.get.mockResolvedValue(sessionData);

      const result = await sessionService.getSession('session-123');

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('session-123');
      expect(result!.characterId).toBe('char-123');
      expect(result!.state).toBe(SessionState.ACTIVE);
    });

    it('should update heartbeat for active session', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'session-123',
        characterId: 'char-123',
        state: SessionState.ACTIVE,
        createdAt: new Date().toISOString()
      });

      mockRedis.get.mockResolvedValue(sessionData);
      mockRedis.setex.mockResolvedValue('OK');

      const result = await sessionService.updateHeartbeat('session-123');

      expect(result).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalled();
    });
  });

  describe('Grace Period Management', () => {
    it('should enter grace period for active session', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'session-123',
        characterId: 'char-123',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE,
        createdAt: new Date().toISOString()
      });

      mockRedis.get.mockResolvedValue(sessionData);
      mockRedis.setex.mockResolvedValue('OK'); // Store updated session and reconnection token
      mockRedis.zadd.mockResolvedValue(1); // Add to grace period set

      const result = await sessionService.enterGracePeriod('session-123');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string'); // Should return reconnection token
      expect(mockRedis.setex).toHaveBeenCalledTimes(2); // Session update + reconnection token
      expect(mockRedis.zadd).toHaveBeenCalled(); // Grace period tracking
    });

    it('should reconnect with valid token', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'session-123',
        characterId: 'char-123',
        instanceId: 'instance-1',
        state: SessionState.GRACE,
        reconnectionToken: 'reconnect-token-123',
        createdAt: new Date().toISOString()
      });

      mockRedis.get
        .mockResolvedValueOnce('session-123') // Get session ID from reconnection token
        .mockResolvedValueOnce(sessionData); // Get session data

      mockRedis.setex.mockResolvedValue('OK'); // Update session to active
      mockRedis.del.mockResolvedValue(1); // Remove reconnection token
      mockRedis.zrem.mockResolvedValue(1); // Remove from grace period

      const result = await sessionService.reconnectWithToken('reconnect-token-123');

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session!.sessionId).toBe('session-123');
      expect(result.session!.state).toBe(SessionState.ACTIVE);
    });
  });

  describe('Statistics', () => {
    it('should return active session count', async () => {
      mockRedis.smembers.mockResolvedValue(['session-1', 'session-2', 'session-3']);

      const result = await sessionService.getActiveSessionCount('instance-1');

      expect(result).toBe(3);
    });

    it('should return session by character', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'session-123',
        characterId: 'char-123',
        state: SessionState.ACTIVE,
        createdAt: new Date().toISOString()
      });

      mockRedis.get
        .mockResolvedValueOnce('session-123') // Get session ID by character
        .mockResolvedValueOnce(sessionData); // Get session data

      const result = await sessionService.getSessionByCharacter('char-123');

      expect(result).toBeDefined();
      expect(result!.characterId).toBe('char-123');
    });

    it('should return service statistics', async () => {
      mockRedis.keys
        .mockResolvedValueOnce(['session:instance:instance-1', 'session:instance:instance-2']) // Instance keys
        .mockResolvedValueOnce(['session:grace:instance-1:session-1']); // Grace keys

      mockRedis.smembers
        .mockResolvedValueOnce(['session-1', 'session-2']) // instance-1 sessions
        .mockResolvedValueOnce(['session-3']); // instance-2 sessions

      mockRedis.zcard.mockResolvedValue(1); // Grace period count

      const result = await sessionService.getServiceStats();

      expect(result.totalActiveSessions).toBe(3);
      expect(result.totalGraceSessions).toBe(1);
      expect(result.sessionsByInstance['instance-1']).toBe(2);
      expect(result.sessionsByInstance['instance-2']).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed session data gracefully', async () => {
      mockRedis.get.mockResolvedValue('invalid-json');

      const result = await sessionService.getSession('session-123');

      expect(result).toBe(null);
    });

    it('should handle Redis connection errors', async () => {
      mockRedis.smembers.mockRejectedValue(new Error('Connection failed'));

      const result = await sessionService.getActiveSessionCount('instance-1');

      expect(result).toBe(0); // Should return 0 on error
    });

    it('should handle concurrent admission attempts safely', async () => {
      mockRedis.get.mockResolvedValue(null); // No existing session
      mockRedis.smembers.mockResolvedValue(['session-1']); // Under capacity
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      // Simulate concurrent requests
      const requests = [
        sessionService.admitCharacter('char-1', 'user-1', 'instance-1'),
        sessionService.admitCharacter('char-2', 'user-2', 'instance-1'),
        sessionService.admitCharacter('char-3', 'user-3', 'instance-1')
      ];

      const results = await Promise.all(requests);

      // All should succeed with proper mocking
      results.forEach(result => {
        expect(result.outcome).toBe(AttemptOutcome.SUCCESS);
      });
    });
  });
});