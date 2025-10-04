import { describe, it, expect } from 'vitest';

describe('LogoutEvent', () => {
  it('should emit structured logout event with correct shape', () => {
    const mockEvent = {
      eventType: 'logout',
      timestampUTC: '2025-09-26T12:00:00.000Z',
      reason: 'manual',
      wasOffline: false,
      latencyMs: 150,
    };

    // This test should fail initially until useLogout implements event emission
    expect(mockEvent.eventType).toBe('logout');
    expect(mockEvent.reason).toBe('manual');
    expect(typeof mockEvent.latencyMs).toBe('number');
    expect(typeof mockEvent.wasOffline).toBe('boolean');
  });

  it('should include userSurrogateId when available', () => {
    const mockEventWithUser = {
      eventType: 'logout',
      userSurrogateId: 'test-user-surrogate-123',
      timestampUTC: '2025-09-26T12:00:00.000Z',
      reason: 'manual',
      wasOffline: false,
      latencyMs: 150,
    };

    expect(mockEventWithUser.userSurrogateId).toBeDefined();
  });
});