import type { Room, Client } from "colyseus";
import type {
  DegradedSignalService,
  DependencyHealthState,
  DependencyStatusChange
} from "../services/degradedSignalService.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface DegradedEmitterOptions {
  service: DegradedSignalService;
  room: Pick<Room, "broadcast" | "clients">;
  logger?: LoggerLike;
  now?: () => Date;
}

export class DegradedEmitter {
  private readonly service: DegradedSignalService;
  private readonly room: Pick<Room, "broadcast" | "clients">;
  private readonly logger?: LoggerLike;
  private readonly now: () => Date;
  private unsubscribe?: () => void;

  constructor(options: DegradedEmitterOptions) {
    this.service = options.service;
    this.room = options.room;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.service.subscribe((change) => {
      const event = this.service.toRealtimeEvent(change);
      const logPayload = {
        dependency: change.dependency,
        status: change.status,
        observedAt: change.observedAt.toISOString(),
        message: change.message
      } as const;

      if (change.status === "recovered") {
        this.logger?.info?.("degraded_emitter.change", logPayload);
      } else {
        this.logger?.warn?.("degraded_emitter.change", logPayload);
      }

      this.room.broadcast(event.type, event.payload);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  emitSnapshot(client: Client): void {
    const states = this.service.getAll();

    for (const state of states) {
      const change = this.createSnapshotChange(state);
      if (!change) {
        continue;
      }

      const event = this.service.toRealtimeEvent(change);
      client.send(event.type, event.payload);

      this.logger?.debug?.("degraded_emitter.snapshot", {
        dependency: state.dependency,
        status: state.status,
        observedAt: change.observedAt.toISOString()
      });
    }
  }

  private createSnapshotChange(state: DependencyHealthState): DependencyStatusChange | null {
    if (state.status === "available") {
      return null;
    }

    const observedAt = state.lastObservedAt ?? this.now();
    const previousStatus = state.status === "degraded" ? "available" : "degraded";

    return {
      dependency: state.dependency,
      status: "degraded",
      observedAt,
      message: state.message,
      previousStatus,
      currentStatus: state.status
    } satisfies DependencyStatusChange;
  }
}
