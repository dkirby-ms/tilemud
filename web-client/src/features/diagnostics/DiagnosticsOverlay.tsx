/**
 * Diagnostics Overlay Component - TileMUD Web Client
 * 
 * This component provides a development-focused overlay showing real-time
 * performance metrics including FPS, latency, and loaded chunk information.
 * 
 * Features:
 * - Real-time FPS monitoring with frame time tracking
 * - Network latency estimation via ping requests
 * - Bundle chunk analysis and module loading metrics
 * - Toggle visibility via configuration
 * - Non-intrusive overlay positioning
 * - Performance-optimized rendering
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCharacterStore } from '../character/state/characterStore';
import './DiagnosticsOverlay.css';

interface DiagnosticsOverlayProps {
  /** Whether the overlay is visible */
  isVisible?: boolean;
  
  /** Called when visibility is toggled */
  onToggle?: (visible: boolean) => void;
  
  /** Position of the overlay */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  
  /** Additional CSS classes */
  className?: string;
}

interface FPSCounter {
  fps: number;
  frameTime: number;
  frameCount: number;
  lastTime: number;
}

/**
 * Hook for FPS monitoring
 */
const useFPSMonitor = () => {
  const [fpsData, setFpsData] = useState<FPSCounter>({
    fps: 0,
    frameTime: 0,
    frameCount: 0,
    lastTime: performance.now(),
  });

  const animationId = useRef<number | undefined>(undefined);
  const frameDataRef = useRef<FPSCounter>(fpsData);

  const updateFPS = useCallback(() => {
    const now = performance.now();
    const current = frameDataRef.current;
    
    current.frameCount++;
    const elapsed = now - current.lastTime;
    
    if (elapsed >= 1000) { // Update every second
      const fps = Math.round((current.frameCount * 1000) / elapsed);
      const frameTime = elapsed / current.frameCount;
      
      const newData = {
        fps,
        frameTime: Math.round(frameTime * 100) / 100,
        frameCount: 0,
        lastTime: now,
      };
      
      frameDataRef.current = newData;
      setFpsData(newData);
    }
    
    animationId.current = requestAnimationFrame(updateFPS);
  }, []);

  useEffect(() => {
    animationId.current = requestAnimationFrame(updateFPS);
    return () => {
      if (animationId.current) {
        cancelAnimationFrame(animationId.current);
      }
    };
  }, [updateFPS]);

  return { fps: fpsData.fps, frameTime: fpsData.frameTime };
};

/**
 * Hook for latency monitoring
 */
const useLatencyMonitor = () => {
  const [latency, setLatency] = useState<number>(0);
  const intervalRef = useRef<number | undefined>(undefined);

  const measureLatency = useCallback(async () => {
    const start = performance.now();
    try {
      // Use a lightweight endpoint or create a ping endpoint
      await fetch('/api/service-health/character', { 
        method: 'HEAD',
        cache: 'no-cache'
      });
      const end = performance.now();
      setLatency(Math.round(end - start));
    } catch {
      // If fetch fails, we can't measure latency
      setLatency(-1);
    }
  }, []);

  useEffect(() => {
    // Measure latency every 5 seconds
    measureLatency();
    intervalRef.current = window.setInterval(measureLatency, 5000);
    
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [measureLatency]);

  return latency;
};

/**
 * Hook for memory monitoring
 */
const useMemoryMonitor = () => {
  const [memoryUsage, setMemoryUsage] = useState<number>(0);
  const intervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const updateMemory = () => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        if (memory && memory.usedJSHeapSize) {
          setMemoryUsage(Math.round(memory.usedJSHeapSize / 1024 / 1024)); // MB
        }
      }
    };

    updateMemory();
    intervalRef.current = window.setInterval(updateMemory, 2000);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  return memoryUsage;
};

/**
 * Hook for chunk monitoring
 */
const useChunkMonitor = () => {
  const [loadedChunks, setLoadedChunks] = useState<number>(0);

  useEffect(() => {
    const updateChunkCount = () => {
      // Estimate loaded chunks by counting script tags
      const scriptTags = document.querySelectorAll('script[src*="assets"]');
      setLoadedChunks(scriptTags.length);
    };

    updateChunkCount();
    
    // Update when new scripts are added
    const observer = new MutationObserver(updateChunkCount);
    observer.observe(document.head, { 
      childList: true, 
      subtree: true 
    });

    return () => observer.disconnect();
  }, []);

  return loadedChunks;
};

