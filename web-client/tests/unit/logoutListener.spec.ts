import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogoutListener } from '../../src/hooks/useLogoutListener';

const resetMock = vi.fn();

vi.mock('../../src/features/character/state/characterStore', () => ({
  useCharacterStore: () => ({
    reset: resetMock
  })
}));

describe('useLogoutListener', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMock.mockReset();
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers storage and focus listeners on mount', () => {
    const { unmount } = renderHook(() => useLogoutListener());

    expect(addEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));

    unmount();
  });

  it('ignores unrelated storage events', () => {
    renderHook(() => useLogoutListener());

    const storageEvent = new StorageEvent('storage', {
      key: 'unrelated.key',
      newValue: JSON.stringify({ ts: new Date().toISOString() }),
      storageArea: localStorage
    });

    window.dispatchEvent(storageEvent);

    expect(resetMock).not.toHaveBeenCalled();
  });

  it('purges local state when logout broadcast is received', () => {
    renderHook(() => useLogoutListener());

    const storageEvent = new StorageEvent('storage', {
      key: 'tilemud.logout',
      newValue: JSON.stringify({ ts: new Date().toISOString() }),
      storageArea: localStorage
    });

    window.dispatchEvent(storageEvent);

    expect(resetMock).toHaveBeenCalledTimes(1);
  });

  it('checks for logout broadcast on focus events', () => {
    renderHook(() => useLogoutListener());

    const recentTimestamp = new Date(Date.now() - 10_000).toISOString();
    localStorage.setItem('tilemud.logout', JSON.stringify({ ts: recentTimestamp }));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(resetMock).toHaveBeenCalled();
  });

  it('removes listeners on unmount', () => {
    const { unmount } = renderHook(() => useLogoutListener());
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));
  });
});