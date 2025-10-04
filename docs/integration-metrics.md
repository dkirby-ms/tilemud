# Integration Metrics Guide

This guide describes how to inspect and validate the realtime integration metrics that back the TileMUD game server.

## Overview

The integration architecture emits metrics from the server-side `MetricsService`. All counters, gauges, and histograms are currently backed by the in-memory registry exposed from `server/src/infra/metrics.ts`. These metrics can be scraped directly inside tests or surfaced via the observability pipeline once telemetry wiring is enabled.

| Metric | Type | Description | Source |
| --- | --- | --- | --- |
| `connect_attempts_total` | Counter | Number of realtime connect attempts (handshake initiated) | `MetricsService.recordConnectAttempt()` |
| `connect_success_total` | Counter | Successful realtime handshakes | `MetricsService.recordConnectSuccess()` |
| `reconnect_attempts_total` | Counter | Reconnect attempts observed by the session store | `MetricsService.recordReconnectAttempt()` |
| `reconnect_success_total` | Counter | Successful reconnect handshakes | `MetricsService.recordReconnectSuccess()` |
| `version_reject_total` | Counter | Clients rejected due to protocol version mismatch | `MetricsService.recordVersionReject()` |
| `state_refresh_forced_total` | Counter | Forced freshness refreshes due to cache staleness | `MetricsService.recordForcedStateRefresh()` |
| `action_latency_ms` | Histogram | Latency for action intents (ingress ➝ ack) | `MetricsService.observeActionLatency()` |
| `cache_hit_ratio` | Gauge | Rolling cache hit ratio across realtime reads | `MetricsService.updateCacheHitRatio()` |
| `active_sessions_gauge` | Gauge | Active realtime sessions measured by the GameRoom | `MetricsService.setActiveSessions()` |

## Latency Budgets

- **Action latency budget**: ≤ 200ms p95 (FR-005 / NFR-001). The histogram data is sampled in [`server/tests/integration/perf/latency-budget.spec.ts`](../server/tests/integration/perf/latency-budget.spec.ts).
- **Freshness window**: ≤ 100ms p95 for state delta propagation. Enforcement lives in the realtime pipeline and is observed through the same histogram coupled with forced state refresh counts.

Use the helper assertions in the latency budget test to model future scenarios.

## Availability Budget

The availability score is derived inside `MetricsService.getSnapshot()` using:

$$ \text{availability} = \frac{\text{success}}{\text{attempts}} $$

for both connect and reconnect flows. These values power the availability SLO test (`server/tests/integration/availability-slo.spec.ts`).

## Running the Performance Harness

1. Build the server: `npm run build` inside `server/`.
2. Execute the harness (after implementation):

```bash
npm run latency:harness -- --sessions 500 --duration 30000
```

The harness will stream structured metrics summaries to STDOUT. The script lives at `server/scripts/latency-harness.ts` (to be implemented alongside the test harness).

## Exporting Metrics Snapshots

During integration testing you can capture the in-memory metrics registry:

```ts
import { snapshotMetrics } from "@/infra/metrics";

const snapshot = snapshotMetrics();
console.log(snapshot);
```

This is particularly helpful when triaging latency budget regressions.

## Next Steps

- Wire the in-memory registry to Prometheus once the deployment topology is finalized.
- Feed the histogram samples into a streaming analytics job to compute sliding window SLOs.
- Extend the harness to emit JSON reports so CI can surface trend regressions.
