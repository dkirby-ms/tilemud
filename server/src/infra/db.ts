import { Pool } from "pg";
import type { PoolClient, QueryResult } from "pg";
import { getConfig } from "./config.js";

let pool: Pool | null = null;

function buildPool(): Pool {
  const { databaseUrl } = getConfig();
  const poolConfig = {
    connectionString: databaseUrl,
    max: Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10),
    idleTimeoutMillis: Number.parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? "10000", 10)
  };

  return new Pool(poolConfig);
}

export function getDbPool(): Pool {
  if (!pool) {
    pool = buildPool();
  }
  return pool;
}

export async function withDbClient<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDbPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const result: QueryResult = await withDbClient((client) => client.query("SELECT 1"));
    return result.rowCount === 1;
  } catch (error) {
    console.error("Database health check failed", error);
    return false;
  }
}

export async function shutdownDatabase(): Promise<void> {
  if (pool) {
    const instance = pool;
    pool = null;
    await instance.end();
  }
}

process.on("SIGINT", () => {
  void shutdownDatabase();
});

process.on("SIGTERM", () => {
  void shutdownDatabase();
});
