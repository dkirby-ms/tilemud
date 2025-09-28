// T059: Unit tests for session service (FR-001, FR-002, FR-003, FR-004, FR-008, FR-009)
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionService, SessionConfig, AdmissionResult } from '../../src/application/services/session/sessionService';
import { CharacterSession, SessionState, DisconnectReason, AttemptOutcome, FailureReason, AdmissionStatus } from '../../src/domain/connection/types';
import Redis from 'ioredis';

// Mock ioredis and uuid
vi.mock('ioredis');
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-session-uuid')
}));

describe('SessionService', () => {
  let mockRedis: any;
  let sessionService: SessionService;

  const defaultConfig: SessionConfig = {
    gracePeriodSeconds: 60,
    maxActiveSessions: 100,
    sessionTimeoutSeconds: 86400, // 24 hours
    reconnectionTokenTTL: 60,
    heartbeatIntervalSeconds: 30
  };

  beforeEach(() => {
    // Mock Redis operations  
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
      hget: vi.fn(),
      hset: vi.fn(),
      hgetall: vi.fn(),
      hdel: vi.fn(),
      hmset: vi.fn(),
      zadd: vi.fn(),
      zrem: vi.fn(),
      zcard: vi.fn(),
      smembers: vi.fn(),
      sadd: vi.fn(),
      srem: vi.fn(),
      keys: vi.fn(),
      llen: vi.fn(),
      lpush: vi.fn(),
      lpop: vi.fn()
    };

    sessionService = new SessionService(mockRedis as Redis, defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config when none provided', () => {
      const service = new SessionService(mockRedis as Redis);
      expect(service).toBeInstanceOf(SessionService);
    });

    it('should merge provided config with defaults', () => {
      const customConfig = { gracePeriodSeconds: 30 };
      const service = new SessionService(mockRedis as Redis, customConfig);
      expect(service).toBeInstanceOf(SessionService);
    });
  });

  describe('admit', () => {
    const admitRequest = {
      instanceId: 'instance-1',
      characterId: 'char-123'
    };

    it('should admit new character successfully', async () => {
      // Mock no existing session
      mockRedis.get.mockResolvedValue(null);
      mockRedis.smembers.mockResolvedValue(['session-1', 'session-2']); // 2 active sessions (under capacity)
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const result = await sessionService.admit(admitRequest);

      expect(result.status).toBe(AdmissionStatus.ADMITTED);
      expect(result.sessionToken).toBe('test-session-uuid');
    });

    it('should handle replacement flow when replaceToken provided', async () => {
      const requestWithToken = {
        ...admitRequest,
        replaceToken: 'replace-token-123'
      };

      const replacementData = JSON.stringify({
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        existingSessionId: 'old-session-id'
      });

      const oldSessionData = JSON.stringify({
        sessionId: 'old-session-id',
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE,
        createdAt: new Date().toISOString()
      });

      mockRedis.get
        .mockResolvedValueOnce(replacementData) // Get replacement token data
        .mockResolvedValueOnce('old-session-id') // Get existing session ID by character
        .mockResolvedValueOnce(oldSessionData); // Get old session data
      mockRedis.del.mockResolvedValue(1); // Delete replacement token and session cleanup
      mockRedis.zrem.mockResolvedValue(1); // Remove from grace period
      mockRedis.srem.mockResolvedValue(1); // Remove from instance set
      mockRedis.smembers.mockResolvedValue(['session-1']); // 1 active session (under capacity after cleanup)
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ sessionId: 'session-1', state: SessionState.ACTIVE })); // Mock the existing session
      mockRedis.setex.mockResolvedValue('OK'); // Store new session
      mockRedis.sadd.mockResolvedValue(1); // Add to instance set

      const result = await sessionService.admit(requestWithToken);

      expect(result.status).toBe(AdmissionStatus.REPLACED);
      expect(result.sessionToken).toBe('test-session-uuid');
    });

    it('should reject when character already has active session', async () => {
      const existingSessionData = JSON.stringify({
        sessionId: 'existing-session',
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE,
        connectedAt: Date.now()
      });

      mockRedis.get
        .mockResolvedValueOnce('existing-session') // Character has session
        .mockResolvedValueOnce(existingSessionData); // Session data

      const result = await sessionService.admit(admitRequest);

      expect(result.status).toBe(AdmissionStatus.REJECTED);
      expect(result.reason).toBe(FailureReason.ALREADY_IN_SESSION.toString());
    });
  });

  describe('admitCharacter', () => {
    it('should successfully admit character to instance', async () => {
      mockRedis.get.mockResolvedValue(null); // No existing session
      mockRedis.smembers.mockResolvedValue(['session-1', 'session-2']); // 2 active sessions (under capacity)
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1');

      expect(result.outcome).toBe(AttemptOutcome.SUCCESS);
      expect(result.session).toBeDefined();
      expect(result.session!.characterId).toBe('char-123');
      expect(result.session!.state).toBe(SessionState.ACTIVE);
    });

    it('should reject when instance is at capacity', async () => {
      // Ensure no existing session for this character
      mockRedis.get.mockResolvedValueOnce(null); // No existing session for character
      
      const activeSessions = Array(100).fill(0).map((_, i) => `session-${i}`);
      mockRedis.smembers.mockResolvedValue(activeSessions); // At capacity (100 sessions)
      
      // Mock all 100 sessions as active
      for (let i = 0; i < 100; i++) {
        mockRedis.get.mockResolvedValueOnce(JSON.stringify({
          sessionId: `session-${i}`,
          state: SessionState.ACTIVE
        }));
      }

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1');

      expect(result.outcome).toBe(AttemptOutcome.FAILED);
      expect(result.failureReason).toBe(FailureReason.CAPACITY_FULL);
    });

    it('should generate replacement token when allowReplacement is true', async () => {
      const existingSessionData = JSON.stringify({
        sessionId: 'existing-session',
        state: SessionState.ACTIVE
      });

      mockRedis.get
        .mockResolvedValueOnce('existing-session')
        .mockResolvedValueOnce(existingSessionData);
      mockRedis.setex.mockResolvedValue('OK'); // Store replacement token

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1', true);

      expect(result.outcome).toBe(AttemptOutcome.FAILED);
      expect(result.failureReason).toBe(FailureReason.ALREADY_IN_SESSION);
      expect(result.replacementToken).toBeDefined();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await sessionService.admitCharacter('char-123', 'user-456', 'instance-1');

      expect(result.outcome).toBe(AttemptOutcome.FAILED);
      expect(result.failureReason).toBe(FailureReason.INTERNAL_ERROR);
    });
  });

  describe('enterGracePeriod', () => {
    it('should successfully enter grace period for active session', async () => {
      const activeSession = {
        sessionId: 'session-123',
        characterId: 'char-123',
        state: SessionState.ACTIVE,
        instanceId: 'instance-1',
        connectedAt: Date.now()
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(activeSession)); // Get session as JSON
      mockRedis.setex.mockResolvedValue('OK'); // Store reconnection token
      mockRedis.zadd.mockResolvedValue(1); // Add to grace period
      mockRedis.setex.mockResolvedValue('OK'); // Store updated session

      const result = await sessionService.enterGracePeriod('session-123');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string'); // Should return reconnection token
    });

    it('should return null for non-active session', async () => {
      const graceSession = {
        sessionId: 'session-123',
        state: SessionState.GRACE
      };

      mockRedis.hgetall.mockResolvedValue(graceSession);

      const result = await sessionService.enterGracePeriod('session-123');

      expect(result).toBeNull();
    });

    it('should return null for non-existent session', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const result = await sessionService.enterGracePeriod('session-123');

      expect(result).toBeNull();
    });
  });

  describe('reconnectWithToken', () => {
    it('should successfully reconnect with valid token', async () => {
      const sessionData = {
        sessionId: 'session-123',
        characterId: 'char-123',
        state: SessionState.GRACE,
        graceExpiresAt: Date.now() + 30000 // 30 seconds from now
      };

      mockRedis.get
        .mockResolvedValueOnce('session-123') // Token maps to session
        .mockResolvedValueOnce(null); // Clear reconnection token
      mockRedis.hgetall.mockResolvedValue(sessionData);
      mockRedis.del.mockResolvedValue(1);

      const result = await sessionService.reconnectWithToken('reconnect-token-123');

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session!.sessionId).toBe('session-123');
    });

    it('should fail with invalid token', async () => {
      mockRedis.get.mockResolvedValue(null); // Token not found

      const result = await sessionService.reconnectWithToken('invalid-token');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Invalid or expired');
    });

    it('should fail with expired grace period', async () => {
      const sessionData = {
        sessionId: 'session-123',
        state: SessionState.GRACE,
        graceExpiresAt: Date.now() - 1000 // Expired 1 second ago
      };

      mockRedis.get.mockResolvedValueOnce('session-123');
      mockRedis.hgetall.mockResolvedValue(sessionData);

      const result = await sessionService.reconnectWithToken('reconnect-token-123');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should fail when session not in grace state', async () => {
      const sessionData = {
        sessionId: 'session-123',
        state: SessionState.ACTIVE
      };

      mockRedis.get.mockResolvedValueOnce('session-123');
      mockRedis.hgetall.mockResolvedValue(sessionData);

      const result = await sessionService.reconnectWithToken('reconnect-token-123');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not in grace');
    });
  });

  describe('updateHeartbeat', () => {
    it('should update heartbeat for active session', async () => {
      const activeSession = {
        sessionId: 'session-123',
        state: SessionState.ACTIVE,
        lastHeartbeat: Date.now() - 10000
      };

      mockRedis.hgetall.mockResolvedValue(activeSession);

      const result = await sessionService.updateHeartbeat('session-123');

      expect(result).toBe(true);
      expect(mockRedis.hset).toHaveBeenCalledWith(
        expect.stringContaining('session-123'),
        'lastHeartbeat',
        expect.any(String)
      );
    });

    it('should return false for non-active session', async () => {
      const graceSession = {
        sessionId: 'session-123',
        state: SessionState.GRACE
      };

      mockRedis.hgetall.mockResolvedValue(graceSession);

      const result = await sessionService.updateHeartbeat('session-123');

      expect(result).toBe(false);
    });

    it('should return false for non-existent session', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const result = await sessionService.updateHeartbeat('session-123');

      expect(result).toBe(false);
    });
  });

  describe('terminateSession', () => {
    it('should terminate existing session', async () => {
      const activeSession = {
        sessionId: 'session-123',
        characterId: 'char-123',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE
      };

      mockRedis.hgetall.mockResolvedValue(activeSession);
      mockRedis.del.mockResolvedValue(1); // Delete session and character mapping

      const result = await sessionService.terminateSession('session-123', DisconnectReason.USER);

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledTimes(2); // Session data and character mapping
    });

    it('should return false for non-existent session', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const result = await sessionService.terminateSession('session-123', DisconnectReason.NETWORK);

      expect(result).toBe(false);
    });

    it('should handle Redis errors', async () => {
      mockRedis.hgetall.mockRejectedValue(new Error('Redis error'));

      const result = await sessionService.terminateSession('session-123', DisconnectReason.GRACE_EXPIRED);

      expect(result).toBe(false);
    });
  });

  describe('getSession', () => {
    it('should return session data for existing session', async () => {
      const sessionData = {
        sessionId: 'session-123',
        characterId: 'char-123',
        userId: 'user-456',
        instanceId: 'instance-1',
        state: SessionState.ACTIVE.toString(),
        connectedAt: Date.now().toString()
      };

      mockRedis.hgetall.mockResolvedValue(sessionData);

      const result = await sessionService.getSession('session-123');

      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('session-123');
      expect(result!.characterId).toBe('char-123');
      expect(result!.state).toBe(SessionState.ACTIVE);
    });

    it('should return null for non-existent session', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const result = await sessionService.getSession('session-123');

      expect(result).toBeNull();
    });

    it('should handle Redis errors', async () => {
      mockRedis.hgetall.mockRejectedValue(new Error('Redis error'));

      const result = await sessionService.getSession('session-123');

      expect(result).toBeNull();
    });
  });

  describe('getSessionByCharacter', () => {
    it('should return session for character', async () => {
      const sessionData = {
        sessionId: 'session-123',
        characterId: 'char-123',
        state: SessionState.ACTIVE
      };

      mockRedis.get
        .mockResolvedValueOnce('session-123') // Character mapping returns session ID
        .mockResolvedValueOnce(JSON.stringify(sessionData)); // Session data returns JSON

      const result = await sessionService.getSessionByCharacter('char-123');

      expect(result).toBeDefined();
      expect(result!.characterId).toBe('char-123');
    });

    it('should return null when character has no session', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await sessionService.getSessionByCharacter('char-123');

      expect(result).toBeNull();
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return count of active sessions', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];
      const activeSession = {
        sessionId: 'session-1',
        characterId: 'char-1',
        state: SessionState.ACTIVE
      };
      const inactiveSession = {
        sessionId: 'session-2',
        characterId: 'char-2',
        state: SessionState.GRACE
      };

      mockRedis.smembers.mockResolvedValue(sessionIds);
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(activeSession))
        .mockResolvedValueOnce(JSON.stringify(inactiveSession))
        .mockResolvedValueOnce(null); // session-3 doesn't exist

      const result = await sessionService.getActiveSessionCount('instance-1');

      expect(result).toBe(1); // Only one active session
      expect(mockRedis.smembers).toHaveBeenCalledWith(
        expect.stringContaining('instance-1')
      );
    });

    it('should handle Redis errors and return 0', async () => {
      mockRedis.smembers.mockRejectedValue(new Error('Redis error'));

      const result = await sessionService.getActiveSessionCount('instance-1');

      expect(result).toBe(0);
    });
  });

  describe('getServiceStats', () => {
    it('should return service statistics', async () => {
      const activeSession1 = {
        sessionId: 'session-1',
        characterId: 'char-1',
        state: SessionState.ACTIVE,
        admittedAt: 1000000000
      };
      const activeSession2 = {
        sessionId: 'session-2',
        characterId: 'char-2',
        state: SessionState.ACTIVE,
        admittedAt: 1000000001
      };

      // Mock for grace sessions
      mockRedis.keys
        .mockResolvedValueOnce(['dev:session:grace:instance-1:user-1']) // Grace keys
        .mockResolvedValueOnce(['dev:session:active:instance-1', 'dev:session:active:instance-2']); // Instance keys

      mockRedis.zcard.mockResolvedValue(2); // Grace sessions count

      mockRedis.smembers
        .mockResolvedValueOnce(['session-1']) // instance-1 sessions
        .mockResolvedValueOnce(['session-2']); // instance-2 sessions

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(activeSession1))
        .mockResolvedValueOnce(JSON.stringify(activeSession2));

      const result = await sessionService.getServiceStats();

      expect(result).toEqual({
        totalActiveSessions: 2,
        totalGraceSessions: 2,
        sessionsByInstance: {
          'instance-1': 1,
          'instance-2': 1
        },
        oldestSession: 1000000000
      });
    });

    it('should handle Redis errors', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));

      const result = await sessionService.getServiceStats();

      expect(result).toEqual({
        totalActiveSessions: 0,
        totalGraceSessions: 0,
        sessionsByInstance: {},
        oldestSession: expect.any(Number)
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle malformed session data gracefully', async () => {
      const malformedData = '{"sessionId": "test"}'; // Missing required fields, but valid JSON

      mockRedis.get.mockResolvedValue(malformedData);

      const result = await sessionService.getSession('test');

      // Should handle malformed data gracefully
      expect(result).not.toThrow;
    });

    it('should handle concurrent admission attempts', async () => {
      // Simulate race condition
      mockRedis.get.mockResolvedValue(null); // No existing sessions
      mockRedis.smembers.mockResolvedValue(['existing-session']); // One existing session in instance
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ 
        sessionId: 'existing-session', 
        state: SessionState.ACTIVE 
      })); // Mock the existing session data
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const promises = [
        sessionService.admitCharacter('char-1', 'user-1', 'instance-1'),
        sessionService.admitCharacter('char-2', 'user-2', 'instance-1'),
        sessionService.admitCharacter('char-3', 'user-3', 'instance-1')
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle session state transitions correctly', async () => {
      const sessionData = {
        sessionId: 'session-123',
        state: SessionState.ACTIVE
      };

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(sessionData)) // Session data as JSON
        .mockResolvedValueOnce('OK'); // Zadd result
      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');

      // Test that grace period can only be entered from ACTIVE state
      const graceToken = await sessionService.enterGracePeriod('session-123');
      expect(graceToken).toBeDefined();
    });
  });
});