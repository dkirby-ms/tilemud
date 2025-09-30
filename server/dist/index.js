import { createServer as createHttpServer } from "node:http";
import { Server as ColyseusServer } from "colyseus";
import { createApp } from "./api/app.js";
import { initializeContainer, shutdownContainer } from "./infra/container.js";
import { registerRooms } from "./rooms/registerRooms.js";
let activeServer = null;
export async function start() {
    if (activeServer) {
        return activeServer;
    }
    const container = await initializeContainer();
    const config = container.config;
    const logger = console;
    const app = createApp();
    const httpServer = createHttpServer(app);
    const gameServer = new ColyseusServer({ server: httpServer });
    const battleRoomDependencies = {
        rateLimiter: container.rateLimiter,
        snapshotService: container.snapshotService,
        outcomeService: container.outcomeService,
        reconnectService: container.reconnectService,
        messageService: container.messageService,
        ruleSetService: container.ruleSetService,
        logger,
        now: () => Date.now(),
        defaultGracePeriodMs: 60_000
    };
    try {
        await registerRooms({
            gameServer,
            ruleSetService: container.ruleSetService,
            battleRoom: {
                dependencies: battleRoomDependencies
            },
            logger
        });
    }
    catch (error) {
        await gameServer.gracefullyShutdown().catch(() => undefined);
        await shutdownContainer().catch(() => undefined);
        throw error;
    }
    await new Promise((resolve, reject) => {
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
        await new Promise((resolve, reject) => {
            httpServer.close((err) => {
                if (err) {
                    reject(err);
                }
                else {
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
    };
    logger.info?.("server.start", { port: config.port });
    return activeServer;
}
const maybeProcess = globalThis.process;
const isDirectExecution = (() => {
    if (!maybeProcess?.argv?.[1]) {
        return false;
    }
    try {
        const executedPath = new URL(import.meta.url).pathname;
        const cliPath = new URL(`file://${maybeProcess.argv[1]}`).pathname;
        return executedPath === cliPath;
    }
    catch {
        return false;
    }
})();
if (isDirectExecution) {
    start().catch((error) => {
        // eslint-disable-next-line no-console -- placeholder logging until pino integration (T055)
        console.error("Failed to start server", error);
        if (maybeProcess) {
            maybeProcess.exitCode = 1;
        }
    });
}
//# sourceMappingURL=index.js.map