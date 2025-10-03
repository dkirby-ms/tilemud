import { performance } from "node:perf_hooks";
import { Router } from "express";
import { restSchemas } from "../contracts/restSchemas.js";
import type { AppLogger } from "../logging/logger.js";
import type { VersionInfo } from "../services/versionService.js";

type DependencyStatus = "available" | "degraded" | "unavailable";

interface DependencyCheckResult {
  status: DependencyStatus;
  message?: string;
}

type DependencyCheck = () => Promise<boolean | DependencyCheckResult>;

export interface HealthRouterDeps {
  logger: AppLogger;
  checkPostgres: DependencyCheck;
  checkRedis: DependencyCheck;
  getVersionInfo: () => VersionInfo;
  now?: () => Date;
}

interface TimedDependencyResult extends DependencyCheckResult {
  latencyMs?: number;
  checkedAt?: string;
}

function coerceResult(result: boolean | DependencyCheckResult): DependencyCheckResult {
  if (typeof result === "boolean") {
    return { status: result ? "available" : "unavailable" } satisfies DependencyCheckResult;
  }
  return result;
}

function httpStatusFor(status: DependencyStatus): number {
  return status === "unavailable" ? 503 : 200;
}

export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();
  const { logger, checkPostgres, checkRedis, getVersionInfo } = deps;
  const now = deps.now ?? (() => new Date());

  router.get("/api/health", async (_req, res, next) => {
    const observedAt = now().toISOString();

    try {
      const dependencyResults = await Promise.all(
        [
          { name: "postgres", check: checkPostgres },
          { name: "redis", check: checkRedis }
        ].map(async ({ name, check }) => {
          const startedAt = performance.now();

          try {
            const result = coerceResult(await check());
            const endedAt = performance.now();
            const latency = endedAt - startedAt;
            const dependencyObservedAt = now().toISOString();

            return {
              name,
              status: result.status,
              message: result.message,
              latencyMs: Number.isFinite(latency) ? Math.round(latency) : undefined,
              checkedAt: dependencyObservedAt
            } satisfies TimedDependencyResult & { name: string };
          } catch (error) {
            const endedAt = performance.now();
            const latency = endedAt - startedAt;
            const dependencyObservedAt = now().toISOString();
            logger.warn?.({ dependency: name, err: error }, "health.dependency_failed");
            return {
              name,
              status: "unavailable" as const,
              message: error instanceof Error ? error.message : "Unknown dependency failure",
              latencyMs: Number.isFinite(latency) ? Math.round(latency) : undefined,
              checkedAt: dependencyObservedAt
            } satisfies TimedDependencyResult & { name: string };
          }
        })
      );

      const dependencies = dependencyResults.reduce<Record<string, TimedDependencyResult>>((acc, result) => {
        acc[result.name] = {
          status: result.status,
          message: result.message,
          latencyMs: result.latencyMs,
          checkedAt: result.checkedAt
        } satisfies TimedDependencyResult;
        return acc;
      }, {});

      const hasUnavailable = dependencyResults.some((result) => result.status === "unavailable");
      const hasDegraded = dependencyResults.some((result) => result.status === "degraded");

      const overallStatus: DependencyStatus = hasUnavailable ? "unavailable" : hasDegraded ? "degraded" : "available";

      const versionInfo = getVersionInfo();

      const healthPayload = {
        status: overallStatus === "available" ? "ok" : overallStatus,
        version: versionInfo.version,
        dependencies: {
          postgres: dependencies.postgres ?? { status: "unavailable" as const },
          redis: dependencies.redis ?? { status: "unavailable" as const }
        },
        observedAt
      } satisfies Parameters<typeof restSchemas.health.response.parse>[0];

      const response = restSchemas.health.response.parse(healthPayload);

      const httpStatus = httpStatusFor(overallStatus);
      if (overallStatus !== "available") {
        logger.warn?.({ status: response.status, dependencies: response.dependencies }, "health.status_changed");
      } else {
        logger.debug?.({ status: response.status }, "health.check");
      }

      res.status(httpStatus).json(response);
    } catch (error) {
      logger.error?.({ err: error }, "health.check_failed");
      next(error);
    }
  });

  return router;
}
