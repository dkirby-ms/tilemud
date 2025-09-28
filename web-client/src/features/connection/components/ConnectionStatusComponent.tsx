/**
 * Connection status component
 * Shows current connection state and provides controls
 */

import React from 'react';
import { 
  useConnectionState, 
  useConnectionContext, 
  useConnectionStatus, 
  useConnectionActions,
  useConnectionUI,
} from '../connectionStore';
import { ConnectionState } from '../machine/types';

/**
 * Connection status indicator
 */
const ConnectionStatusIndicator: React.FC = () => {
  const state = useConnectionState();
  const context = useConnectionContext();
  const { isConnected, isConnecting } = useConnectionStatus();

  const getStatusText = () => {
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
        return 'Reconnecting...';
      default:
        return 'Unknown status';
    }
  };

  const getStatusColor = () => {
    if (isConnected) return 'text-green-600';
    if (isConnecting) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusIcon = () => {
    if (isConnected) return '🟢';
    if (isConnecting) return '🟡';
    return '🔴';
  };

  return (
    <div className={`flex items-center space-x-2 ${getStatusColor()}`}>
      <span className="text-lg">{getStatusIcon()}</span>
      <span className="font-medium">{getStatusText()}</span>
    </div>
  );
};

/**
 * Connection controls
 */
const ConnectionControls: React.FC<{ characterId?: string }> = ({ characterId = 'test-character' }) => {
  const { isConnected, isConnecting } = useConnectionStatus();
  const { connect, disconnect, retry, cancel } = useConnectionActions();
  const { showRetryButton, showCancelButton } = useConnectionUI();

  return (
    <div className="flex space-x-2">
      {!isConnected && !isConnecting && (
        <button
          onClick={() => connect(characterId)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={isConnecting}
        >
          Connect
        </button>
      )}

      {isConnected && (
        <button
          onClick={disconnect}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Disconnect
        </button>
      )}

      {showCancelButton && (
        <button
          onClick={cancel}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Cancel
        </button>
      )}

      {showRetryButton && (
        <button
          onClick={retry}
          className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
        >
          Retry
        </button>
      )}
    </div>
  );
};

/**
 * Connection details
 */
const ConnectionDetails: React.FC = () => {
  const context = useConnectionContext();
  const state = useConnectionState();

  if (state === ConnectionState.DISCONNECTED) {
    return null;
  }

  return (
    <div className="mt-4 p-4 bg-gray-100 rounded text-sm">
      <h4 className="font-semibold mb-2">Connection Details</h4>
      <div className="space-y-1">
        <div>Character ID: {context.characterId || 'N/A'}</div>
        <div>Instance ID: {context.instanceId || 'N/A'}</div>
        {context.queuePosition && (
          <>
            <div>Queue Position: {context.queuePosition}</div>
            <div>Queue Depth: {context.queueDepth}</div>
            {context.estimatedWaitTime && (
              <div>Estimated Wait: {Math.round(context.estimatedWaitTime / 1000)}s</div>
            )}
          </>
        )}
        {context.connectedAt && (
          <div>Connected At: {context.connectedAt.toLocaleTimeString()}</div>
        )}
        {context.lastError && (
          <div className="text-red-600">
            Last Error: {context.lastError.message}
          </div>
        )}
        {context.retryCount > 0 && (
          <div>Retry Count: {context.retryCount}</div>
        )}
        {context.graceExpiresAt && (
          <div>Grace Expires: {context.graceExpiresAt.toLocaleTimeString()}</div>
        )}
        {context.maintenanceInfo && (
          <div className="text-yellow-600">
            Maintenance: {context.maintenanceInfo.type}
            {context.maintenanceInfo.reason && ` - ${context.maintenanceInfo.reason}`}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Connection notifications
 */
const ConnectionNotifications: React.FC = () => {
  const { notifications, dismissNotification, clearAllNotifications } = useConnectionUI();

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex justify-between items-center">
        <h4 className="font-semibold">Notifications</h4>
        {notifications.length > 1 && (
          <button
            onClick={clearAllNotifications}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Clear All
          </button>
        )}
      </div>
      
      {notifications.map(notification => {
        const bgColor = {
          info: 'bg-blue-100 border-blue-300 text-blue-800',
          success: 'bg-green-100 border-green-300 text-green-800',
          warning: 'bg-yellow-100 border-yellow-300 text-yellow-800',
          error: 'bg-red-100 border-red-300 text-red-800',
        }[notification.type];

        return (
          <div
            key={notification.id}
            className={`p-3 border rounded ${bgColor} flex justify-between items-start`}
          >
            <div className="flex-1">
              <div className="text-sm font-medium">
                {notification.type.toUpperCase()}
              </div>
              <div className="text-sm">{notification.message}</div>
              <div className="text-xs mt-1 opacity-75">
                {notification.timestamp.toLocaleTimeString()}
              </div>
            </div>
            <button
              onClick={() => dismissNotification(notification.id)}
              className="ml-2 text-lg leading-none hover:opacity-75"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Main connection status component
 */
export const ConnectionStatusComponent: React.FC<{ 
  characterId?: string;
  showDetails?: boolean;
}> = ({ 
  characterId = 'test-character',
  showDetails = true 
}) => {
  return (
    <div className="p-6 border rounded-lg bg-white">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Connection Status</h3>
        <ConnectionStatusIndicator />
      </div>
      
      <ConnectionControls characterId={characterId} />
      <ConnectionNotifications />
      
      {showDetails && <ConnectionDetails />}
    </div>
  );
};

export default ConnectionStatusComponent;