import { AppConfig, getConfig } from "./config.js";
import { initializePostgres, closePostgres, PostgresClient, getPostgresClient } from "./postgres.js";
import { initializeRedis, closeRedis, getRedisClient } from "./redis.js";
import type { Pool } from "pg";
import type { RedisClientType } from "redis";

export interface Container {
  config: AppConfig;
  postgres: Pool;
  redis: RedisClientType;
  getPostgresClient: () => Promise<PostgresClient>;
  getRedisClient: () => RedisClientType;
}

let container: Container | null = null;

export async function initializeContainer(): Promise<Container> {
  if (container) {
    return container;
  }

  const config = getConfig();
  
  // Initialize infrastructure
  const postgres = await initializePostgres();
  const redis = await initializeRedis();

  container = {
    config,
    postgres,
    redis,
    getPostgresClient,
    getRedisClient,
  };

  return container;
}

export function getContainer(): Container {
  if (!container) {
    throw new Error("Container not initialized. Call initializeContainer() first.");
  }
  return container;
}

export async function shutdownContainer(): Promise<void> {
  if (container) {
    await Promise.all([
      closePostgres(),
      closeRedis(),
    ]);
    container = null;
  }
}

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  await shutdownContainer();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdownContainer();
  process.exit(0);
});