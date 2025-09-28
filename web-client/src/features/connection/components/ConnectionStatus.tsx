/**
 * Enhanced connection status indicator component
 * Comprehensive status display with queue information and controls
 * Implements T051: Status indicator component
 */

import React from 'react';
import { useConnection, useConnectionDisplayStatus } from '../hooks/useConnection';
import { ConnectionState } from '../machine/types';

/**
 * Connection status indicator props
 */
export interface ConnectionStatusProps {
  /**
   * Character ID to display connection for
   */
  characterId?: string;
  
  /**
   * Show detailed information
   */
  showDetails?: boolean;
  
  /**
   * Show control buttons
   */
  showControls?: boolean;
  
  /**
   * Compact display mode
   */
  compact?: boolean;
  
  /**
   * Custom CSS classes
   */
  className?: string;
  
  /**
   * Auto-retry on failure
   */
  autoRetry?: boolean;
  
  /**
   * Maximum retry attempts
   */
  maxRetries?: number;
}

/**
 * Status indicator with icon and color
 */
const StatusIndicator: React.FC<{
  state: ConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
}> = ({ state, isConnected, isConnecting }) => {
  const getStatusDisplay = () => {
    if (isConnected) {
      return {
        icon: '🟢',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        text: 'Connected'
      };
    }
    
    if (isConnecting) {
      return {
        icon: '🟡',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        text: 'Connecting'
      };
    }
    
    switch (state) {
      case ConnectionState.DISCONNECTED:
        return {
          icon: '⚪',
          color: 'text-gray-500',
          bgColor: 'bg-gray-50',
          text: 'Disconnected'
        };
      case ConnectionState.REJECTED:
      case ConnectionState.RATE_LIMITED:
        return {
          icon: '🔴',
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          text: 'Error'
        };
      case ConnectionState.DRAIN_MODE:
      case ConnectionState.MAINTENANCE:
        return {
          icon: '🟠',
          color: 'text-orange-600',
          bgColor: 'bg-orange-50',
          text: 'Maintenance'
        };
      default:
        return {
          icon: '⚫',
          color: 'text-gray-400',
          bgColor: 'bg-gray-50',
          text: 'Unknown'
        };
    }
  };

  const { icon, color, bgColor } = getStatusDisplay();

  return (
    <div className={`flex items-center justify-center w-6 h-6 rounded-full ${bgColor}`}>
      <span className={`text-sm ${color}`}>{icon}</span>
    </div>
  );
};

/**
 * Queue information display
 */
