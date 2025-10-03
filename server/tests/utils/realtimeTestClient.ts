import { Client, type Room } from "colyseus.js";
import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { start, type StartedServer } from "../../src/index.js";
import { SERVER_BUILD_VERSION } from "../../src/infra/version.js";

export interface PendingEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
}

export interface RealtimeTestHarness {
  client: Client;
  session: {
    sessionId: string;
    userId: string;
    reconnectToken: string | null;
    version: string;
  };
  sendIntent(type: string, payload: unknown, options?: { sequence?: number }): Promise<void>;
  waitForEvent<TPayload = unknown>(
    type: string,
    options?: { timeoutMs?: number }
  ): Promise<PendingEvent<TPayload>>;
  close(): Promise<void>;
}

export interface RealtimeTestOptions {
  version?: string;
  token?: string;
  reconnectToken?: string | null;
  roomName?: string;
  joinPayloadOverrides?: Record<string, unknown>;
}

interface BootstrapResult {
  sessionId: string;
  userId: string;
  reconnectToken: string | null;
  issuedAt: string;
  version: string;
  roomName?: string;
  roomId?: string;
  lastSequenceNumber: number;
  raw?: unknown;
}

type EventQueueMap = Map<string, PendingEvent[]>;
type EventWaiter = (event: PendingEvent<unknown>) => void;
type EventWaiterMap = Map<string, EventWaiter[]>;

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ROOM_NAME = "game";
const DEFAULT_TOKEN = "Bearer dev-valid-token";

let sharedServerPromise: Promise<StartedServer> | null = null;
let bootstrapLock: Promise<void> = Promise.resolve();
const BOOTSTRAP_LOCK_PATH = join(tmpdir(), "tilemud-realtime-bootstrap.lock");
const LOCK_RETRY_DELAY_MS = 10;
const LOCK_STALE_TIMEOUT_MS = 30_000;
const pendingBootstrapReleases = new Set<() => Promise<void>>();
let exitHookRegistered = false;

function ensureExitHookRegistered(): void {
  if (exitHookRegistered) {
    return;
  }
  exitHookRegistered = true;
  process.once("exit", () => {
    for (const release of pendingBootstrapReleases) {
      release().catch(() => undefined);
    }
    pendingBootstrapReleases.clear();
  });
}

async function acquireFilesystemLock(): Promise<() => Promise<void>> {
  const attempt = async (): Promise<() => Promise<void>> => {
    try {
      const handle = await open(BOOTSTRAP_LOCK_PATH, "wx");
      const metadata = JSON.stringify({ pid: process.pid, timestamp: Date.now() });
      await handle.writeFile(metadata, { encoding: "utf8" });
      await handle.close();
      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        await unlink(BOOTSTRAP_LOCK_PATH).catch(() => undefined);
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") {
        throw error;
      }

      let clearStaleLock = false;
      try {
        const contents = await readFile(BOOTSTRAP_LOCK_PATH, "utf8");
        const parsed = JSON.parse(contents) as { pid?: number; timestamp?: number };
        if (typeof parsed?.pid === "number") {
          try {
            process.kill(parsed.pid, 0);
          } catch (killError) {
            const killNodeError = killError as NodeJS.ErrnoException;
            if (killNodeError.code === "ESRCH") {
              clearStaleLock = true;
            }
          }
        }

        if (!clearStaleLock && typeof parsed?.timestamp === "number") {
          if (Date.now() - parsed.timestamp > LOCK_STALE_TIMEOUT_MS) {
            clearStaleLock = true;
          }
        }
      } catch {
        clearStaleLock = true;
      }

      if (clearStaleLock) {
        await unlink(BOOTSTRAP_LOCK_PATH).catch(() => undefined);
      } else {
        await delay(LOCK_RETRY_DELAY_MS);
      }

      return attempt();
    }
  };

  return attempt();
}

async function withSerializedBootstrap<T>(operation: (release: () => Promise<void>) => Promise<T>): Promise<T> {
  const releaseFilesystemLock = await acquireFilesystemLock();

  let releaseInProcess!: () => void;
  const next = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });

  const previous = bootstrapLock;
  bootstrapLock = previous.then(() => next);

  await previous;

  let released = false;
  const releaseAll = async () => {
    if (released) {
      return;
    }
    released = true;
    pendingBootstrapReleases.delete(releaseAll);
    releaseInProcess();
    await releaseFilesystemLock();
  };

  pendingBootstrapReleases.add(releaseAll);
  ensureExitHookRegistered();

  try {
    return await operation(releaseAll);
  } catch (error) {
    await releaseAll();
    throw error;
  }
}

