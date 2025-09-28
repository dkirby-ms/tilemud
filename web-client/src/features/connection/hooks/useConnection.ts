/**
 * useConnection hook - orchestrates connection state, timers, and queue polling
 * Implements T049: Hook for connection orchestration with timers, queue polling, reconnection tokens
 */

import { useEffect, useCallback, useRef } from 'react';
import {
  useConnectionStore,
  useConnectionState,
  useConnectionContext,
  useConnectionStatus,
  useConnectionActions,
  initializeConnection,
} from '../connectionStore';
import { ConnectionState } from '../machine/types';

/**
 * Connection hook options
 */
export interface UseConnectionOptions {
  /**
   * Character ID to connect with
   */
  characterId?: string;
  
  /**
   * Auto-connect on mount
   */
  autoConnect?: boolean;
  
  /**
   * Auto-retry on failure
   */
  autoRetry?: boolean;
  
  /**
   * Maximum auto-retry attempts
   */
  maxRetries?: number;
  
  /**
   * Custom queue poll interval (ms)
   */
  queuePollInterval?: number;
  
  /**
   * Persist reconnection token in sessionStorage
   */
  persistReconnectionToken?: boolean;
  
  /**
   * Callback when connection state changes
   */
  onStateChange?: (state: ConnectionState) => void;
  
  /**
   * Callback when connected
   */
  onConnected?: () => void;
  
  /**
   * Callback when disconnected
   */
  onDisconnected?: () => void;
  
  /**
   * Callback when connection fails
   */
  onError?: (error: any) => void;
  
  /**
   * Callback when queued
   */
  onQueued?: (position: number, depth: number, estimatedWaitTime?: number) => void;
}

/**
 * Connection hook return value
 */
export interface UseConnectionReturn {
  // State
  state: ConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
  canRetry: boolean;
  
  // Context data
  characterId: string | null;
  queuePosition: number | null;
  queueDepth: number | null;
  estimatedWaitTime: number | null;
  lastError: any;
  retryCount: number;
  
  // Actions
  connect: (characterId?: string) => void;
  disconnect: () => void;
  retry: () => void;
  cancel: () => void;
  
  // UI helpers
  showRetryButton: boolean;
  showCancelButton: boolean;
  statusText: string;
  statusColor: 'green' | 'yellow' | 'red' | 'gray';
  
  // Advanced
  service: any;
}

/**
 * Main connection hook
 */
