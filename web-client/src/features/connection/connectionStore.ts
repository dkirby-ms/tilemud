/**
 * Connection store using Zustand
 * Provides reactive state management for WebSocket connection
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ConnectionService } from './ConnectionService';
import {
  ConnectionState,
  INITIAL_CONNECTION_STATE,
  INITIAL_CONNECTION_CONTEXT,
} from './machine/types';
import type { ConnectionContext, ConnectionError, QueuePosition, MaintenanceInfo } from './machine/types';

/**
 * Connection store state
 */
export interface ConnectionStoreState {
  // Connection service instance
  service: ConnectionService | null;
  
  // Connection state
  state: ConnectionState;
  context: ConnectionContext;
  
  // Derived states for easy access
  isConnected: boolean;
  isConnecting: boolean;
  canRetry: boolean;
  
  // UI state
  showRetryButton: boolean;
  showCancelButton: boolean;
  
  // Recent notifications
  notifications: Array<{
    id: string;
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    timestamp: Date;
  }>;
  
  // Actions
  initializeService: () => void;
  connect: (characterId: string) => void;
  disconnect: () => void;
  retry: () => void;
  cancel: () => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
  destroy: () => void;
}

/**
 * Create connection store
 */
export const useConnectionStore = create<ConnectionStoreState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    service: null,
    state: INITIAL_CONNECTION_STATE,
    context: { ...INITIAL_CONNECTION_CONTEXT },
    isConnected: false,
    isConnecting: false,
    canRetry: false,
    showRetryButton: false,
    showCancelButton: false,
    notifications: [],

    /**
     * Initialize the connection service
     */
    initializeService: () => {
      const { service } = get();
      if (service) {
        service.destroy();
      }

      const newService = new ConnectionService();
      
      // Set up event handlers
      newService.on('stateChange', (newState: ConnectionState, newContext: ConnectionContext) => {
        set({
          state: newState,
          context: newContext,
          isConnected: newService.isConnected(),
          isConnecting: newService.isConnecting(),
          canRetry: newService.canRetry(),
          showRetryButton: newService.canRetry() && !newService.isConnecting(),
          showCancelButton: newService.isConnecting(),
        });
      });

      newService.on('notification', (type, message) => {
        const notification = {
          id: `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type,
          message,
          timestamp: new Date(),
        };
        
        set((state) => ({
          notifications: [...state.notifications, notification],
        }));
        
        // Auto-dismiss success and info notifications after 5 seconds
        if (type === 'success' || type === 'info') {
          setTimeout(() => {
            get().dismissNotification(notification.id);
          }, 5000);
        }
      });

      newService.on('error', (error: ConnectionError) => {
        console.error('Connection error:', error);
      });

      newService.on('connected', () => {
        console.log('Connected to server');
      });

      newService.on('disconnected', () => {
        console.log('Disconnected from server');
      });

      newService.on('maintenanceMode', (info: MaintenanceInfo) => {
        console.log('Maintenance mode:', info);
      });

      newService.on('queueUpdate', (position: QueuePosition) => {
        console.log('Queue position updated:', position);
      });

      set({
        service: newService,
        isConnected: newService.isConnected(),
        isConnecting: newService.isConnecting(),
        canRetry: newService.canRetry(),
        showRetryButton: newService.canRetry() && !newService.isConnecting(),
        showCancelButton: newService.isConnecting(),
      });
    },

    /**
     * Connect to the server
     */
    connect: (characterId: string) => {
      const { service } = get();
      if (!service) {
        get().initializeService();
      }
      
      get().service?.connect(characterId);
    },

    /**
     * Disconnect from the server
     */
    disconnect: () => {
      get().service?.disconnect();
    },

    /**
     * Retry connection
     */
    retry: () => {
      get().service?.retry();
    },

    /**
     * Cancel current connection attempt
     */
    cancel: () => {
      get().service?.cancel();
    },

    /**
     * Dismiss a notification
     */
    dismissNotification: (id: string) => {
      set((state) => ({
        notifications: state.notifications.filter(n => n.id !== id),
      }));
    },

    /**
     * Clear all notifications
     */
    clearAllNotifications: () => {
      set({ notifications: [] });
    },

    /**
     * Destroy the connection service
     */
    destroy: () => {
      const { service } = get();
      if (service) {
        service.destroy();
        set({
          service: null,
          state: INITIAL_CONNECTION_STATE,
          context: { ...INITIAL_CONNECTION_CONTEXT },
          isConnected: false,
          isConnecting: false,
          canRetry: false,
          showRetryButton: false,
          showCancelButton: false,
          notifications: [],
        });
      }
    },
  }))
);

/**
 * Selector hooks for specific pieces of state
 */
export const useConnectionState = () => useConnectionStore(state => state.state);
export const useConnectionContext = () => useConnectionStore(state => state.context);
export const useConnectionStatus = () => useConnectionStore(state => ({
  isConnected: state.isConnected,
  isConnecting: state.isConnecting,
  canRetry: state.canRetry,
}));
export const useConnectionActions = () => useConnectionStore(state => ({
  connect: state.connect,
  disconnect: state.disconnect,
  retry: state.retry,
  cancel: state.cancel,
}));
export const useConnectionNotifications = () => useConnectionStore(state => state.notifications);
export const useConnectionUI = () => useConnectionStore(state => ({
  showRetryButton: state.showRetryButton,
  showCancelButton: state.showCancelButton,
  notifications: state.notifications,
  dismissNotification: state.dismissNotification,
  clearAllNotifications: state.clearAllNotifications,
}));

/**
 * Initialize connection service on first use
 */
export const initializeConnection = () => {
  const service = useConnectionStore.getState().service;
  if (!service) {
    useConnectionStore.getState().initializeService();
  }
  return useConnectionStore.getState().service;
};