export async function createRealtimeTestHarness(options: RealtimeTestOptions = {}): Promise<RealtimeTestHarness> {
  return withSerializedBootstrap(async (releaseLock) => {
    const server = await ensureServerStarted();
    const port = server.port;
    const baseUrl = `http://localhost:${port}`;
    const clientVersion = options.version ?? SERVER_BUILD_VERSION;
    const authToken = options.token ?? DEFAULT_TOKEN;
    const reconnectToken = options.reconnectToken ?? null;

    const bootstrap = await bootstrapSession({
      baseUrl,
      token: authToken,
      clientVersion,
      reconnectToken
    });

    const client = new Client(`ws://localhost:${port}`);
    const joinPayload = createJoinPayload({
      bootstrap,
      clientVersion,
      overrides: options.joinPayloadOverrides
    });

    const { room, cleanup: roomCleanup } = await joinRealtimeRoom({
      client,
      roomName: options.roomName ?? bootstrap.roomName ?? DEFAULT_ROOM_NAME,
      fallbackRoomId: bootstrap.roomId,
      joinPayload
    });

    const events: EventQueueMap = new Map();
    const waiters: EventWaiterMap = new Map();

    let sequenceCursor = bootstrap.lastSequenceNumber;
    let lastDisconnectReason: string | undefined;

    const pushEvent = (event: PendingEvent) => {
      if (process.env.DEBUG_REALTIME_TESTS === "1") {
        // eslint-disable-next-line no-console -- opt-in debug aid for realtime harness troubleshooting
        console.log("realtimeTestHarness.event", event.type, event.payload);
      }
      if (event.type === "event.ack") {
        const ack = event.payload as { sequence?: number };
        if (typeof ack?.sequence === "number") {
          sequenceCursor = Math.max(sequenceCursor, ack.sequence);
        }
      }

      if (event.type === "event.version_mismatch") {
        lastDisconnectReason = "version_mismatch";
      }

      const pendingWaiters = waiters.get(event.type);
      if (pendingWaiters && pendingWaiters.length > 0) {
        const resolver = pendingWaiters.shift();
        resolver?.(event);
        return;
      }

      const queue = events.get(event.type) ?? [];
      queue.push(event);
      events.set(event.type, queue);
    };

    room.onMessage("*", (type, payload: unknown) => {
      pushEvent({ type: String(type), payload });
    });

    room.onLeave((code: number) => {
      pushEvent({
        type: "event.disconnect",
        payload: {
          code,
          reason: lastDisconnectReason ?? "disconnect"
        }
      });
      lastDisconnectReason = undefined;
    });

    room.onError((code, message) => {
      pushEvent({
        type: "event.error",
        payload: {
          code,
          message
        }
      });
    });

    const waitForEvent = <TPayload = unknown>(
      type: string,
      waitOptions: { timeoutMs?: number } = {}
    ): Promise<PendingEvent<TPayload>> => {
      const timeoutMs = waitOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (process.env.DEBUG_REALTIME_TESTS === "1") {
        // eslint-disable-next-line no-console -- optional debug visibility during tests
        console.log("realtimeTestHarness.wait", type, "pending");
      }
      const queue = events.get(type);
      if (queue && queue.length > 0) {
        const event = queue.shift() as PendingEvent<TPayload>;
        if (process.env.DEBUG_REALTIME_TESTS === "1") {
          console.log("realtimeTestHarness.wait", type, "resolved-from-queue");
        }
        return Promise.resolve(event);
      }

      return new Promise<PendingEvent<TPayload>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const listeners = waiters.get(type);
          if (listeners) {
            const index = listeners.indexOf(resolver);
            if (index >= 0) {
              listeners.splice(index, 1);
            }
          }
          reject(new Error(`Timed out waiting for event "${type}" after ${timeoutMs}ms`));
        }, timeoutMs).unref?.();

        const resolver: EventWaiter = (event) => {
          clearTimeout(timer);
          if (process.env.DEBUG_REALTIME_TESTS === "1") {
            console.log("realtimeTestHarness.wait", type, "resolved-from-waiter");
          }
          resolve(event as PendingEvent<TPayload>);
        };

        const listeners = waiters.get(type) ?? [];
        listeners.push(resolver);
        waiters.set(type, listeners);
      });
    };

    const sendIntent = async (type: string, payload: unknown, intentOptions?: { sequence?: number }): Promise<void> => {
      const sequence = intentOptions?.sequence ?? (sequenceCursor += 1);
      const envelope = normalizeIntentPayload(payload, sequence);
      room.send(type, envelope);
    };

    const close = async (): Promise<void> => {
      if (process.env.DEBUG_REALTIME_TESTS === "1") {
        console.log("realtimeTestHarness.close begin");
      }
      waiters.clear();
      events.clear();
      lastDisconnectReason = undefined;

      try {
        await Promise.race([room.leave(true), delay(100)]).catch(() => undefined);
        await roomCleanup();
      } finally {
        await server.stop().catch(() => undefined);
        sharedServerPromise = null;
        await delay(250);
        await releaseLock();
        if (process.env.DEBUG_REALTIME_TESTS === "1") {
          console.log("realtimeTestHarness.close end");
        }
      }
    };

    return {
      client,
      session: {
        sessionId: bootstrap.sessionId,
        userId: bootstrap.userId,
        reconnectToken: bootstrap.reconnectToken,
        version: bootstrap.version
      },
      sendIntent,
      waitForEvent,
      close
    } satisfies RealtimeTestHarness;
  });
}

