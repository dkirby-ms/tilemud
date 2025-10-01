import { describe, it, expect } from "vitest";
// Use relative import because tsconfig paths are limited to src for compilation context
import { loadConfig, clearConfigCache } from "../../src/infra/config.js";

describe("Environment configuration validation", () => {
  it("fails fast when required env vars are missing", () => {
    const ORIGINAL = { ...process.env };
    try {
      process.env.DATABASE_URL = "";
      process.env.REDIS_URL = "";
      process.env.PORT = ""; // invalid
      clearConfigCache();
      expect(() => loadConfig(process.env as any)).toThrow(/Invalid configuration/);
    } finally {
      process.env.DATABASE_URL = ORIGINAL.DATABASE_URL;
      process.env.REDIS_URL = ORIGINAL.REDIS_URL;
      process.env.PORT = ORIGINAL.PORT;
      clearConfigCache();
    }
  });
});
