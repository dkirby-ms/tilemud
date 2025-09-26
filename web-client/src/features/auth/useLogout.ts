import { useState, useCallback } from 'react';
import { useCharacterStore } from '../character/state/characterStore';
import { useFocusedDirtyGuard } from '../../hooks/useFocusedDirtyGuard';

export interface LogoutOptions {
  skipConfirmation?: boolean;
}

export interface LogoutEvent {
  eventType: 'logout';
  timestampUTC: string;
  reason: 'manual';
  wasOffline: boolean;
  latencyMs: number;
  userSurrogateId?: string;
}

// TODO: Extract MSAL instance from AuthProvider context
// For now, we'll mock the interface
interface MSALInstance {
  logoutRedirect: (options: { account?: any }) => Promise<void>;
  getActiveAccount: () => any;
}

export const useLogout = () => {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const characterStore = useCharacterStore();
  const dirtyGuard = useFocusedDirtyGuard();

  const logout = useCallback(async (options: LogoutOptions = {}) => {
    // Prevent double execution
    if (isLoggingOut) {
      return;
    }

    // Check for unsaved changes guard
    if (!options.skipConfirmation && dirtyGuard.shouldConfirm) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to logout?'
      );
      if (!confirmed) {
        return;
      }
    }

    const startTime = performance.now();
    setIsLoggingOut(true);

    try {
      // Purge character store and sensitive caches BEFORE redirect
      characterStore.reset();

      // Write localStorage broadcast for cross-tab propagation
      const broadcastData = {
        ts: new Date().toISOString()
      };
      localStorage.setItem('tilemud.logout', JSON.stringify(broadcastData));

      // Emit structured dev event (optional, dev-only)
      if (import.meta.env.DEV) {
        const latencyMs = performance.now() - startTime;
        const logoutEvent: LogoutEvent = {
          eventType: 'logout',
          timestampUTC: new Date().toISOString(),
          reason: 'manual',
          wasOffline: !navigator.onLine,
          latencyMs: Math.round(latencyMs)
        };
        console.log('Logout event:', logoutEvent);
      }

      // TODO: Get MSAL instance from context and call logoutRedirect
      // This will be implemented when we integrate with AuthProvider
      console.log('Logout purge completed, would call MSAL logoutRedirect');

    } catch (error) {
      console.error('Logout error:', error);
      // Fail-secure: even if there's an error, user state is already purged
    } finally {
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, characterStore, dirtyGuard]);

  return {
    logout,
    isLoggingOut,
  };
};