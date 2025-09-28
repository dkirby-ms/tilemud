/**
 * ConnectionProvider - React Context Provider for Connection State Management
 * Implements T053: UI integration wiring for connection management
 * 
 * This provider wraps the application and provides connection state and methods
 * to all child components through React Context.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useConnection } from '../features/connection/hooks/useConnection';
import type { UseConnectionOptions } from '../features/connection/hooks/useConnection';
import type { 
  ConnectionState
} from '../features/connection/machine/types';

/**
 * Connection context type
 */
export interface ConnectionContextType {
  // State
  state: ConnectionState;
  queuePosition: number | null;
  queueDepth: number | null;
  estimatedWaitTime: number | null;
  lastError: any;
  characterId: string | null;
  
  // Actions
  connect: (characterId?: string) => void;
  disconnect: () => void;
  retry: () => void;
  cancel: () => void;
  
  // Status helpers
  isConnecting: boolean;
  isConnected: boolean;
  canRetry: boolean;
  showRetryButton: boolean;
  showCancelButton: boolean;
  statusText: string;
  statusColor: 'green' | 'yellow' | 'red' | 'gray';
}

/**
 * Connection context
 */
const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

/**
 * ConnectionProvider props
 */
export interface ConnectionProviderProps {
  children: ReactNode;
  options?: UseConnectionOptions;
  characterId?: string;
}

/**
 * ConnectionProvider component
 * 
 * Provides connection state management to the entire application.
 * Uses the useConnection hook internally to handle state machine logic.
 */
export function ConnectionProvider({ 
  children, 
  options = {},
  characterId
}: ConnectionProviderProps) {
  const connection = useConnection({
    autoConnect: false,
    autoRetry: true,
    persistReconnectionToken: true,
    ...(characterId && { characterId }),
    ...options,
  });

  // Create context value
  const contextValue: ConnectionContextType = {
    // State from hook
    state: connection.state,
    queuePosition: connection.queuePosition,
    queueDepth: connection.queueDepth,
    estimatedWaitTime: connection.estimatedWaitTime,
    lastError: connection.lastError,
    characterId: connection.characterId,
    
    // Actions from hook
    connect: connection.connect,
    disconnect: connection.disconnect,
    retry: connection.retry,
    cancel: connection.cancel,
    
    // Status helpers from hook
    isConnecting: connection.isConnecting,
    isConnected: connection.isConnected,
    canRetry: connection.canRetry,
    showRetryButton: connection.showRetryButton,
    showCancelButton: connection.showCancelButton,
    statusText: connection.statusText,
    statusColor: connection.statusColor,
  };

  return (
    <ConnectionContext.Provider value={contextValue}>
      {children}
    </ConnectionContext.Provider>
  );
}

/**
 * Hook to use connection context
 * 
 * @returns Connection context value
 * @throws Error if used outside ConnectionProvider
 */
export function useConnectionContext(): ConnectionContextType {
  const context = useContext(ConnectionContext);
  
  if (context === undefined) {
    throw new Error('useConnectionContext must be used within a ConnectionProvider');
  }
  
  return context;
}

/**
 * Hook for simple connection status (boolean only)
 */
export function useConnectionStatus() {
  const { isConnected, isConnecting, canRetry } = useConnectionContext();
  return { isConnected, isConnecting, canRetry };
}

/**
 * Hook for connection actions only
 */
export function useConnectionActions() {
  const { connect, disconnect, retry, cancel } = useConnectionContext();
  return { connect, disconnect, retry, cancel };
}

/**
 * Hook for queue information only
 */
export function useConnectionQueue() {
  const { queuePosition, queueDepth, estimatedWaitTime } = useConnectionContext();
  return { queuePosition, queueDepth, estimatedWaitTime };
}

/**
 * Hook for error information only
 */
export function useConnectionError() {
  const { lastError } = useConnectionContext();
  return { error: lastError };
}