/**
 * Outage Banner Component - TileMUD Web Client
 * 
 * This component displays service status information and outage notifications
 * with retry controls and accessibility features.
 * 
 * Features:
 * - Service status display with visual indicators
 * - Outage notification with retry functionality
 * - Auto-refresh capabilities with user control
 * - Accessible status announcements
 * - Responsive design with mobile optimization
 * - Progressive disclosure of technical details
 */

import { useState, useEffect, useRef } from 'react'
import type { ServiceHealth, ServiceOutage } from '../../../types/domain'
import type { BusinessErrorClass, ServiceErrorClass } from '../../../types/errors'
import './OutageBanner.css'

// Union type for outage banner errors
type OutageError = BusinessErrorClass | ServiceErrorClass | Error

interface OutageBannerProps {
  /** Current service health status */
  serviceHealth: ServiceHealth | null
  
  /** Current service outage information */
  outage: ServiceOutage | null
  
  /** Called to refresh service status */
  onRefresh: () => Promise<void>
  
  /** Whether a refresh operation is in progress */
  isRefreshing?: boolean
  
  /** Error from refresh operations */
  refreshError?: OutageError | null
  
  /** Auto-refresh interval in seconds (0 disables auto-refresh) */
  autoRefreshInterval?: number
  
  /** Called when auto-refresh is toggled */
  onToggleAutoRefresh?: (enabled: boolean) => void
  
  /** Whether auto-refresh is currently enabled */
  isAutoRefreshEnabled?: boolean
  
  /** Additional CSS classes */
  className?: string
}

/**
 * Format time duration for display
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  } else {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }
}

/**
 * Get service status display information
 */
function getServiceStatusInfo(health: ServiceHealth | null) {
  if (!health) {
    return {
      status: 'unknown',
      label: 'Status Unknown',
      description: 'Unable to determine service status',
      className: 'service-status--unknown',
      icon: '❓'
    }
  }
  
  switch (health.status) {
    case 'healthy':
      return {
        status: 'healthy',
        label: 'Service Operational',
        description: 'All systems are functioning normally',
        className: 'service-status--healthy',
        icon: '✅'
      }
    case 'degraded':
      return {
        status: 'degraded',
        label: 'Service Degraded',
        description: 'Some features may be slower than usual',
        className: 'service-status--degraded',
        icon: '⚠️'
      }
    case 'unavailable':
      return {
        status: 'unavailable',
        label: 'Service Unavailable',
        description: 'Service is currently experiencing issues',
        className: 'service-status--unavailable',
        icon: '❌'
      }
    default:
      return {
        status: 'unknown',
        label: 'Status Unknown',
        description: 'Unable to determine service status',
        className: 'service-status--unknown',
        icon: '❓'
      }
  }
}

