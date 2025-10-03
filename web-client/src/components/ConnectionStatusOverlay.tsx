import React from "react";
import { useSessionStore, type SessionDependency } from "@/features/session/sessionStore";

export interface ConnectionStatusOverlayProps {
  className?: string;
}

const combineClassNames = (base: string, extra?: string) => (extra ? `${base} ${extra}` : base);

const statusMessages: Record<string, string> = {
  connecting: "Connecting to the TileMUD server...",
  reconnecting: "Connection interrupted. Attempting to reconnect...",
  degraded: "One or more services are degraded. Gameplay may be slower than usual.",
  unavailable: "The server is currently unavailable.",
  terminated: "Your session has ended. Please reconnect to continue."
};

const dependencyLabels: Record<SessionDependency, string> = {
  redis: "Cache",
  postgres: "Database",
  metrics: "Metrics",
  unknown: "Dependency"
};

const formatDelay = (ms: number): string => `${Math.round(ms / 1000)}s`;

export const ConnectionStatusOverlay: React.FC<ConnectionStatusOverlayProps> = ({ className }) => {
  const state = useSessionStore((store) => ({
    status: store.status,
    reconnect: store.reconnect,
    degraded: store.degradedDependencies,
    lastError: store.lastError,
    latency: store.latency
  }));

  if (
    state.status === "idle" ||
    state.status === "active" ||
    state.status === "update_required"
  ) {
    return null;
  }

  const message = statusMessages[state.status] ?? "Connection status unknown.";
  const dependencyEntries = Object.entries(state.degraded ?? {});
  const hasDegraded = dependencyEntries.length > 0;
  const nextDelayMs = state.status === "reconnecting"
    ? (
        state.reconnect.scheduleMs[
          Math.min(
            Math.max(state.reconnect.attempts, 1) - 1,
            Math.max(state.reconnect.scheduleMs.length - 1, 0)
          )
        ] ?? state.reconnect.scheduleMs[0] ?? 1000
      )
    : null;

  return (
    <div
      className={combineClassNames("connection-status-overlay", className)}
      role="status"
      aria-live="assertive"
      data-testid="connection-status-overlay"
    >
      <div className="connection-status-overlay__content">
        <h2 className="connection-status-overlay__title">Connection Status</h2>
        <p className="connection-status-overlay__message" data-testid="connection-status-message">
          {message}
        </p>

        {state.status === "reconnecting" && (
          <div className="connection-status-overlay__reconnect" data-testid="connection-status-reconnect">
            <p>
              Attempt {state.reconnect.attempts} of {state.reconnect.maxAttempts}
            </p>
            {nextDelayMs !== null && (
              <p className="connection-status-overlay__delay">
                Next attempt in {formatDelay(nextDelayMs)}
              </p>
            )}
          </div>
        )}

        {hasDegraded && (
          <div className="connection-status-overlay__degraded" data-testid="connection-status-degraded">
            <h3>Degraded Services</h3>
            <ul>
              {dependencyEntries.map(([dependency, details]) => (
                <li key={dependency}>
                  <strong>{dependencyLabels[dependency as SessionDependency]}</strong>
                  {details?.message ? ` – ${details.message}` : " – operating in degraded mode"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.lastError && state.status === "unavailable" && (
          <p className="connection-status-overlay__error" data-testid="connection-status-error">
            {state.lastError}
          </p>
        )}

        {state.latency.lastMs !== null && (
          <p className="connection-status-overlay__latency" data-testid="connection-status-latency">
            Last acknowledged latency: {Math.round(state.latency.lastMs)}ms (p95 {state.latency.p95Ms ?? "n/a"}ms)
          </p>
        )}
      </div>
    </div>
  );
};

export default ConnectionStatusOverlay;
