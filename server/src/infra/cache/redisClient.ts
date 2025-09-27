import { createClient, RedisClientType } from 'redis';
import { config } from '../../config/env';

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  ping(): Promise<string>;
  flushall(): Promise<string>; // For testing only
  disconnect(): Promise<void>;
}

class RedisClientAdapter implements IRedisClient {
  private client: RedisClientType;
  private isConnected = false;

  constructor(client: RedisClientType) {
    this.client = client;
  }

  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    return await this.client.get(key);
  }

  async set(key: string, value: string, options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean }): Promise<string | null> {
    this.ensureConnected();
    if (options && Object.keys(options).length > 0) {
      return await this.client.set(key, value, options as any); // Type workaround for Redis client
    } else {
      return await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<number> {
    this.ensureConnected();
    return await this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    this.ensureConnected();
    return await this.client.exists(key);
  }

  async incr(key: string): Promise<number> {
    this.ensureConnected();
    return await this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    this.ensureConnected();
    return await this.client.decr(key);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    this.ensureConnected();
    return await this.client.expire(key, seconds);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.ensureConnected();
    return await this.client.hSet(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.ensureConnected();
    const result = await this.client.hGet(key, field);
    return result || null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.ensureConnected();
    return await this.client.hGetAll(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    this.ensureConnected();
    return await this.client.hDel(key, fields);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.ensureConnected();
    return await this.client.zAdd(key, { score, value: member });
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    this.ensureConnected();
    return await this.client.zRange(key, start, stop);
  }

  async zrem(key: string, member: string): Promise<number> {
    this.ensureConnected();
    return await this.client.zRem(key, member);
  }

  async zcard(key: string): Promise<number> {
    this.ensureConnected();
    return await this.client.zCard(key);
  }

  async ping(): Promise<string> {
    this.ensureConnected();
    return await this.client.ping();
  }

  async flushall(): Promise<string> {
    this.ensureConnected();
    return await this.client.flushAll();
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  private ensureConnected(): void {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected. Call connect() first.');
    }
  }

  markConnected(): void {
    this.isConnected = true;
  }
}

export class RedisClientFactory {
  private static instance: IRedisClient | null = null;

  static async create(): Promise<IRedisClient> {
    if (RedisClientFactory.instance) {
      return RedisClientFactory.instance;
    }

    const clientConfig: any = {
      socket: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
      },
      database: config.REDIS_DB,
    };
    
    if (config.REDIS_PASSWORD) {
      clientConfig.password = config.REDIS_PASSWORD;
    }

    const client = createClient(clientConfig);

    // Handle connection events
    client.on('error', (err) => {
      console.error('Redis Client Error:', err); // TODO: Use proper logger from T015
    });

    client.on('connect', () => {
      console.log('Redis Client Connected'); // TODO: Use proper logger from T015
    });

    client.on('ready', () => {
      console.log('Redis Client Ready'); // TODO: Use proper logger from T015
    });

    client.on('reconnecting', () => {
      console.log('Redis Client Reconnecting'); // TODO: Use proper logger from T015
    });

    try {
      await client.connect();
      const adapter = new RedisClientAdapter(client as RedisClientType);
      adapter.markConnected();
      
      // Health check
      const pong = await adapter.ping();
      if (pong !== 'PONG') {
        throw new Error(`Redis health check failed. Expected 'PONG', got '${pong}'`);
      }

      RedisClientFactory.instance = adapter;
      console.log('Redis client factory initialized successfully'); // TODO: Use proper logger from T015
      return adapter;
      
    } catch (error) {
      console.error('Failed to initialize Redis client:', error); // TODO: Use proper logger from T015
      await client.disconnect().catch(() => {}); // Ignore disconnect errors
      throw error;
    }
  }

  static async healthCheck(): Promise<boolean> {
    try {
      if (!RedisClientFactory.instance) {
        return false;
      }
      const pong = await RedisClientFactory.instance.ping();
      return pong === 'PONG';
    } catch (error) {
      console.error('Redis health check failed:', error); // TODO: Use proper logger from T015
      return false;
    }
  }

  static async shutdown(): Promise<void> {
    if (RedisClientFactory.instance) {
      await RedisClientFactory.instance.disconnect();
      RedisClientFactory.instance = null;
    }
  }

  // For testing only
  static reset(): void {
    RedisClientFactory.instance = null;
  }
}

// Convenience export
export const createRedisClient = RedisClientFactory.create;
export const redisHealthCheck = RedisClientFactory.healthCheck;