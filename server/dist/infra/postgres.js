import { Pool } from "pg";
import { getConfig } from "./config.js";
let pool = null;
export async function initializePostgres() {
    if (pool) {
        return pool;
    }
    const config = getConfig();
    const poolConfig = {
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
    }
    catch (error) {
        throw new Error(`Failed to connect to PostgreSQL: ${error}`);
    }
    return pool;
}
export async function getPostgresClient() {
    if (!pool) {
        throw new Error("PostgreSQL pool not initialized. Call initializePostgres() first.");
    }
    const client = await pool.connect();
    return {
        query: client.query.bind(client),
        release: () => client.release(),
    };
}
export async function healthCheckPostgres() {
    try {
        if (!pool) {
            return false;
        }
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        return true;
    }
    catch {
        return false;
    }
}
export async function closePostgres() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
export function getPool() {
    return pool;
}
//# sourceMappingURL=postgres.js.map