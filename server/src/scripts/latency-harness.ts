import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
// Import after shim to satisfy TS. Actual runtime module supplies richer types.
import { Client, Room } from "colyseus.js";

interface HarnessConfig {
  endpoint: string; // ws(s)://host:port
  room: string; // battle room name
  clients: number; // number of concurrent clients to simulate
  joinIntervalMs: number; // stagger between joins
  snapshotRounds: number; // number of snapshot.request RTT measurements per client
  timeoutMs: number; // overall timeout safeguard
}

interface SnapshotSample { latency: number; }

interface ClientContext {
  client: Client;
  room?: Room;
  handshakeStart: number;
  handshakeLatency?: number;
  snapshotSamples: SnapshotSample[];
  pendingSnapshotRequestAt?: number;
}

interface AggregatedStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  average: number;
}

function computeStats(values: number[]): AggregatedStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, p50: 0, p95: 0, average: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: pct(50),
    p95: pct(95),
    average: sum / sorted.length
  };
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function run(config: HarnessConfig): Promise<void> {
  const contexts: ClientContext[] = [];
  const deadline = Date.now() + config.timeoutMs;

  for (let i = 0; i < config.clients; i++) {
    if (Date.now() > deadline) throw new Error("harness timeout while joining");
    const client = new Client(config.endpoint);
    const ctx: ClientContext = { client, handshakeStart: performance.now(), snapshotSamples: [] };
    contexts.push(ctx);
    // eslint-disable-next-line no-await-in-loop
    await joinBattleRoom(ctx, config).catch((err) => { throw new Error(`join failed: ${err instanceof Error ? err.message : String(err)}`); });
    // eslint-disable-next-line no-await-in-loop
    await sleep(config.joinIntervalMs);
  }

  // Snapshot RTT rounds
  for (let round = 0; round < config.snapshotRounds; round++) {
    for (const ctx of contexts) {
      if (!ctx.room) continue;
      ctx.pendingSnapshotRequestAt = performance.now();
      ctx.room.send("snapshot.request");
    }
    // Wait for all snapshot responses for this round or timeout
    const waitUntil = Date.now() + 5_000;
    // eslint-disable-next-line no-loop-func
    while (contexts.some((c) => c.pendingSnapshotRequestAt)) {
      if (Date.now() > waitUntil) {
        break; // partial data
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(10);
    }
  }

  // Aggregate
  const handshakeLatencies = contexts.map((c) => c.handshakeLatency!).filter((n) => typeof n === "number");
  const snapshotLatencies = contexts.flatMap((c) => c.snapshotSamples.map((s) => s.latency));
  const result = {
    config,
    handshake: computeStats(handshakeLatencies),
    snapshotRtt: computeStats(snapshotLatencies)
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));

  // Cleanup
  await Promise.all(contexts.map(async (c) => {
    try { c.room?.leave(); } catch { /* noop */ }
  }));
}

async function joinBattleRoom(ctx: ClientContext, config: HarnessConfig): Promise<void> {
  const playerId = `h_${randomUUID().slice(0, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timeout")), 5000);
    ctx.client
      .joinOrCreate(config.room, { playerId })
  .then((room: Room) => {
        ctx.room = room;
        room.onMessage("snapshot.update", () => {
          if (!ctx.handshakeLatency) {
            ctx.handshakeLatency = performance.now() - ctx.handshakeStart;
          }
          if (ctx.pendingSnapshotRequestAt) {
            const latency = performance.now() - ctx.pendingSnapshotRequestAt;
            ctx.snapshotSamples.push({ latency });
            ctx.pendingSnapshotRequestAt = undefined;
          }
        });
        clearTimeout(timer);
        resolve(undefined);
      })
  .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run({
    endpoint: process.env.HARNESS_ENDPOINT || "ws://localhost:4000",
    room: process.env.HARNESS_ROOM || "battle",
    clients: Number(process.env.HARNESS_CLIENTS || 5),
    joinIntervalMs: Number(process.env.HARNESS_JOIN_INTERVAL_MS || 25),
    snapshotRounds: Number(process.env.HARNESS_SNAPSHOT_ROUNDS || 5),
    timeoutMs: Number(process.env.HARNESS_TIMEOUT_MS || 30_000)
  }).catch((err) => {
    console.error("Latency harness failed", err);
    process.exitCode = 1;
  });
}
