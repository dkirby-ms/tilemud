import "./infra/envBootstrap.js"; // Load environment (.env / infra) before anything else
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server as ColyseusServer } from "colyseus";
import { createApp } from "./api/app.js";
import { getAppLogger } from "./logging/logger.js";
import { initializeContainer, shutdownContainer } from "./infra/container.js";
import type { BattleRoomDependencies } from "./rooms/BattleRoom.js";
import { registerRooms } from "./rooms/registerRooms.js";
import { runMigrations } from "./scripts/run-migrations.js";

export interface StartedServer {
  port: number;
  httpServer: HttpServer;
  gameServer: ColyseusServer;
  stop: () => Promise<void>;
}

let activeServer: StartedServer | null = null;

export async function start(): Promise<StartedServer> {
  if (activeServer) {
    return activeServer;
  }

  const container = await initializeContainer();
  const config = container.config;
  const logger = getAppLogger();

  // Run database migrations (idempotent). Fail fast if migrations cannot be applied.
  try {
    await runMigrations({ logger });
    logger.info?.("migrations.applied");
  } catch (error) {
    logger.error?.("migrations.failed", error);
    await shutdownContainer().catch(() => undefined);
    throw error;
  }

  const app = createApp(container);
  const httpServer = createHttpServer(app);
  const gameServer = new ColyseusServer({ server: httpServer });

  const battleRoomDependencies: BattleRoomDependencies = {
    rateLimiter: container.rateLimiter,
    snapshotService: container.snapshotService,
    outcomeService: container.outcomeService,
    reconnectService: container.reconnectService,
    messageService: container.messageService,
    ruleSetService: container.ruleSetService,
  logger: logger.child?.({ scope: "BattleRoom" }) ?? logger,
    now: () => Date.now(),
    defaultGracePeriodMs: 60_000
  } satisfies BattleRoomDependencies;

  try {
    await registerRooms({
      gameServer,
      ruleSetService: container.ruleSetService,
      battleRoom: {
        dependencies: battleRoomDependencies
      },
      logger
    });
  } catch (error) {
    await gameServer.gracefullyShutdown().catch(() => undefined);
    await shutdownContainer().catch(() => undefined);
    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, resolve);
  }).catch(async (error) => {
    await gameServer.gracefullyShutdown().catch(() => undefined);
    await shutdownContainer().catch(() => undefined);
    throw error;
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }).catch(() => undefined);

    await gameServer.gracefullyShutdown().catch(() => undefined);
    await shutdownContainer().catch(() => undefined);
    activeServer = null;
  };

  activeServer = {
    port: config.port,
    httpServer,
    gameServer,
    stop
  } satisfies StartedServer;

  logger.info?.("server.start", { port: config.port });

  return activeServer;
}

const maybeProcess = (globalThis as { process?: { argv?: string[]; exitCode?: number } }).process;

const isDirectExecution = (() => {
  if (!maybeProcess?.argv?.[1]) {
    return false;
  }

  try {
    const executedPath = new URL(import.meta.url).pathname;
    const cliPath = new URL(`file://${maybeProcess.argv[1]}`).pathname;
    return executedPath === cliPath;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  start().catch((error) => {
    const logger = getAppLogger();
    logger.error?.("server.start_failed", error);
    if (maybeProcess) {
      maybeProcess.exitCode = 1;
    }
  });
}
