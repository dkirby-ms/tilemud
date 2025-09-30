import { AppConfig, getConfig } from "./config.js";
import { initializePostgres, closePostgres, PostgresClient, getPostgresClient } from "./postgres.js";
import { initializeRedis, closeRedis, getRedisClient } from "./redis.js";
import { RateLimiterService, RedisSlidingWindowStore } from "../services/rateLimiter.js";
import { SnapshotService } from "../services/snapshotService.js";
import { ErrorCatalogService } from "../services/errorCatalog.js";
import { createPrivateMessageRepository, PrivateMessageRepository } from "../models/privateMessageRepository.js";
import { createRuleSetRepository, RuleSetRepository } from "../models/rulesetRepository.js";
import { MessageService } from "../services/messageService.js";
import { createBattleOutcomeRepository, BattleOutcomeRepository } from "../models/battleOutcomeRepository.js";
import { OutcomeService } from "../services/outcomeService.js";
import { ReconnectService } from "../services/reconnectService.js";
import { ActionPipeline } from "../services/actionPipeline.js";
import { RuleSetService } from "../services/rulesetService.js";
import type { Pool } from "pg";
import type { RedisClientType } from "redis";
import { getAppLogger, type AppLogger } from "@@/logging/logger.js";

export interface Container {
  config: AppConfig;
  postgres: Pool;
  redis: RedisClientType;
  getPostgresClient: () => Promise<PostgresClient>;
  getRedisClient: () => RedisClientType;
  rateLimiter: RateLimiterService;
  snapshotService: SnapshotService;
  errorCatalog: ErrorCatalogService;
  privateMessageRepository: PrivateMessageRepository;
  messageService: MessageService;
  ruleSetRepository: RuleSetRepository;
  ruleSetService: RuleSetService;
  battleOutcomeRepository: BattleOutcomeRepository;
  outcomeService: OutcomeService;
  reconnectService: ReconnectService;
  actionPipeline: ActionPipeline;
  logger: AppLogger;
}

let container: Container | null = null;

export async function initializeContainer(): Promise<Container> {
  if (container) {
    return container;
  }

  const config = getConfig();
  const logger = getAppLogger();
  
  // Initialize infrastructure
  const postgres = await initializePostgres();
  logger.info?.("infra.postgres.initialized");
  const redis = await initializeRedis();
  logger.info?.("infra.redis.initialized");
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
    logger,
  };

  return container;
}

export function getContainer(): Container {
  if (!container) {
    throw new Error("Container not initialized. Call initializeContainer() first.");
  }
  return container;
}

export async function shutdownContainer(): Promise<void> {
  if (container) {
    const logger = container.logger ?? console;
    logger.info?.("infra.shutdown.begin");
    await Promise.all([
      closePostgres().catch((e) => logger.error?.("infra.postgres.close_failed", e)),
      closeRedis().catch((e) => logger.error?.("infra.redis.close_failed", e)),
    ]);
    logger.info?.("infra.shutdown.complete");
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