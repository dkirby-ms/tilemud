import { getConfig } from "./config.js";
import { initializePostgres, closePostgres, getPostgresClient } from "./postgres.js";
import { initializeRedis, closeRedis, getRedisClient } from "./redis.js";
import { RateLimiterService, RedisSlidingWindowStore } from "../services/rateLimiter.js";
import { SnapshotService } from "../services/snapshotService.js";
import { ErrorCatalogService } from "../services/errorCatalog.js";
import { createPrivateMessageRepository } from "../models/privateMessageRepository.js";
import { createRuleSetRepository } from "../models/rulesetRepository.js";
import { MessageService } from "../services/messageService.js";
import { createBattleOutcomeRepository } from "../models/battleOutcomeRepository.js";
import { OutcomeService } from "../services/outcomeService.js";
import { ReconnectService } from "../services/reconnectService.js";
import { ActionPipeline } from "../services/actionPipeline.js";
import { RuleSetService } from "../services/rulesetService.js";
let container = null;
export async function initializeContainer() {
    if (container) {
        return container;
    }
    const config = getConfig();
    // Initialize infrastructure
    const postgres = await initializePostgres();
    const redis = await initializeRedis();
    const rateLimiter = new RateLimiterService({ store: new RedisSlidingWindowStore(redis) });
    const snapshotService = new SnapshotService();
    const errorCatalog = new ErrorCatalogService();
    const privateMessageRepository = createPrivateMessageRepository(postgres);
    const ruleSetRepository = createRuleSetRepository(postgres);
    const messageService = new MessageService({
        repository: privateMessageRepository,
        rateLimiter
    });
    const battleOutcomeRepository = createBattleOutcomeRepository(postgres);
    const outcomeService = new OutcomeService({ repository: battleOutcomeRepository });
    const ruleSetService = new RuleSetService({ repository: ruleSetRepository });
    const reconnectService = new ReconnectService({
        redis,
        defaultGracePeriodMs: 60_000
    });
    const actionPipeline = new ActionPipeline({ rateLimiter });
    container = {
        config,
        postgres,
        redis,
        getPostgresClient,
        getRedisClient,
        rateLimiter,
        snapshotService,
        errorCatalog,
        privateMessageRepository,
        messageService,
        ruleSetRepository,
        ruleSetService,
        battleOutcomeRepository,
        outcomeService,
        reconnectService,
        actionPipeline,
    };
    return container;
}
export function getContainer() {
    if (!container) {
        throw new Error("Container not initialized. Call initializeContainer() first.");
    }
    return container;
}
export async function shutdownContainer() {
    if (container) {
        await Promise.all([
            closePostgres(),
            closeRedis(),
        ]);
        container = null;
    }
}
// Graceful shutdown handlers
process.on("SIGINT", async () => {
    await shutdownContainer();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    await shutdownContainer();
    process.exit(0);
});
//# sourceMappingURL=container.js.map