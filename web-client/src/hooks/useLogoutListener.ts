import { useEffect } from 'react';
import { useCharacterStore } from '../features/character/state/characterStore';

export const useLogoutListener = () => {
  const characterStore = useCharacterStore();

  useEffect(() => {
    const handleStorageEvent = (event: StorageEvent) => {
      // Only handle logout broadcast events
      if (event.key !== 'tilemud.logout' || !event.newValue) {
        return;
      }

      try {
        // Parse the broadcast data
        const data = JSON.parse(event.newValue);
        if (data.ts) {
          // Another tab has logged out, purge local state
          characterStore.reset();
          
          // Optional: Emit dev event
          if (import.meta.env.DEV) {
            console.log('Cross-tab logout detected, purging local state');
          }
        }
      } catch (error) {
        console.error('Error parsing logout broadcast:', error);
      }
    };

    // Listen for storage events
    window.addEventListener('storage', handleStorageEvent);

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [characterStore]);

  useEffect(() => {
    // Optional: Check for logout broadcast on window focus
    const handleFocus = () => {
      const logoutBroadcast = localStorage.getItem('tilemud.logout');
      if (logoutBroadcast) {
        try {
          const data = JSON.parse(logoutBroadcast);
          // If there's a recent logout broadcast, purge state
          if (data.ts && new Date(data.ts).getTime() > Date.now() - 30000) { // Within last 30 seconds
            characterStore.reset();
            
            if (import.meta.env.DEV) {
              console.log('Focus-based logout check triggered purge');
            }
          }
        } catch (error) {
          console.error('Error checking logout broadcast on focus:', error);
        }
      }
    };

    window.addEventListener('focus', handleFocus);
    
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [characterStore]);
};