import { Router } from "express";
import type { ErrorCatalogService } from "../services/errorCatalog.js";
import type { AppLogger } from "../logging/logger.js";

export interface ErrorCatalogRouterDeps {
  errorCatalog: ErrorCatalogService;
  logger: AppLogger;
}

export function createErrorCatalogRouter(deps: ErrorCatalogRouterDeps): Router {
  const router = Router();
  const { errorCatalog, logger } = deps;

  router.get("/errors/catalog", (_req, res) => {
    const items = errorCatalog.listCatalog();
    logger.debug?.({ count: items.length }, "errors.catalog.list");
    res.status(200).json({ items });
  });

  return router;
}
