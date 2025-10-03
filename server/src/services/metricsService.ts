import { counter, gauge, histogram } from "../infra/metrics.js";

const METRIC_NAMES = {
  connectAttemptsTotal: "connect_attempts_total",
  connectSuccessTotal: "connect_success_total",
  reconnectAttemptsTotal: "reconnect_attempts_total",
  reconnectSuccessTotal: "reconnect_success_total",
  versionRejectTotal: "version_reject_total",
  stateRefreshForcedTotal: "state_refresh_forced_total",
  actionLatencyHistogram: "action_latency_ms",
  cacheHitRatioGauge: "cache_hit_ratio",
  activeSessionsGauge: "active_sessions_gauge"
} as const;

export interface AvailabilitySnapshot {
  reconnectSuccessRate: number | null;
  connectSuccessRate: number | null;
}

export interface LatencySnapshot {
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}

export interface MetricsServiceSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  latency: LatencySnapshot;
  availability: AvailabilitySnapshot;
}

export class MetricsService {
  private readonly connectAttempts = counter(METRIC_NAMES.connectAttemptsTotal);
  private readonly connectSuccess = counter(METRIC_NAMES.connectSuccessTotal);
  private readonly reconnectAttempts = counter(METRIC_NAMES.reconnectAttemptsTotal);
  private readonly reconnectSuccess = counter(METRIC_NAMES.reconnectSuccessTotal);
  private readonly versionRejects = counter(METRIC_NAMES.versionRejectTotal);
  private readonly forcedRefreshes = counter(METRIC_NAMES.stateRefreshForcedTotal);
  private readonly actionLatency = histogram(METRIC_NAMES.actionLatencyHistogram);
  private readonly cacheHitRatio = gauge(METRIC_NAMES.cacheHitRatioGauge);
  private readonly activeSessions = gauge(METRIC_NAMES.activeSessionsGauge);

  recordConnectAttempt(): void {
    this.connectAttempts.inc();
  }

  recordConnectSuccess(): void {
    this.connectSuccess.inc();
  }

  recordReconnectAttempt(): void {
    this.reconnectAttempts.inc();
  }

  recordReconnectSuccess(): void {
    this.reconnectSuccess.inc();
  }

  recordVersionReject(): void {
    this.versionRejects.inc();
  }

  recordForcedStateRefresh(): void {
    this.forcedRefreshes.inc();
  }

  observeActionLatency(latencyMs: number): void {
    this.actionLatency.observe(latencyMs);
  }

  updateCacheHitRatio(ratio: number): void {
    this.cacheHitRatio.set(clampRatio(ratio));
  }

  setActiveSessions(count: number): void {
    this.activeSessions.set(Math.max(0, Math.floor(count)));
  }

  getSnapshot(): MetricsServiceSnapshot {
    const counters = {
      [METRIC_NAMES.connectAttemptsTotal]: this.connectAttempts.value(),
      [METRIC_NAMES.connectSuccessTotal]: this.connectSuccess.value(),
      [METRIC_NAMES.reconnectAttemptsTotal]: this.reconnectAttempts.value(),
      [METRIC_NAMES.reconnectSuccessTotal]: this.reconnectSuccess.value(),
      [METRIC_NAMES.versionRejectTotal]: this.versionRejects.value(),
      [METRIC_NAMES.stateRefreshForcedTotal]: this.forcedRefreshes.value()
    } satisfies Record<string, number>;

    const gauges = {
      [METRIC_NAMES.cacheHitRatioGauge]: this.cacheHitRatio.value(),
      [METRIC_NAMES.activeSessionsGauge]: this.activeSessions.value()
    } satisfies Record<string, number>;

    const latency = {
      p50: this.actionLatency.percentile(50),
      p90: this.actionLatency.percentile(90),
      p95: this.actionLatency.percentile(95),
      p99: this.actionLatency.percentile(99)
    } satisfies LatencySnapshot;

    const availability = {
      reconnectSuccessRate: computeRate(this.reconnectSuccess.value(), this.reconnectAttempts.value()),
      connectSuccessRate: computeRate(this.connectSuccess.value(), this.connectAttempts.value())
    } satisfies AvailabilitySnapshot;

    return {
      counters,
      gauges,
      latency,
      availability
    } satisfies MetricsServiceSnapshot;
  }

  reset(): void {
    this.cacheHitRatio.set(0);
    this.activeSessions.set(0);
  }
}

function computeRate(success: number, attempts: number): number | null {
  if (attempts <= 0) {
    return null;
  }
  return success / attempts;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export { METRIC_NAMES as Metrics }; 
