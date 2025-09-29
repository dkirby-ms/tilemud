import { createClient, RedisClientType } from "redis";
import { getConfig } from "./config.js";

let client: RedisClientType | null = null;

export async function initializeRedis(): Promise<RedisClientType> {
  if (client) {
    return client;
  }

  const config = getConfig();
  
  client = createClient({
    url: config.redisUrl,
    socket: {
      connectTimeout: 5000,
      lazyConnect: true,
    },
  });

  client.on("error", (error) => {
    console.error("Redis client error:", error);
  });

  client.on("connect", () => {
    console.log("Redis client connected");
  });

  client.on("disconnect", () => {
    console.log("Redis client disconnected");
  });

  await client.connect();

  // Test the connection
  try {
    await client.ping();
  } catch (error) {
    throw new Error(`Failed to connect to Redis: ${error}`);
  }

  return client;
}

export function getRedisClient(): RedisClientType {
  if (!client) {
    throw new Error("Redis client not initialized. Call initializeRedis() first.");
  }
  return client;
}

export async function healthCheckRedis(): Promise<boolean> {
  try {
    if (!client || !client.isOpen) {
      return false;
    }
    
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

// Graceful shutdown handler
process.on("SIGINT", async () => {
  await closeRedis();
});

process.on("SIGTERM", async () => {
  await closeRedis();
});