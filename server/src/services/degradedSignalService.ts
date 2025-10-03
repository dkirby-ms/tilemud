import type { EventDegraded } from "../contracts/realtimeSchemas.js";

export type DependencyKind = "redis" | "postgres" | "metrics" | "unknown";
export type DependencyStatus = "available" | "degraded" | "unavailable";

export interface DependencyHealthSample {
  dependency: DependencyKind;
  healthy: boolean;
  observedAt?: Date;
  message?: string;
}

export interface DependencyHealthState {
  dependency: DependencyKind;
  status: DependencyStatus;
  lastObservedAt: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  message?: string;
}

export interface DependencyStatusChange {
  dependency: DependencyKind;
  status: "degraded" | "recovered";
  observedAt: Date;
  message?: string;
  previousStatus: DependencyStatus;
  currentStatus: DependencyStatus;
}

export interface DegradedSignalServiceOptions {
  failureThreshold?: number;
  recoveryThreshold?: number;
  unavailableAfterFailures?: number;
  clock?: () => Date;
  dependencies?: DependencyKind[];
}

const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_RECOVERY_THRESHOLD = 2;
const DEFAULT_UNAVAILABLE_FAILURES = 6;

interface DependencyRecord extends DependencyHealthState {}

type StatusListener = (change: DependencyStatusChange) => void;

export class DegradedSignalService {
  private readonly failureThreshold: number;
  private readonly recoveryThreshold: number;
  private readonly unavailableFailures: number;
  private readonly clock: () => Date;
  private readonly state = new Map<DependencyKind, DependencyRecord>();
  private readonly listeners = new Set<StatusListener>();

  constructor(options: DegradedSignalServiceOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
    this.recoveryThreshold = Math.max(1, options.recoveryThreshold ?? DEFAULT_RECOVERY_THRESHOLD);
    this.unavailableFailures = Math.max(
      this.failureThreshold,
      options.unavailableAfterFailures ?? DEFAULT_UNAVAILABLE_FAILURES
    );
    this.clock = options.clock ?? (() => new Date());

    const dependencies = options.dependencies ?? ["redis"];
    for (const dependency of dependencies) {
      this.state.set(dependency, this.createInitialRecord(dependency));
    }
  }

  record(sample: DependencyHealthSample): DependencyHealthState {
    const observedAt = sample.observedAt ?? this.clock();
    const record = this.getOrInitialize(sample.dependency);

    if (sample.healthy) {
      record.consecutiveSuccesses += 1;
      record.consecutiveFailures = 0;
      record.lastObservedAt = observedAt;
      record.message = sample.message;

      const previousStatus = record.status;
      if (previousStatus !== "available" && record.consecutiveSuccesses >= this.recoveryThreshold) {
        record.status = "available";
        this.notifyListeners({
          dependency: record.dependency,
          status: "recovered",
          observedAt,
          message: sample.message,
          previousStatus,
          currentStatus: record.status
        });
      }
    } else {
      record.consecutiveFailures += 1;
      record.consecutiveSuccesses = 0;
      record.lastObservedAt = observedAt;
      record.message = sample.message;

      const previousStatus = record.status;
      if (record.consecutiveFailures >= this.unavailableFailures) {
        if (record.status !== "unavailable") {
          record.status = "unavailable";
          this.notifyListeners({
            dependency: record.dependency,
            status: "degraded",
            observedAt,
            message: sample.message,
            previousStatus,
            currentStatus: record.status
          });
        }
      } else if (previousStatus === "available" && record.consecutiveFailures >= this.failureThreshold) {
        record.status = "degraded";
        this.notifyListeners({
          dependency: record.dependency,
          status: "degraded",
          observedAt,
          message: sample.message,
          previousStatus,
          currentStatus: record.status
        });
      }
    }

    return { ...record } satisfies DependencyHealthState;
  }

  get(dependency: DependencyKind): DependencyHealthState {
    const record = this.getOrInitialize(dependency);
    return { ...record } satisfies DependencyHealthState;
  }

  getAll(): DependencyHealthState[] {
    return Array.from(this.state.values()).map((record) => ({ ...record } satisfies DependencyHealthState));
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  toRealtimeEvent(change: DependencyStatusChange): EventDegraded {
    return {
      type: "event.degraded",
      payload: {
        dependency: change.dependency,
        status: change.status,
        observedAt: change.observedAt.toISOString(),
        message: change.message
      }
    } satisfies EventDegraded;
  }

  reset(dependency: DependencyKind): void {
    this.state.set(dependency, this.createInitialRecord(dependency));
  }

  clear(): void {
    this.state.clear();
  }

  private notifyListeners(change: DependencyStatusChange): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }

  private getOrInitialize(dependency: DependencyKind): DependencyRecord {
    if (!this.state.has(dependency)) {
      this.state.set(dependency, this.createInitialRecord(dependency));
    }

    return this.state.get(dependency)!;
  }

  private createInitialRecord(dependency: DependencyKind): DependencyRecord {
    return {
      dependency,
      status: "available",
      lastObservedAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      message: undefined
    } satisfies DependencyRecord;
  }
}
