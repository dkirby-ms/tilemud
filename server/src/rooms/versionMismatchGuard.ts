import type { EventVersionMismatch } from "../contracts/realtimeSchemas.js";
import type { MetricsService } from "../services/metricsService.js";
import type { VersionCompatibilityResult, VersionService } from "../services/versionService.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface VersionMismatchContext {
  sessionId?: string;
  userId?: string;
  clientId?: string;
  transport?: string;
}

export interface VersionMismatchNotification extends VersionMismatchContext {
  compatibility: VersionCompatibilityResult;
  observedAt: string;
}

export interface VersionMismatchGuardOptions {
  versionService: VersionService;
  metrics?: MetricsService;
  logger?: LoggerLike;
  now?: () => Date;
  disconnectGraceMs?: number;
}

export interface VersionMismatchGuardResult {
  compatible: boolean;
  compatibility: VersionCompatibilityResult;
  eventPayload?: EventVersionMismatch["payload"];
  disconnectCode?: number;
  disconnectReason?: string;
  disconnectAt?: Date;
}

type VersionMismatchListener = (notification: VersionMismatchNotification) => void;

const DEFAULT_DISCONNECT_GRACE_MS = 1_500;

export class VersionMismatchGuard {
  private readonly versionService: VersionService;
  private readonly metrics?: MetricsService;
  private readonly logger?: LoggerLike;
  private readonly now: () => Date;
  private readonly disconnectGraceMs: number;
  private readonly listeners = new Set<VersionMismatchListener>();

  constructor(options: VersionMismatchGuardOptions) {
    this.versionService = options.versionService;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.disconnectGraceMs = Math.max(0, options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS);
  }

  check(clientVersion: string | null | undefined, context: VersionMismatchContext = {}): VersionMismatchGuardResult {
    const compatibility = this.versionService.checkCompatibility(clientVersion);

    if (compatibility.isCompatible) {
      return {
        compatible: true,
        compatibility
      } satisfies VersionMismatchGuardResult;
    }

    this.metrics?.recordVersionReject();

    const observedAt = this.now();
    const disconnectAt = new Date(observedAt.getTime() + this.disconnectGraceMs);
    const eventPayload = this.createEventPayload(compatibility, disconnectAt);

    this.logger?.warn?.("version_guard.mismatch", {
      sessionId: context.sessionId,
      userId: context.userId,
      clientId: context.clientId,
      transport: context.transport,
      expectedVersion: compatibility.expectedVersion,
      receivedVersion: compatibility.receivedVersion,
      reason: compatibility.reason,
      observedAt: observedAt.toISOString()
    });

    this.notifyListeners({
      ...context,
      compatibility,
      observedAt: observedAt.toISOString()
    });

    return {
      compatible: false,
      compatibility,
      eventPayload,
      disconnectCode: 4_408,
      disconnectReason: "version_mismatch",
      disconnectAt
    } satisfies VersionMismatchGuardResult;
  }

  subscribe(listener: VersionMismatchListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(notification: VersionMismatchNotification): void {
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch (error) {
        this.logger?.error?.("version_guard.listener_error", error);
      }
    }
  }

  private createEventPayload(
    compatibility: VersionCompatibilityResult,
    disconnectAt: Date
  ): EventVersionMismatch["payload"] {
    return {
      expectedVersion: compatibility.expectedVersion,
      receivedVersion: compatibility.receivedVersion ?? "unknown",
      message: compatibility.message,
      disconnectAt: disconnectAt.toISOString()
    } satisfies EventVersionMismatch["payload"];
  }
}
