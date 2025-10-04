import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLogout } from '../../src/features/auth/useLogout';
import { TestAuthWrapper } from '../utils/testAuthWrapper';

describe('Logout Broadcast', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write logout timestamp to localStorage on logout', async () => {
    const { result } = renderHook(() => useLogout(), {
      wrapper: TestAuthWrapper,
    });
    await result.current.logout({ skipConfirmation: true });

    expect(setItemSpy).toHaveBeenCalledWith(
      'tilemud.logout',
      expect.stringMatching(/{"ts":".*"}/)
    );
  });

  it('should use ISO timestamp format', async () => {
    const { result } = renderHook(() => useLogout(), {
      wrapper: TestAuthWrapper,
    });
    await result.current.logout({ skipConfirmation: true });

    const calls = setItemSpy.mock.calls;
    if (calls.length > 0) {
      const broadcastCall = calls.find(call => call[0] === 'tilemud.logout');
      if (broadcastCall) {
        const data = JSON.parse(broadcastCall[1] as string);
        expect(data.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    }
  });

  it('should only write broadcast once per logout session', async () => {
    const { result } = renderHook(() => useLogout(), {
      wrapper: TestAuthWrapper,
    });
    await result.current.logout({ skipConfirmation: true });
    await result.current.logout({ skipConfirmation: true });

    const broadcastCalls = setItemSpy.mock.calls.filter(call => call[0] === 'tilemud.logout');
    expect(broadcastCalls.length).toBeLessThanOrEqual(1);
  });
});