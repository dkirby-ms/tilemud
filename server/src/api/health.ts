import { Router } from "express";
import type { AppLogger } from "../logging/logger.js";

export function createHealthRouter(logger: AppLogger): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    // Basic liveness; can be extended with DB/Redis checks later (T054)
    logger.debug?.("health.check");
    res.status(200).json({ status: "ok" });
  });

  return router;
}
