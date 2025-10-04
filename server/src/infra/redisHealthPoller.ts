import type { RedisClientType } from "redis";
import type { DegradedSignalService, DependencyKind } from "../services/degradedSignalService.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface RedisHealthPollerOptions {
  redis: Pick<RedisClientType, "ping"> & { isOpen?: boolean };
  degradedSignalService: DegradedSignalService;
  dependency?: DependencyKind;
  intervalMs?: number;
  timeoutMs?: number;
  logger?: LoggerLike;
  now?: () => Date;
  healthCheck?: () => Promise<unknown>;
}

interface HealthCheckResult {
  healthy: boolean;
  message?: string;
}

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 3_000;

export class RedisHealthPoller {
  private readonly redis: Pick<RedisClientType, "ping"> & { isOpen?: boolean };
  private readonly degradedSignalService: DegradedSignalService;
  private readonly dependency: DependencyKind;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly logger?: LoggerLike;
  private readonly now: () => Date;
  private readonly healthCheck?: () => Promise<unknown>;
  private timer: NodeJS.Timeout | null = null;
  private checkInFlight = false;

  constructor(options: RedisHealthPollerOptions) {
    if (!options?.redis) {
      throw new Error("Redis client is required for RedisHealthPoller");
    }

    if (!options?.degradedSignalService) {
      throw new Error("DegradedSignalService instance is required for RedisHealthPoller");
    }

    this.redis = options.redis;
    this.degradedSignalService = options.degradedSignalService;
    this.dependency = options.dependency ?? "redis";
    this.intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timeoutMs = Math.max(250, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.healthCheck = options.healthCheck;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref?.();

    void this.runOnce();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<boolean> {
    if (this.checkInFlight) {
      return false;
    }

    this.checkInFlight = true;
    try {
      const result = await this.performHealthCheck();
      this.recordResult(result);
      return result.healthy;
    } finally {
      this.checkInFlight = false;
    }
  }

  private async performHealthCheck(): Promise<HealthCheckResult> {
    if (this.redis.isOpen === false) {
      return {
        healthy: false,
        message: "Redis client is not connected"
      } satisfies HealthCheckResult;
    }

    try {
      const pingTask = this.healthCheck ? this.healthCheck() : this.redis.ping();
      await withTimeout(pingTask, this.timeoutMs);
      return {
        healthy: true,
        message: "Redis ping succeeded"
      } satisfies HealthCheckResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Redis ping failed");
      this.logger?.warn?.("redis.health_check.failed", { message });
      return {
        healthy: false,
        message
      } satisfies HealthCheckResult;
    }
  }

  private recordResult(result: HealthCheckResult): void {
    this.degradedSignalService.record({
      dependency: this.dependency,
      healthy: result.healthy,
      observedAt: this.now(),
      message: result.message
    });
  }
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Redis health check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
