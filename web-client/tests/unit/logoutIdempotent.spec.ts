import { describe, it, expect, vi } from 'vitest';
import { useLogout } from '../../src/features/auth/useLogout';
import { renderHook } from '@testing-library/react';
import { TestAuthWrapper } from '../utils/testAuthWrapper';

describe('Logout Idempotency', () => {
  it('handles rapid double logout invocation without duplicate side effects', async () => {
    const { result } = renderHook(() => useLogout(), {
      wrapper: TestAuthWrapper,
    });

    const logoutFn = result.current.logout;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await Promise.all([
      logoutFn({ skipConfirmation: true }),
      logoutFn({ skipConfirmation: true })
    ]);

    expect(setItemSpy.mock.calls.filter(call => call[0] === 'tilemud.logout').length).toBeLessThanOrEqual(1);

    setItemSpy.mockRestore();
  });

  it('is a no-op on subsequent calls after the first logout', async () => {
    const { result } = renderHook(() => useLogout(), {
      wrapper: TestAuthWrapper,
    });

    const logoutFn = result.current.logout;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await logoutFn({ skipConfirmation: true });
    const callsAfterFirst = setItemSpy.mock.calls.length;

    await logoutFn({ skipConfirmation: true });

    expect(setItemSpy.mock.calls.length).toBe(callsAfterFirst);

    setItemSpy.mockRestore();
  });
});