export function useConnection(options: UseConnectionOptions = {}): UseConnectionReturn {
  const {
    characterId: defaultCharacterId,
    autoConnect = false,
    autoRetry = false,
    maxRetries = 3,
    persistReconnectionToken = true,
    onStateChange,
    onConnected,
    onDisconnected,
    onError,
    onQueued,
  } = options;

  // Store selectors
  const store = useConnectionStore();
  const state = useConnectionState();
  const context = useConnectionContext();
  const { isConnected, isConnecting, canRetry } = useConnectionStatus();
  const { connect, disconnect, retry, cancel } = useConnectionActions();

  // Refs for stable callbacks
  const optionsRef = useRef(options);
  const autoRetryCountRef = useRef(0);
  
  // Update options ref
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Initialize service on mount
  useEffect(() => {
    initializeConnection();
    
    // Load persisted reconnection token if enabled
    if (persistReconnectionToken) {
      const savedToken = sessionStorage.getItem('tilemud-reconnection-token');
      if (savedToken && context.reconnectionToken !== savedToken) {
        // TODO: Set reconnection token in context
        console.log('Loaded reconnection token from storage:', savedToken);
      }
    }
    
    return () => {
      // Cleanup on unmount
      store.destroy();
    };
  }, [store, context.reconnectionToken, persistReconnectionToken]);

  // Handle state changes
  useEffect(() => {
    if (onStateChange) {
      onStateChange(state);
    }
    
    // Handle specific state callbacks
    if (state === ConnectionState.CONNECTED && onConnected) {
      onConnected();
    }
    
    if (state === ConnectionState.DISCONNECTED && onDisconnected) {
      onDisconnected();
    }
    
    if (state === ConnectionState.QUEUED && onQueued) {
      onQueued(
        context.queuePosition || 0,
        context.queueDepth || 0,
        context.estimatedWaitTime || undefined
      );
    }
    
    if (context.lastError && onError) {
      onError(context.lastError);
    }
    
    // Persist reconnection token
    if (persistReconnectionToken && context.reconnectionToken) {
      sessionStorage.setItem('tilemud-reconnection-token', context.reconnectionToken);
    }
    
    // Auto-retry logic
    if (autoRetry && 
        !isConnected && 
        !isConnecting && 
        canRetry && 
        autoRetryCountRef.current < maxRetries &&
        context.lastError?.retryable !== false) {
      
      const delay = Math.min(1000 * Math.pow(2, autoRetryCountRef.current), 30000);
      console.log(`Auto-retry in ${delay}ms (attempt ${autoRetryCountRef.current + 1}/${maxRetries})`);
      
      const timer = setTimeout(() => {
        autoRetryCountRef.current += 1;
        retry();
      }, delay);
      
      return () => clearTimeout(timer);
    }
    
    // Reset auto-retry counter on successful connection
    if (isConnected) {
      autoRetryCountRef.current = 0;
    }
    
    // Return cleanup function or undefined
    return undefined;
  }, [
    state,
    context,
    isConnected,
    isConnecting,
    canRetry,
    autoRetry,
    maxRetries,
    retry,
    persistReconnectionToken,
    onStateChange,
    onConnected,
    onDisconnected,
    onError,
    onQueued,
  ]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && defaultCharacterId && !isConnected && !isConnecting) {
      connect(defaultCharacterId);
    }
  }, [autoConnect, defaultCharacterId, isConnected, isConnecting, connect]);

  // Enhanced connect function
  const enhancedConnect = useCallback((characterId?: string) => {
    const targetCharacterId = characterId || defaultCharacterId;
    if (!targetCharacterId) {
      console.error('Character ID is required for connection');
      return;
    }
    
    autoRetryCountRef.current = 0; // Reset retry counter
    connect(targetCharacterId);
  }, [defaultCharacterId, connect]);

  // Status helpers
  const getStatusText = useCallback(() => {
    switch (state) {
      case ConnectionState.DISCONNECTED:
        return 'Disconnected';
      case ConnectionState.CONNECTING:
        return 'Connecting...';
      case ConnectionState.AUTHENTICATING:
        return 'Authenticating...';
      case ConnectionState.REQUESTING_ADMISSION:
        return 'Requesting admission...';
      case ConnectionState.QUEUED:
        return `Queued (position ${context.queuePosition || '?'})`;
      case ConnectionState.CONNECTED:
        return 'Connected';
      case ConnectionState.REJECTED:
        return 'Connection rejected';
      case ConnectionState.RATE_LIMITED:
        return 'Rate limited';
      case ConnectionState.DRAIN_MODE:
        return 'Server in maintenance mode';
      case ConnectionState.MAINTENANCE:
        return 'Server under maintenance';
      case ConnectionState.GRACE_PERIOD:
        return 'Reconnection window active';
      case ConnectionState.RECONNECTING:
        return `Reconnecting... (${context.retryCount}/${maxRetries})`;
      default:
        return 'Unknown status';
    }
  }, [state, context, maxRetries]);

  const getStatusColor = useCallback((): 'green' | 'yellow' | 'red' | 'gray' => {
    if (isConnected) return 'green';
    if (isConnecting) return 'yellow';
    if (state === ConnectionState.DISCONNECTED) return 'gray';
    return 'red';
  }, [isConnected, isConnecting, state]);

  return {
    // State
    state,
    isConnected,
    isConnecting,
    canRetry,
    
    // Context data
    characterId: context.characterId,
    queuePosition: context.queuePosition,
    queueDepth: context.queueDepth,
    estimatedWaitTime: context.estimatedWaitTime,
    lastError: context.lastError,
    retryCount: context.retryCount,
    
    // Actions
    connect: enhancedConnect,
    disconnect,
    retry,
    cancel,
    
    // UI helpers
    showRetryButton: store.showRetryButton,
    showCancelButton: store.showCancelButton,
    statusText: getStatusText(),
    statusColor: getStatusColor(),
    
    // Advanced
    service: store.service,
  };
}

/**
 * Simple connection hook for basic usage
 */
export function useSimpleConnection(characterId?: string) {
  const options: UseConnectionOptions = {
    autoConnect: false,
    autoRetry: true,
    maxRetries: 3,
    persistReconnectionToken: true,
  };
  
  if (characterId) {
    options.characterId = characterId;
  }
  
  return useConnection(options);
}

/**
 * Auto-connecting hook for immediate connection
 */
export function useAutoConnection(characterId: string) {
  return useConnection({
    characterId,
    autoConnect: true,
    autoRetry: true,
    maxRetries: 5,
    persistReconnectionToken: true,
  });
}

/**
 * Queue-focused hook for monitoring queue status
 */
export function useConnectionQueue() {
  const connection = useConnection();
  
  return {
    isQueued: connection.state === ConnectionState.QUEUED,
    queuePosition: connection.queuePosition,
    queueDepth: connection.queueDepth,
    estimatedWaitTime: connection.estimatedWaitTime,
    connect: connection.connect,
    cancel: connection.cancel,
  };
}

/**
 * Status-only hook for display components
 */
export function useConnectionDisplayStatus() {
  const connection = useConnection();
  
  return {
    state: connection.state,
    statusText: connection.statusText,
    statusColor: connection.statusColor,
    isConnected: connection.isConnected,
    isConnecting: connection.isConnecting,
    lastError: connection.lastError,
    showRetryButton: connection.showRetryButton,
    showCancelButton: connection.showCancelButton,
  };
}