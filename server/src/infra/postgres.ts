import pg from "pg";
import type { PoolClient, Pool as PoolType } from "pg";
const { Pool } = pg;
import { getConfig } from "./config.js";

let pool: PoolType | null = null;

const pgTypes = (pg as unknown as { types: { setTypeParser: (oid: number, parser: (value: string) => unknown) => void } }).types;

const parseInteger = (value: string): number => Number.parseInt(value, 10);

pgTypes.setTypeParser(20, parseInteger); // int8
pgTypes.setTypeParser(21, parseInteger); // int2
pgTypes.setTypeParser(23, parseInteger); // int4

export interface PostgresClient {
  query: PoolClient["query"];
  release: () => void;
}

export async function initializePostgres(): Promise<PoolType> {
  if (pool) {
    return pool;
  }

  const config = getConfig();
  
  const poolConfig: ConstructorParameters<typeof Pool>[0] = {
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };

  pool = new Pool(poolConfig);

  // Test the connection
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
  } catch (error) {
    throw new Error(`Failed to connect to PostgreSQL: ${error}`);
  }

  return pool;
}

export async function getPostgresClient(): Promise<PostgresClient> {
  if (!pool) {
    throw new Error("PostgreSQL pool not initialized. Call initializePostgres() first.");
  }

  const client = await pool.connect();
  
  return {
    query: client.query.bind(client),
    release: () => client.release(),
  };
}

export async function healthCheckPostgres(): Promise<boolean> {
  try {
    if (!pool) {
      return false;
    }
    
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function getPool(): PoolType | null {
  return pool;
}