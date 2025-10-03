import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "@/features/session/sessionStore";

export interface VersionMismatchBannerProps {
  className?: string;
  onReload?: () => void;
}

const combineClassNames = (base: string, extra?: string) => {
  return extra ? `${base} ${extra}` : base;
};

export const VersionMismatchBanner: React.FC<VersionMismatchBannerProps> = ({ className, onReload }) => {
  const { status, mismatch, clearMismatch } = useSessionStore(
    useShallow((state) => ({
      status: state.status,
      mismatch: state.versionMismatch,
      clearMismatch: state.clearVersionMismatch
    }))
  );

  if (status !== "update_required" || !mismatch) {
    return null;
  }

  const handleReload = () => {
    clearMismatch();
    if (onReload) {
      onReload();
    } else {
      window.location.reload();
    }
  };

  return (
    <div
      className={combineClassNames(
        "version-mismatch-banner",
        className
      )}
      role="alert"
      aria-live="assertive"
      data-testid="version-mismatch-banner"
    >
      <div className="version-mismatch-banner__content">
        <h2 className="version-mismatch-banner__title">Update Required</h2>
        <p className="version-mismatch-banner__message">
          Your client build <strong data-testid="client-version">{mismatch.receivedVersion}</strong> does not
          match the server version <strong data-testid="server-version">{mismatch.expectedVersion}</strong>.
        </p>
        {mismatch.message && (
          <p className="version-mismatch-banner__details" data-testid="version-mismatch-details">
            {mismatch.message}
          </p>
        )}
        <p className="version-mismatch-banner__action">Refresh to download the latest update and continue playing.</p>
      </div>
      <div className="version-mismatch-banner__actions">
        <button
          type="button"
          onClick={handleReload}
          className="version-mismatch-banner__button"
          data-testid="version-mismatch-reload"
        >
          Refresh Now
        </button>
      </div>
    </div>
  );
};

export default VersionMismatchBanner;
