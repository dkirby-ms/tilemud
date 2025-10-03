import express, { type Express } from "express";
import { getContainer, type Container } from "../infra/container.js";
import { getAppLogger } from "../logging/logger.js";
import { createHealthRouter } from "./health.js";
import { createOutcomesRouter } from "./outcomes.js";
import { createPlayerMessagesRouter } from "./playerMessages.js";
import { createErrorCatalogRouter } from "./errorCatalog.js";
import { createErrorMiddleware } from "./errorMiddleware.js";
import { createSessionBootstrapRouter } from "./sessionBootstrap.js";
import { createVersionRouter } from "./version.js";
import { healthCheckPostgres } from "../infra/postgres.js";
import { healthCheckRedis } from "../infra/redis.js";

export function createApp(existingContainer?: Container): Express {
  const app = express();
  const container = existingContainer ?? getContainer();
  const logger = getAppLogger();

  app.use(express.json());
  const versionService = container.versionService;

  // Routers
  app.use(
    createHealthRouter({
      logger,
      checkPostgres: () => healthCheckPostgres(),
      checkRedis: () => healthCheckRedis(),
      getVersionInfo: () => versionService.getVersionInfo()
    })
  );
  app.use(createSessionBootstrapRouter({ service: container.sessionBootstrapService, logger }));
  app.use(createOutcomesRouter({ outcomeService: container.outcomeService, logger }));
  app.use(createPlayerMessagesRouter({ messageService: container.messageService, logger }));
  app.use(createErrorCatalogRouter({ errorCatalog: container.errorCatalog, logger }));
  app.use(createVersionRouter(versionService));

  // 404 handler (after known routes, before error middleware)
  app.use((req, res) => {
    res.status(404).json({
      numericCode: "E1004", // INSTANCE_TERMINATED used as generic missing resource placeholder
      reason: "instance_terminated",
      category: "state",
      retryable: false,
      humanMessage: "Resource not found"
    });
  });

  // Error middleware
  app.use(createErrorMiddleware(logger));

  return app;
}
