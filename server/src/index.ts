import "./infra/envBootstrap.js"; // Load environment (.env / infra) before anything else
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as ColyseusServer } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createApp } from "./api/app.js";
import { getAppLogger } from "./logging/logger.js";
import { initializeContainer, shutdownContainer } from "./infra/container.js";
import type { BattleRoomDependencies } from "./rooms/BattleRoom.js";
import type { GameRoomDependencies } from "./rooms/GameRoom.js";
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
  const transport = new WebSocketTransport({
    server: httpServer
  });
  const gameServer = new ColyseusServer({
    transport
  });

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

  const gameRoomDependencies: GameRoomDependencies = {
    sessions: container.playerSessionStore,
    characterProfiles: container.characterProfileRepository,
    metrics: container.metricsService,
    versionService: container.versionService,
    sequenceService: container.actionSequenceService,
    durabilityService: container.actionDurabilityService,
    rateLimiter: container.rateLimiter,
    reconnectService: container.reconnectService,
    reconnectTokens: container.reconnectTokenStore,
    degradedSignalService: container.degradedSignalService,
    logger: logger.child?.({ scope: "GameRoom" }) ?? logger,
    now: () => new Date()
  } satisfies GameRoomDependencies;

  try {
    await registerRooms({
      gameServer,
      ruleSetService: container.ruleSetService,
      battleRoom: {
        dependencies: battleRoomDependencies
      },
      gameRoom: {
        dependencies: gameRoomDependencies
      },
      logger
    });
  } catch (error) {
    await gameServer.gracefullyShutdown().catch(() => undefined);
    await shutdownContainer().catch(() => undefined);
    throw error;
  }

  const bindHttpServer = (port: number): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      const cleanup = () => {
        httpServer.off("error", onError);
        httpServer.off("listening", onListening);
      };

      const onListening = () => {
        cleanup();
        const address = httpServer.address() as AddressInfo | string | null;
        if (address && typeof address === "object" && typeof address.port === "number") {
          resolve(address.port);
        } else if (typeof port === "number") {
          resolve(port);
        } else {
          resolve(config.port);
        }
      };

      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        reject(error);
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port);
    });

  const useEphemeralPort = process.env.VITEST === "true";
  const primaryPort = useEphemeralPort ? 0 : config.port;

  let actualPort: number;
  try {
    actualPort = await bindHttpServer(primaryPort);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (!useEphemeralPort && nodeError.code === "EADDRINUSE" && config.port !== 0) {
      logger.warn?.("server.port_in_use", {
        requestedPort: config.port
      });
      try {
        actualPort = await bindHttpServer(0);
      } catch (fallbackError) {
        await gameServer.gracefullyShutdown().catch(() => undefined);
        await shutdownContainer().catch(() => undefined);
        throw fallbackError;
      }
    } else {
      await gameServer.gracefullyShutdown().catch(() => undefined);
      await shutdownContainer().catch(() => undefined);
      throw error;
    }
  }

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
    port: actualPort,
    httpServer,
    gameServer,
    stop
  } satisfies StartedServer;

  logger.info?.("server.start", { port: actualPort, requestedPort: config.port });

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