export function OutageBanner({
  serviceHealth,
  outage,
  onRefresh,
  isRefreshing = false,
  refreshError = null,
  autoRefreshInterval = 30,
  onToggleAutoRefresh,
  isAutoRefreshEnabled = false,
  className = ''
}: OutageBannerProps) {
  // State for expanded technical details
  const [showDetails, setShowDetails] = useState(false)
  
  // State for countdown timer
  const [countdown, setCountdown] = useState(0)
  
  // Auto-refresh timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  
  // Service status information
  const statusInfo = getServiceStatusInfo(serviceHealth)
  
  // Auto-refresh logic
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  
  useEffect(() => {
    // Clear existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    
    // Set up auto-refresh if enabled
    if (isAutoRefreshEnabled && autoRefreshInterval > 0) {
      setCountdown(autoRefreshInterval)
      
      const intervalId = setInterval(() => {
        if (!mountedRef.current) return
        
        setCountdown(prev => {
          if (prev <= 1) {
            // Trigger refresh
            onRefresh().catch(console.error)
            return autoRefreshInterval
          }
          return prev - 1
        })
      }, 1000)
      
      timerRef.current = intervalId
    } else {
      setCountdown(0)
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [isAutoRefreshEnabled, autoRefreshInterval, onRefresh])
  
  /**
   * Handle manual refresh
   */
  const handleRefresh = async () => {
    try {
      await onRefresh()
      // Reset countdown on manual refresh
      if (isAutoRefreshEnabled && autoRefreshInterval > 0) {
        setCountdown(autoRefreshInterval)
      }
    } catch (error) {
      console.error('Failed to refresh service status:', error)
    }
  }
  
  /**
   * Handle auto-refresh toggle
   */
  const handleToggleAutoRefresh = () => {
    const newEnabled = !isAutoRefreshEnabled
    onToggleAutoRefresh?.(newEnabled)
  }
  
  /**
   * Toggle technical details display
   */
  const handleToggleDetails = () => {
    setShowDetails(prev => !prev)
  }
  
  // Don't render anything if service is healthy and no outage
  const shouldShow = statusInfo.status !== 'healthy' || outage || refreshError
  
  if (!shouldShow) {
    return null
  }
  
  return (
    <div className={`outage-banner ${statusInfo.className} ${className}`} role="banner">
      {/* Main Status Display */}
      <div className="outage-banner__main">
        <div className="outage-banner__status">
          <span className="status-icon" aria-hidden="true">
            {statusInfo.icon}
          </span>
          <div className="status-content">
            <h3 className="status-title">{statusInfo.label}</h3>
            <p className="status-description">{statusInfo.description}</p>
            
            {/* Service Health Details */}
            {serviceHealth && (
              <div className="status-details">
                <span className="status-timestamp">
                  Service: {serviceHealth.service}
                </span>
              </div>
            )}
            
            {/* Outage Information */}
            {outage && (
              <div className="outage-info">
                <p className="outage-message">
                  <strong>Notice:</strong> {outage.message}
                </p>
                {outage.retryAfterSeconds && (
                  <p className="outage-retry-info">
                    Please retry after {formatDuration(outage.retryAfterSeconds)}
                  </p>
                )}
              </div>
            )}
            
            {/* Refresh Error */}
            {refreshError && (
              <div className="refresh-error">
                <p>
                  <strong>Refresh failed:</strong> {refreshError.message}
                </p>
              </div>
            )}
          </div>
        </div>
        
        {/* Action Controls */}
        <div className="outage-banner__actions">
          {/* Refresh Button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="action-button action-button--primary"
            aria-describedby="refresh-help"
          >
            {isRefreshing ? (
              <>
                <span className="action-spinner" aria-hidden="true" />
                Checking...
              </>
            ) : (
              'Check Status'
            )}
          </button>
          
          {/* Auto-refresh Toggle */}
          {onToggleAutoRefresh && (
            <button
              type="button"
              onClick={handleToggleAutoRefresh}
              className="action-button action-button--secondary"
              aria-pressed={isAutoRefreshEnabled}
              aria-describedby="auto-refresh-help"
            >
              {isAutoRefreshEnabled ? 'Disable Auto-refresh' : 'Enable Auto-refresh'}
            </button>
          )}
          
          {/* Technical Details Toggle */}
          <button
            type="button"
            onClick={handleToggleDetails}
            className="action-button action-button--link"
            aria-expanded={showDetails}
            aria-controls="technical-details"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
      </div>
      
      {/* Auto-refresh Countdown */}
      {isAutoRefreshEnabled && countdown > 0 && (
        <div className="auto-refresh-status" aria-live="polite" aria-atomic="false">
          <span className="countdown-text">
            Next check in {countdown} second{countdown !== 1 ? 's' : ''}
          </span>
          <div className="countdown-bar">
            <div 
              className="countdown-progress" 
              style={{ 
                width: `${((autoRefreshInterval - countdown) / autoRefreshInterval) * 100}%` 
              }}
            />
          </div>
        </div>
      )}
      
      {/* Technical Details */}
      {showDetails && (
        <div id="technical-details" className="technical-details">
          <h4>Technical Information</h4>
          
          {serviceHealth && (
            <div className="detail-section">
              <h5>Service Health</h5>
              <dl className="detail-list">
                <dt>Service Name:</dt>
                <dd>{serviceHealth.service}</dd>
                <dt>Status:</dt>
                <dd>{serviceHealth.status}</dd>
              </dl>
            </div>
          )}
          
          {outage && (
            <div className="detail-section">
              <h5>Outage Details</h5>
              <dl className="detail-list">
                <dt>Affected Service:</dt>
                <dd>{outage.service}</dd>
                <dt>Message:</dt>
                <dd>{outage.message}</dd>
                {outage.retryAfterSeconds && (
                  <>
                    <dt>Retry After:</dt>
                    <dd>{formatDuration(outage.retryAfterSeconds)}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
      
      {/* Assistive Text */}
      <div className="sr-only">
        <div id="refresh-help">
          Click to manually check the current service status
        </div>
        {onToggleAutoRefresh && (
          <div id="auto-refresh-help">
            {isAutoRefreshEnabled 
              ? `Auto-refresh is enabled. Status will be checked every ${autoRefreshInterval} seconds.`
              : 'Auto-refresh is disabled. Status will only be checked when you click the refresh button.'
            }
          </div>
        )}
      </div>
    </div>
  )
}

export default OutageBanner