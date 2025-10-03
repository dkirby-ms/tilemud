import { Router } from "express";
import { restSchemas } from "../contracts/restSchemas.js";
import type { VersionService } from "../services/versionService.js";

export function createVersionRouter(service: VersionService): Router {
  const router = Router();

  router.get("/api/version", (_req, res) => {
    const info = service.getVersionInfo();
    const payload = restSchemas.version.response.parse({
      version: info.version,
      protocol: info.protocol,
      updatedAt: info.updatedAt
    });

    res.status(200).json(payload);
  });

  return router;
}