const QueueInfo: React.FC<{
  queuePosition: number | null;
  queueDepth: number | null;
  estimatedWaitTime: number | null;
}> = ({ queuePosition, queueDepth, estimatedWaitTime }) => {
  if (queuePosition === null) return null;

  const formatWaitTime = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    return `${hours}h`;
  };

  return (
    <div className="text-sm space-y-1">
      <div className="flex items-center space-x-2">
        <span className="text-gray-500">Position:</span>
        <span className="font-medium">{queuePosition}</span>
        {queueDepth && (
          <span className="text-gray-500">of {queueDepth}</span>
        )}
      </div>
      
      {estimatedWaitTime && (
        <div className="flex items-center space-x-2">
          <span className="text-gray-500">Est. wait:</span>
          <span className="font-medium">{formatWaitTime(estimatedWaitTime)}</span>
        </div>
      )}
      
      {queuePosition && queueDepth && (
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${Math.max(5, ((queueDepth - queuePosition) / queueDepth) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Error display
 */
const ErrorDisplay: React.FC<{ error: any }> = ({ error }) => {
  if (!error) return null;

  return (
    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm">
      <div className="font-medium text-red-800">{error.type || 'Error'}</div>
      <div className="text-red-600">{error.message}</div>
      {error.code && (
        <div className="text-red-500 text-xs mt-1">Code: {error.code}</div>
      )}
    </div>
  );
};

/**
 * Connection controls
 */
const ConnectionControls: React.FC<{
  isConnected: boolean;
  isConnecting: boolean;
  showRetryButton: boolean;
  showCancelButton: boolean;
  characterId?: string;
  onConnect: (characterId: string) => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onCancel: () => void;
}> = ({
  isConnected,
  isConnecting,
  showRetryButton,
  showCancelButton,
  characterId = 'default-character',
  onConnect,
  onDisconnect,
  onRetry,
  onCancel,
}) => {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {!isConnected && !isConnecting && (
        <button
          onClick={() => onConnect(characterId)}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
        >
          Connect
        </button>
      )}

      {isConnected && (
        <button
          onClick={onDisconnect}
          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-colors"
        >
          Disconnect
        </button>
      )}

      {showCancelButton && (
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 transition-colors"
        >
          Cancel
        </button>
      )}

      {showRetryButton && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-1 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
};

/**
 * Main connection status component
 */
export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  characterId = 'default-character',
  showDetails = true,
  showControls = true,
  compact = false,
  className = '',
  autoRetry = false,
  maxRetries = 3,
}) => {
  const connection = useConnection({
    characterId,
    autoRetry,
    maxRetries,
  });

  if (compact) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <StatusIndicator
          state={connection.state}
          isConnected={connection.isConnected}
          isConnecting={connection.isConnecting}
        />
        <span className="text-sm font-medium">{connection.statusText}</span>
      </div>
    );
  }

  return (
    <div className={`bg-white border rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <StatusIndicator
            state={connection.state}
            isConnected={connection.isConnected}
            isConnecting={connection.isConnecting}
          />
          <div>
            <div className="font-medium text-gray-900">{connection.statusText}</div>
            {connection.characterId && (
              <div className="text-sm text-gray-500">Character: {connection.characterId}</div>
            )}
          </div>
        </div>
        
        {/* Connection indicator light */}
        <div className={`w-3 h-3 rounded-full ${
          connection.isConnected ? 'bg-green-400' : 
          connection.isConnecting ? 'bg-yellow-400 animate-pulse' : 
          'bg-gray-300'
        }`} />
      </div>

      {/* Queue information */}
      {connection.state === ConnectionState.QUEUED && (
        <div className="mb-3 p-3 bg-blue-50 rounded border border-blue-200">
          <div className="text-sm font-medium text-blue-900 mb-2">Queue Status</div>
          <QueueInfo
            queuePosition={connection.queuePosition}
            queueDepth={connection.queueDepth}
            estimatedWaitTime={connection.estimatedWaitTime}
          />
        </div>
      )}

      {/* Connection details */}
      {showDetails && (
        <div className="mb-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">State:</span>
              <span className="ml-2 font-mono text-xs bg-gray-100 px-1 rounded">
                {connection.state}
              </span>
            </div>
            
            {connection.retryCount > 0 && (
              <div>
                <span className="text-gray-500">Retries:</span>
                <span className="ml-2 font-medium">{connection.retryCount}/{maxRetries}</span>
              </div>
            )}
            
            {connection.isConnected && (
              <div className="col-span-2">
                <span className="text-gray-500">Connected since:</span>
                <span className="ml-2 font-medium">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error display */}
      <ErrorDisplay error={connection.lastError} />

      {/* Controls */}
      {showControls && (
        <ConnectionControls
          isConnected={connection.isConnected}
          isConnecting={connection.isConnecting}
          showRetryButton={connection.showRetryButton}
          showCancelButton={connection.showCancelButton}
          characterId={characterId}
          onConnect={connection.connect}
          onDisconnect={connection.disconnect}
          onRetry={connection.retry}
          onCancel={connection.cancel}
        />
      )}
    </div>
  );
};

/**
 * Simple status badge for minimal display
 */
export const ConnectionBadge: React.FC<{
  characterId?: string;
  className?: string;
}> = ({ className = '' }) => {
  const { state, statusText, statusColor, isConnected, isConnecting } = useConnectionDisplayStatus();

  const colorClasses = {
    green: 'bg-green-100 text-green-800 border-green-200',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    gray: 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return (
    <span className={`
      inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border
      ${colorClasses[statusColor]} ${className}
    `}>
      <StatusIndicator
        state={state}
        isConnected={isConnected}
        isConnecting={isConnecting}
      />
      <span>{statusText}</span>
    </span>
  );
};

/**
 * Floating status widget for overlay display
 */
export const FloatingConnectionStatus: React.FC<{
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  characterId?: string;
}> = ({ position = 'top-right', characterId }) => {
  const connectionOptions: any = {};
  if (characterId) {
    connectionOptions.characterId = characterId;
  }
  const connection = useConnection(connectionOptions);
  const [isExpanded, setIsExpanded] = React.useState(false);

  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };

  return (
    <div className={`fixed ${positionClasses[position]} z-50`}>
      {isExpanded ? (
        <div className="bg-white shadow-lg rounded-lg border p-3 min-w-64">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Connection Status</span>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ✕
            </button>
          </div>
          <ConnectionStatus
            characterId={characterId || 'default-character'}
            showDetails={false}
            showControls={true}
            compact={true}
            className="border-0 p-0 bg-transparent"
          />
        </div>
      ) : (
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-white shadow-md rounded-full p-2 hover:shadow-lg transition-shadow"
        >
          <StatusIndicator
            state={connection.state}
            isConnected={connection.isConnected}
            isConnecting={connection.isConnecting}
          />
        </button>
      )}
    </div>
  );
};

export default ConnectionStatus;