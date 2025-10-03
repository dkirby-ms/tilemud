import type { PlayerSessionState, PlayerSessionStore } from "../models/playerSession.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface InactivityTimeoutServiceOptions {
  sessions: PlayerSessionStore;
  timeoutMs?: number;
  sweepIntervalMs?: number;
  now?: () => Date;
  logger?: LoggerLike;
}

export interface InactivityTimeoutEvent {
  session: PlayerSessionState;
  idleMs: number;
  thresholdMs: number;
  timedOutAt: Date;
}

type TimeoutListener = (event: InactivityTimeoutEvent) => void | Promise<void>;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

export class InactivityTimeoutService {
  private readonly sessions: PlayerSessionStore;
  private readonly timeoutMs: number;
  private readonly sweepIntervalMs: number;
  private readonly now: () => Date;
  private readonly logger?: LoggerLike;
  private readonly listeners = new Set<TimeoutListener>();
  private readonly handledSessions = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private sweepInProgress = false;

  constructor(options: InactivityTimeoutServiceOptions) {
    this.sessions = options.sessions;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.sweepIntervalMs = Math.max(1_000, options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runSweep();
    }, this.sweepIntervalMs);
    this.timer.unref?.();

    void this.runSweep();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(listener: TimeoutListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTimeoutThresholdMs(): number {
    return this.timeoutMs;
  }

  getSweepIntervalMs(): number {
    return this.sweepIntervalMs;
  }

  async runSweep(): Promise<number> {
    if (this.sweepInProgress) {
      return 0;
    }

    this.sweepInProgress = true;
    try {
      const sessions = this.sessions.listSessions();
      const referenceTime = this.now();
      let timedOutCount = 0;

      for (const session of sessions) {
        const idleMs = referenceTime.getTime() - session.lastHeartbeatAt.getTime();
        if (idleMs < this.timeoutMs) {
          this.handledSessions.delete(session.sessionId);
          continue;
        }

        if (this.handledSessions.has(session.sessionId)) {
          continue;
        }

        timedOutCount += 1;
        await this.handleTimeout(session, idleMs, referenceTime);
      }

      return timedOutCount;
    } finally {
      this.sweepInProgress = false;
    }
  }

  private async handleTimeout(session: PlayerSessionState, idleMs: number, timedOutAt: Date): Promise<void> {
    this.handledSessions.add(session.sessionId);

    const snapshot = structuredClone(session);
    snapshot.status = "terminating";
    this.sessions.setStatus(session.sessionId, "terminating");

    const event: InactivityTimeoutEvent = {
      session: snapshot,
      idleMs,
      thresholdMs: this.timeoutMs,
      timedOutAt
    } satisfies InactivityTimeoutEvent;

    this.logger?.info?.("inactivity_timeout.detected", {
      sessionId: session.sessionId,
      userId: session.userId,
      idleMs,
      thresholdMs: this.timeoutMs
    });

    await this.notifyListeners(event);

    this.sessions.remove(session.sessionId);
    this.handledSessions.delete(session.sessionId);
  }

  private async notifyListeners(event: InactivityTimeoutEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        this.logger?.error?.("inactivity_timeout.listener_error", {
          sessionId: event.session.sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
