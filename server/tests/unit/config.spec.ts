import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, loadConfig } from "../../src/infra/config.js";

describe("config", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  };

  const unsetEnv = (key: string) => {
    delete process.env[key];
  };

  beforeEach(() => {
    restoreEnv();
    clearConfigCache();
  });

  afterEach(() => {
    restoreEnv();
    clearConfigCache();
    vi.resetModules();
  });

  it("throws descriptive error when required env is missing", () => {
  unsetEnv("DATABASE_URL");
  unsetEnv("REDIS_URL");
  unsetEnv("PORT");
  unsetEnv("LOG_LEVEL");

    expect(() => loadConfig()).toThrowError(/DATABASE_URL/);
  });

  it("returns parsed config when env vars are present", () => {
    process.env.DATABASE_URL = "postgres://test@localhost:5432/test";
    process.env.REDIS_URL = "redis://localhost:6379/0";
    process.env.PORT = "5000";
    process.env.LOG_LEVEL = "info";

    const config = loadConfig();

    expect(config).toEqual({
      databaseUrl: "postgres://test@localhost:5432/test",
      redisUrl: "redis://localhost:6379/0",
      port: 5000,
      logLevel: "info"
    });
  });
});