export const DiagnosticsOverlay: React.FC<DiagnosticsOverlayProps> = ({
  isVisible = false,
  onToggle,
  position = 'top-right',
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { fps, frameTime } = useFPSMonitor();
  const latency = useLatencyMonitor();
  const memoryUsage = useMemoryMonitor();
  const loadedChunks = useChunkMonitor();
  
  const storeState = useCharacterStore((state) => ({
    charactersLoaded: state.player?.characters?.length || 0,
    isLoading: state.playerLoading.isLoading,
    hasError: !!state.playerLoading.error,
  }));

  const handleToggleVisibility = useCallback(() => {
    if (onToggle) {
      onToggle(!isVisible);
    }
  }, [isVisible, onToggle]);

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  const getStatusColor = useCallback((value: number, thresholds: { good: number; warning: number }) => {
    if (value >= thresholds.good) return 'good';
    if (value >= thresholds.warning) return 'warning';
    return 'critical';
  }, []);

  const fpsStatus = getStatusColor(fps, { good: 55, warning: 30 });
  const latencyStatus = latency === -1 ? 'unknown' : getStatusColor(999 - latency, { good: 850, warning: 700 }); // Inverted for latency

  if (!isVisible) {
    return (
      <button
        className={`diagnostics-toggle ${className}`.trim()}
        onClick={handleToggleVisibility}
        title="Show diagnostics overlay"
        aria-label="Show diagnostics overlay"
      >
        📊
      </button>
    );
  }

  return (
    <div className={`diagnostics-overlay diagnostics-overlay--${position} ${className}`.trim()}>
      <div className="diagnostics-overlay__header">
        <button
          className="diagnostics-overlay__expand"
          onClick={handleToggleExpanded}
          title={isExpanded ? 'Collapse diagnostics' : 'Expand diagnostics'}
          aria-label={isExpanded ? 'Collapse diagnostics' : 'Expand diagnostics'}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        <span className="diagnostics-overlay__title">
          {fps}fps
        </span>
        <button
          className="diagnostics-overlay__close"
          onClick={handleToggleVisibility}
          title="Hide diagnostics overlay"
          aria-label="Hide diagnostics overlay"
        >
          ✕
        </button>
      </div>

      {isExpanded && (
        <div className="diagnostics-overlay__content">
          <dl className="diagnostics-overlay__metrics">
            <div className="diagnostics-overlay__metric">
              <dt>FPS:</dt>
              <dd className={`status-${fpsStatus}`}>
                {fps} <span className="unit">({frameTime}ms)</span>
              </dd>
            </div>

            <div className="diagnostics-overlay__metric">
              <dt>Latency:</dt>
              <dd className={`status-${latencyStatus}`}>
                {latency === -1 ? 'N/A' : `${latency}ms`}
              </dd>
            </div>

            <div className="diagnostics-overlay__metric">
              <dt>Memory:</dt>
              <dd>
                {memoryUsage > 0 ? `${memoryUsage}MB` : 'N/A'}
              </dd>
            </div>

            <div className="diagnostics-overlay__metric">
              <dt>Chunks:</dt>
              <dd>{loadedChunks}</dd>
            </div>

            <div className="diagnostics-overlay__metric">
              <dt>Characters:</dt>
              <dd>
                {storeState.charactersLoaded}
                {storeState.isLoading && ' (loading...)'}
                {storeState.hasError && ' (error)'}
              </dd>
            </div>

            <div className="diagnostics-overlay__metric">
              <dt>Build:</dt>
              <dd className="build-info">
                {import.meta.env.MODE}
                {import.meta.env.DEV && ' (dev)'}
              </dd>
            </div>

            <div className="diagnostics-overlay__metric">
              <dt>Time:</dt>
              <dd className="timestamp">
                {new Date().toLocaleTimeString()}
              </dd>
            </div>
          </dl>

          <div className="diagnostics-overlay__legend">
            <span className="legend-item">
              <span className="legend-dot status-good"></span>
              Good
            </span>
            <span className="legend-item">
              <span className="legend-dot status-warning"></span>
              Warning
            </span>
            <span className="legend-item">
              <span className="legend-dot status-critical"></span>
              Critical
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagnosticsOverlay;