import { Router } from "express";
import { restSchemas } from "../contracts/restSchemas.js";
import type { SessionBootstrapService } from "../services/sessionBootstrapService.js";
import type { AppLogger } from "../logging/logger.js";

export interface SessionBootstrapRouterDeps {
  service: SessionBootstrapService;
  logger: AppLogger;
}

const requestSchema = restSchemas.sessionBootstrap.request;
const responseSchema = restSchemas.sessionBootstrap.response;

export function createSessionBootstrapRouter(deps: SessionBootstrapRouterDeps): Router {
  const router = Router();
  const { service, logger } = deps;

  router.post("/api/session/bootstrap", async (req, res, next) => {
    const authorization = req.get("authorization") ?? req.get("Authorization");

    if (!authorization) {
      res.status(401).json({
        reason: "authorization_required",
        message: "Authorization header is required",
        retryable: false
      });
      return;
    }

    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        reason: "invalid_request",
        message: "Request body failed validation",
        issues: parsed.error.flatten()
      });
      return;
    }

    try {
      const result = await service.bootstrapSession({
        token: authorization,
        reconnectToken: parsed.data.reconnectToken ?? null,
        clientVersion: parsed.data.clientVersion
      });

      const response = responseSchema.parse(result);
      res.status(200).json(response);
    } catch (error) {
      if (isAuthorizationError(error)) {
        res.status(401).json({
          reason: error.message,
          message: "Authorization failed",
          retryable: false
        });
        return;
      }

      logger.error?.({ err: error }, "session.bootstrap.failure");
      next(error);
    }
  });

  return router;
}

function isAuthorizationError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "authorization_token_invalid" ||
    error.message === "authorization_token_invalid_format" ||
    error.message === "authorization_token_empty" ||
    error.message === "authorization_token_missing"
  );
}
