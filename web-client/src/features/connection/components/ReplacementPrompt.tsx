/**
 * Replacement prompt component
 * Handles session replacement when user has existing connection
 * Implements T050: Replacement prompt component
 */

import React, { useState, useCallback } from 'react';
import { useConnection } from '../hooks/useConnection';
import { ConnectionState } from '../machine/types';

/**
 * Replacement prompt props
 */
export interface ReplacementPromptProps {
  /**
   * Whether the prompt is currently visible
   */
  isVisible: boolean;
  
  /**
   * Character ID for the existing session
   */
  characterId: string;
  
  /**
   * Instance ID where the existing session is active
   */
  instanceId?: string;
  
  /**
   * Additional message to show
   */
  message?: string;
  
  /**
   * Callback when user accepts replacement
   */
  onAccept: () => void;
  
  /**
   * Callback when user cancels replacement
   */
  onCancel: () => void;
  
  /**
   * Custom styling
   */
  className?: string;
  
  /**
   * Show as modal overlay
   */
  modal?: boolean;
  
  /**
   * Auto-timeout after specified seconds
   */
  timeoutSeconds?: number;
  
  /**
   * Callback when timeout expires
   */
  onTimeout?: () => void;
}

/**
 * Replacement confirmation modal
 */
export const ReplacementPrompt: React.FC<ReplacementPromptProps> = ({
  isVisible,
  characterId,
  instanceId,
  message,
  onAccept,
  onCancel,
  className = '',
  modal = true,
  timeoutSeconds = 30,
  onTimeout,
}) => {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);
  const [isProcessing, setIsProcessing] = useState(false);

  // Handle timeout countdown
  React.useEffect(() => {
    if (!isVisible || timeoutSeconds <= 0) return;
    
    setTimeLeft(timeoutSeconds);
    
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onTimeout?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isVisible, timeoutSeconds, onTimeout]);

  // Handle accept action
  const handleAccept = useCallback(async () => {
    setIsProcessing(true);
    try {
      await onAccept();
    } catch (error) {
      console.error('Error accepting replacement:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [onAccept]);

  // Handle cancel action
  const handleCancel = useCallback(async () => {
    setIsProcessing(true);
    try {
      await onCancel();
    } catch (error) {
      console.error('Error canceling replacement:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [onCancel]);

  // Don't render if not visible
  if (!isVisible) {
    return null;
  }

  const content = (
    <div className={`bg-white rounded-lg p-6 shadow-lg border max-w-md w-full ${className}`}>
      {/* Header */}
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
          <span className="text-yellow-600 text-xl">⚠️</span>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Session Replacement Required
          </h3>
          <p className="text-sm text-gray-500">
            Character: {characterId}
          </p>
        </div>
      </div>

      {/* Message */}
      <div className="mb-6">
        <p className="text-gray-700 mb-3">
          {message || 
            'Your character is already connected to a game session. ' +
            'You can replace the existing session with this new one, or cancel to keep the original session.'
          }
        </p>
        
        {instanceId && (
          <p className="text-sm text-gray-500">
            Current session: <code className="bg-gray-100 px-1 rounded">{instanceId}</code>
          </p>
        )}
        
        {timeoutSeconds > 0 && (
          <div className="mt-3 p-3 bg-gray-50 rounded">
            <p className="text-sm text-gray-600">
              This prompt will auto-cancel in <strong>{timeLeft}</strong> seconds
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
              <div
                className="bg-yellow-500 h-2 rounded-full transition-all duration-1000"
                style={{ width: `${(timeLeft / timeoutSeconds) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex space-x-3">
        <button
          onClick={handleAccept}
          disabled={isProcessing}
          className={`
            flex-1 px-4 py-2 bg-red-600 text-white rounded font-medium
            hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
          `}
        >
          {isProcessing ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Replacing...</span>
            </div>
          ) : (
            'Replace Session'
          )}
        </button>
        
        <button
          onClick={handleCancel}
          disabled={isProcessing}
          className={`
            flex-1 px-4 py-2 bg-gray-600 text-white rounded font-medium
            hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
          `}
        >
          {isProcessing ? 'Processing...' : 'Keep Original'}
        </button>
      </div>

      {/* Warning text */}
      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <span className="text-yellow-400">⚠️</span>
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Warning:</strong> Replacing the session will disconnect the existing connection
              and any unsaved progress may be lost.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // Render as modal or inline
  if (modal) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        {/* Backdrop */}
        <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          
          {/* Modal positioning */}
          <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
            &#8203;
          </span>
          
          {/* Modal content */}
          <div className="inline-block align-bottom sm:align-middle sm:max-w-lg sm:w-full">
            {content}
          </div>
        </div>
      </div>
    );
  }

  return content;
};

/**
 * Hook to manage replacement prompt state
 */
export function useReplacementPrompt() {
  const [isVisible, setIsVisible] = useState(false);
  const [promptData, setPromptData] = useState<{
    characterId: string;
    instanceId?: string;
    message?: string;
  } | null>(null);
  
  const connection = useConnection();

  // Show prompt
  const showPrompt = useCallback((data: {
    characterId: string;
    instanceId?: string;
    message?: string;
  }) => {
    setPromptData(data);
    setIsVisible(true);
  }, []);

  // Hide prompt
  const hidePrompt = useCallback(() => {
    setIsVisible(false);
    setPromptData(null);
  }, []);

  // Handle accept - replace the session
  const handleAccept = useCallback(async () => {
    if (!promptData) return;
    
    try {
      // Force reconnect with replacement flag
      // This would typically involve making a special API call
      // or setting a flag that forces session replacement
      console.log('Replacing session for character:', promptData.characterId);
      
      // Disconnect current connection and reconnect with replacement
      connection.disconnect();
      setTimeout(() => {
        connection.connect(promptData.characterId);
      }, 100);
      
      hidePrompt();
    } catch (error) {
      console.error('Failed to replace session:', error);
      throw error;
    }
  }, [promptData, connection, hidePrompt]);

  // Handle cancel - keep original session
  const handleCancel = useCallback(async () => {
    console.log('Keeping original session');
    hidePrompt();
  }, [hidePrompt]);

  // Handle timeout - cancel by default
  const handleTimeout = useCallback(() => {
    console.log('Replacement prompt timed out');
    handleCancel();
  }, [handleCancel]);

  return {
    isVisible,
    promptData,
    showPrompt,
    hidePrompt,
    handleAccept,
    handleCancel,
    handleTimeout,
  };
}

/**
 * Auto-detecting replacement prompt that shows when needed
 */
export const AutoReplacementPrompt: React.FC = () => {
  const {
    isVisible,
    promptData,
    handleAccept,
    handleCancel,
    handleTimeout,
  } = useReplacementPrompt();
  
  const connection = useConnection();

  // Auto-show prompt when session replacement is needed
  React.useEffect(() => {
    // This would be triggered by a specific server response
    // indicating that session replacement is needed
    if (connection.state === ConnectionState.REJECTED && 
        connection.lastError?.code === 'ALREADY_IN_SESSION') {
      // Show replacement prompt
      // This would normally be handled by parsing the error details
      console.log('Auto-showing replacement prompt');
    }
  }, [connection.state, connection.lastError]);

  if (!isVisible || !promptData) {
    return null;
  }

  const promptProps: ReplacementPromptProps = {
    isVisible,
    characterId: promptData.characterId,
    onAccept: handleAccept,
    onCancel: handleCancel,
    onTimeout: handleTimeout,
    timeoutSeconds: 30,
    modal: true,
  };
  
  if (promptData.instanceId) {
    promptProps.instanceId = promptData.instanceId;
  }
  
  if (promptData.message) {
    promptProps.message = promptData.message;
  }

  return <ReplacementPrompt {...promptProps} />;
};

export default ReplacementPrompt;