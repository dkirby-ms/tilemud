import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

const baselineEnv = { ...process.env };

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, baselineEnv);
};

const ensureDefaults = () => {
  // Use infrastructure connection details  
  process.env.DATABASE_URL ??= "postgres://tilemud:tilemud_dev_pw@localhost:5438/tilemud";
  process.env.REDIS_URL ??= "redis://localhost:6380/0";
  process.env.PORT ??= "4000";
  process.env.LOG_LEVEL ??= "debug";
};

beforeAll(() => {
  restoreEnv();
  ensureDefaults();
});

beforeEach(() => {
  restoreEnv();
  ensureDefaults();
});

afterEach(() => {
  restoreEnv();
});

afterAll(() => {
  restoreEnv();
});

vi.mock("pino", () => {
  const noop = vi.fn();
  return {
    default: () => ({
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      trace: noop,
      fatal: noop,
      child: () => ({
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        trace: noop,
        fatal: noop
      })
    })
  };
});
