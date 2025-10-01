import "../infra/envBootstrap.js"; // ensure env vars loaded before config usage
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPostgresClient, initializePostgres } from "../infra/postgres.js";
import { getConfig } from "../infra/config.js";
const DEFAULT_DIR = path.resolve(fileURLToPath(import.meta.url), "../../../../infrastructure/migrations");
export async function runMigrations(options = {}) {
    const logger = options.logger ?? console;
    const migrationsDir = options.migrationsDir ?? DEFAULT_DIR;
    const config = getConfig();
    await initializePostgres();
    const client = await getPostgresClient();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS _migrations(\n      id TEXT PRIMARY KEY,\n      filename TEXT NOT NULL,\n      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n    )`);
        const entries = await readdir(migrationsDir);
        const migrations = [];
        for (const entry of entries) {
            if (!entry.endsWith(".sql"))
                continue;
            const match = /^(\d+)_.*\.sql$/.exec(entry);
            if (!match)
                continue;
            const id = match[1];
            const fullPath = path.join(migrationsDir, entry);
            const sql = await readFile(fullPath, "utf8");
            migrations.push({ id, filename: entry, fullPath, sql });
        }
        migrations.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        for (const migration of migrations) {
            const applied = await client.query("SELECT 1 FROM _migrations WHERE id = $1", [migration.id]);
            if (applied.rowCount && applied.rowCount > 0) {
                logger.debug?.("migration.skip", { id: migration.id, filename: migration.filename });
                continue;
            }
            logger.info?.("migration.apply.begin", { id: migration.id, filename: migration.filename });
            try {
                await client.query("BEGIN");
                await client.query(migration.sql);
                await client.query("INSERT INTO _migrations(id, filename) VALUES($1,$2)", [migration.id, migration.filename]);
                await client.query("COMMIT");
                logger.info?.("migration.apply.success", { id: migration.id });
            }
            catch (err) {
                await client.query("ROLLBACK");
                logger.error?.("migration.apply.failed", { id: migration.id, error: err });
                throw err;
            }
        }
    }
    finally {
        client.release();
    }
    logger.info?.("migrations.complete", { databaseUrl: config.databaseUrl });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations().catch((err) => {
        console.error("Migration run failed", err);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=run-migrations.js.map