import { TileMudError } from "../models/errorCodes.js";
import { getAppLogger, type AppLogger } from "../logging/logger.js";
import type { DegradedSignalService, DependencyKind } from "./degradedSignalService.js";

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 15_000;

export interface DbOutageGuardOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => Date;
  dependency?: DependencyKind;
  degradedSignalService?: DegradedSignalService;
  logger?: AppLogger;
}

export class DbOutageGuard {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => Date;
  private readonly dependency: DependencyKind;
  private readonly degradedSignalService?: DegradedSignalService;
  private readonly logger: AppLogger;

  private failureCount = 0;
  private unavailableUntil: Date | null = null;

  constructor(options: DbOutageGuardOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
    this.cooldownMs = Math.max(1_000, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
    this.now = options.now ?? (() => new Date());
    this.dependency = options.dependency ?? "postgres";
    this.degradedSignalService = options.degradedSignalService;
    const rootLogger = options.logger ?? getAppLogger();
    this.logger = rootLogger.child?.({ module: "dbOutageGuard" }) ?? rootLogger;
  }

  assertAvailable(): void {
    if (!this.unavailableUntil) {
      return;
    }

    const now = this.now();
    if (now.getTime() >= this.unavailableUntil.getTime()) {
      // Cooldown expired; reset state and mark recovered.
      this.logger.info?.("db.outage_guard.cooldown_expired", {
        dependency: this.dependency,
        retryAt: this.unavailableUntil.toISOString()
      });
      this.unavailableUntil = null;
      this.failureCount = 0;
      this.degradedSignalService?.record({
        dependency: this.dependency,
        healthy: true,
        observedAt: now,
        message: "database outage cooldown expired"
      });
      return;
    }

    this.logger.warn?.("db.outage_guard.blocked", {
      dependency: this.dependency,
      retryAt: this.unavailableUntil.toISOString()
    });

    throw new TileMudError("INTERNAL_ERROR", {
      reason: "database_unavailable",
      dependency: this.dependency,
      retryAt: this.unavailableUntil.toISOString()
    });
  }

  recordSuccess(): void {
    if (this.failureCount > 0 || this.unavailableUntil) {
      const now = this.now();
      this.logger.info?.("db.outage_guard.recovered", {
        dependency: this.dependency,
        failuresBeforeRecovery: this.failureCount
      });
      this.degradedSignalService?.record({
        dependency: this.dependency,
        healthy: true,
        observedAt: now,
        message: "database operation succeeded"
      });
    }

    this.failureCount = 0;
    this.unavailableUntil = null;
  }

  recordFailure(error: unknown): void {
    const now = this.now();
    this.failureCount += 1;

    const message = this.describeError(error);
    this.logger.warn?.("db.outage_guard.failure", {
      dependency: this.dependency,
      failures: this.failureCount,
      message
    });

    this.degradedSignalService?.record({
      dependency: this.dependency,
      healthy: false,
      observedAt: now,
      message
    });

    if (this.failureCount < this.failureThreshold) {
      return;
    }

    const nextAvailableAt = new Date(now.getTime() + this.cooldownMs);
    if (!this.unavailableUntil || nextAvailableAt.getTime() > this.unavailableUntil.getTime()) {
      this.unavailableUntil = nextAvailableAt;
      this.logger.error?.("db.outage_guard.cooldown_engaged", {
        dependency: this.dependency,
        failureThreshold: this.failureThreshold,
        retryAt: this.unavailableUntil.toISOString()
      });
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof TileMudError) {
      return `${error.code}:${error.message}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
