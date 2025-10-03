import { useState, useCallback, useRef } from 'react';
import { useCharacterStore } from '../character/state/characterStore';
import { useFocusedDirtyGuard } from '../../hooks/useFocusedDirtyGuard';
import { useAuthActions } from '../../providers/authContext';

/**
 * Custom hook for handling user logout with comprehensive state management.
 * 
 * Provides logout functionality with the following features:
 * - Checks for unsaved changes in focused form fields before logout
 * - Shows loading state during logout process with 400ms minimum spinner
 * - Purges all local character data from Zustand store
 * - Broadcasts logout event to other browser tabs via localStorage
 * - Handles MSAL redirect for authentication cleanup
 * - Prevents duplicate logout operations with idempotency guards
 * - Emits developer events for debugging and testing
 * 
 * @returns {Object} Logout hook interface
 * @returns {boolean} isLoading - True when logout operation is in progress
 * @returns {Function} logout - Function to initiate logout process
 * 
 * @example
 * ```tsx
 * function LogoutButton() {
 *   const { logout, isLoading } = useLogout();
 *   
 *   return (
 *     <button onClick={logout} disabled={isLoading}>
 *       {isLoading ? 'Signing out...' : 'Sign Out'}
 *     </button>
 *   );
 * }
 * ```
 */

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
export const useLogout = () => {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const [hasLoggedOut, setHasLoggedOut] = useState(false);
  const characterStore = useCharacterStore();
  const dirtyGuard = useFocusedDirtyGuard();
  const { logout: authLogout } = useAuthActions();
  const spinnerTimeoutRef = useRef<number | null>(null);

  const logout = useCallback(async (options: LogoutOptions = {}) => {
    // Prevent double execution (idempotency check)
    if (isLoggingOut || hasLoggedOut) {
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
    setHasLoggedOut(true);

    // Set up delayed spinner (400ms threshold)
    spinnerTimeoutRef.current = window.setTimeout(() => {
      setShowSpinner(true);
    }, 400);

    try {
      // Purge character store and sensitive caches BEFORE redirect
      characterStore.reset();

      // Write localStorage broadcast for cross-tab propagation (only once per session)
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

      // Call MSAL logout which will redirect to auth provider and clear session
      await authLogout();

      // Note: Code after authLogout() may not execute due to redirect
      // The finally block will run if there's an error before redirect

    } catch (error) {
      console.error('Logout error:', error);
      // Fail-secure: even if there's an error, user state is already purged
    } finally {
      // Clear spinner timeout and state
      if (spinnerTimeoutRef.current) {
        window.clearTimeout(spinnerTimeoutRef.current);
        spinnerTimeoutRef.current = null;
      }
      setShowSpinner(false);
      setIsLoggingOut(false);
    }
  }, [authLogout, isLoggingOut, hasLoggedOut, characterStore, dirtyGuard]);

  return {
    logout,
    isLoggingOut,
    showSpinner,
  };
};