async function ensureServerStarted(): Promise<StartedServer> {
  if (!sharedServerPromise) {
    sharedServerPromise = start();
  }
  return sharedServerPromise;
}

async function bootstrapSession(input: {
  baseUrl: string;
  token: string;
  clientVersion: string;
  reconnectToken: string | null;
}): Promise<BootstrapResult> {
  try {
    const response = await fetch(`${input.baseUrl}/api/session/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: input.token,
        "Content-Type": "application/json",
        "x-client-version": input.clientVersion
      },
      body: JSON.stringify({
        reconnectToken: input.reconnectToken,
        clientVersion: input.clientVersion
      })
    });

    if (!response.ok) {
      throw new Error(`Bootstrap failed with status ${response.status}`);
    }

    const payload = await response.json();
    return {
      sessionId: payload?.session?.sessionId ?? randomUUID(),
      userId: payload?.session?.userId ?? `user-${randomUUID()}`,
      reconnectToken: payload?.reconnect?.token ?? null,
      issuedAt: payload?.issuedAt ?? new Date().toISOString(),
      version: payload?.version ?? SERVER_BUILD_VERSION,
      roomName: payload?.realtime?.room ?? undefined,
      roomId: payload?.realtime?.roomId ?? undefined,
      lastSequenceNumber: payload?.session?.lastSequenceNumber ?? 0,
      raw: payload
    } satisfies BootstrapResult;
  } catch (error) {
    if (process.env.DEBUG_REALTIME_TESTS === "1") {
      // eslint-disable-next-line no-console -- opt-in debug aid for realtime harness troubleshooting
      console.warn("realtimeTestHarness.bootstrap.fallback", error);
    }
    // Fallback synthetic bootstrap to keep tests failing on room semantics rather than harness setup.
    return {
      sessionId: `session-${randomUUID()}`,
      userId: `user-${randomUUID()}`,
      reconnectToken: input.reconnectToken,
      issuedAt: new Date().toISOString(),
      version: SERVER_BUILD_VERSION,
      roomName: undefined,
      roomId: undefined,
      lastSequenceNumber: 0,
      raw: { error: error instanceof Error ? error.message : String(error) }
    } satisfies BootstrapResult;
  }
}

async function joinRealtimeRoom(input: {
  client: Client;
  roomName: string;
  fallbackRoomId?: string;
  joinPayload: Record<string, unknown>;
}): Promise<{ room: Room; cleanup: () => Promise<void> }>
{
  const lobbyRooms: Room[] = [];

  const cleanup = async () => {
    await Promise.all(
      lobbyRooms.map((lobby) => lobby.leave(true).catch(() => undefined))
    );
  };

  try {
    const room = await input.client.joinOrCreate(input.roomName, input.joinPayload);
    return { room, cleanup };
  } catch (primaryError) {
    if (input.fallbackRoomId) {
      try {
        const room = await input.client.joinById(input.fallbackRoomId, input.joinPayload);
        return { room, cleanup };
      } catch (secondaryError) {
        const error = new Error(
          `Failed to join realtime room "${input.roomName}" (${primaryError instanceof Error ? primaryError.message : primaryError}) and joinById fallback (${secondaryError instanceof Error ? secondaryError.message : secondaryError}).`
        );
        throw error;
      }
    }

    throw new Error(
      `Failed to join realtime room "${input.roomName}": ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`
    );
  }
}

function createJoinPayload(input: {
  bootstrap: BootstrapResult;
  clientVersion: string;
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sessionId: input.bootstrap.sessionId,
    userId: input.bootstrap.userId,
    reconnectToken: input.bootstrap.reconnectToken,
    clientVersion: input.clientVersion,
    lastSequenceNumber: input.bootstrap.lastSequenceNumber
  };

  if (input.overrides) {
    Object.assign(payload, input.overrides);
  }

  return payload;
}

function normalizeIntentPayload(payload: unknown, sequence: number): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...payload as Record<string, unknown>,
      sequence
    };
  }

  return { sequence, value: payload };
}
