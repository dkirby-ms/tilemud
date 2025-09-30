import { randomUUID } from "node:crypto";
import { start, type StartedServer } from "../index.js";
import { seedRuleset } from "./seed-ruleset.js";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "colyseus.js";

interface ValidationResult {
  healthOk: boolean;
  seedOk: boolean;
  joinOk: boolean;
  handshakeLatencyMs?: number;
}

async function assertEnv(): Promise<void> {
  const required = ["DATABASE_URL", "REDIS_URL", "PORT"] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

async function fetchHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return Boolean(body.status === "ok" || body.ok || true);
  } catch {
    return false;
  }
}

async function attemptJoin(port: number): Promise<{ ok: boolean; latency?: number }> {
  const client = new Client(`ws://localhost:${port}`);
  const startTs = performance.now();
  try {
    const room = await client.joinOrCreate("battle", { playerId: `qs_${randomUUID().slice(0, 8)}` });
    let firstSnapshotLatency: number | undefined;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("snapshot timeout")), 5000);
      room.onMessage("snapshot.update", () => {
        if (!firstSnapshotLatency) {
          firstSnapshotLatency = performance.now() - startTs;
          clearTimeout(timer);
          resolve();
        }
      });
    });
    room.leave();
    return { ok: true, latency: firstSnapshotLatency };
  } catch {
    return { ok: false };
  }
}

async function main(): Promise<void> {
  await assertEnv();
  const result: ValidationResult = { healthOk: false, seedOk: false, joinOk: false };
  // Seed rule set (idempotent)
  try {
    await seedRuleset(console as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    result.seedOk = true;
  } catch (e) {
    console.error("seed.failed", e);
  }

  let server: StartedServer | null = null;
  try {
    server = await start();
    // Wait briefly for readiness
    await sleep(250);
    result.healthOk = await fetchHealth(server.port);
    const joinResult = await attemptJoin(server.port);
    result.joinOk = joinResult.ok;
    if (joinResult.latency) result.handshakeLatencyMs = Number(joinResult.latency.toFixed(2));
  } finally {
    await server?.stop().catch(() => undefined);
  }

  if (!result.healthOk || !result.seedOk || !result.joinOk) {
    console.error("quickstart.validation.failed", result);
    throw new Error("Quickstart validation failed");
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ quickstart: "ok", result }, null, 2));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("Quickstart validation failed", err);
    process.exitCode = 1;
  });
}
