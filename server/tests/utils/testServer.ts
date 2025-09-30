import { agent } from "supertest";
import { createApp } from "../../src/api/app.js";
import { initializeContainer, shutdownContainer, Container } from "../../src/infra/container.js";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type TestAgent = ReturnType<typeof agent>;

let testContainer: Container | null = null;

export async function createTestAgent(): Promise<TestAgent> {
  if (!testContainer) {
    // Initialize with test environment variables
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://tilemud:tilemud_dev_pw@localhost:5438/tilemud";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6380/0";
    process.env.PORT = process.env.PORT || "4000";
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || "debug";
    
    testContainer = await initializeContainer();
    await runMigrations(testContainer).catch((err) => {
      // eslint-disable-next-line no-console -- test setup
      console.error("Migration execution failed", err);
    });
    await seedTestData(testContainer).catch((err) => {
      // eslint-disable-next-line no-console -- test setup
      console.error("Test data seed failed", err);
    });
  }
  
  const app = createApp();
  return agent(app);
}

async function seedTestData(container: Container): Promise<void> {
  const pool = container.postgres;

  // Check if already seeded by querying one known player id
  const existing = await pool.query(`SELECT id FROM players WHERE id = '00000000-0000-0000-0000-0000000000aa'`);
  if (existing.rows.length > 0) {
    return; // already seeded
  }

  // Seed players
  const players = [
    { id: '00000000-0000-0000-0000-0000000000aa', display_name: 'OutcomePlayer', initiative_rank: 10 },
    { id: '00000000-0000-0000-0000-0000000000bb', display_name: 'MessagePlayer', initiative_rank: 20 },
    { id: '00000000-0000-0000-0000-0000000000cc', display_name: 'OtherPlayer', initiative_rank: 30 }
  ];
  for (const p of players) {
    await pool.query(
      `INSERT INTO players (id, display_name, initiative_rank, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.display_name, p.initiative_rank]
    );
  }

  // Seed outcomes referencing OutcomePlayer
  const outcomeId = '00000000-0000-0000-0000-000000000001';
  const participants = {
    players: [
      { id: players[0].id, displayName: 'OutcomePlayer', initiativeRank: 5, role: 'player', finalScore: 42 },
      { id: players[2].id, displayName: 'OtherPlayer', initiativeRank: 7, role: 'player', finalScore: 30 }
    ]
  };
  const outcomeJson = { winner: players[0].id, scores: { [players[0].id]: 42, [players[2].id]: 30 } };
  await pool.query(
    `INSERT INTO battle_outcomes (id, instance_id, ruleset_version, started_at, ended_at, duration_ms, participants_json, outcome_json, created_at)
     VALUES ($1,$2,$3,NOW() - INTERVAL '5 minutes', NOW(), 300000, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [outcomeId, randomUUID(), '1.0.0', JSON.stringify(participants), JSON.stringify(outcomeJson)]
  );

  // Seed messages for MessagePlayer inbound/outbound
  const messages = [
    { sender: players[1].id, recipient: players[2].id, content: 'hi out' },
    { sender: players[2].id, recipient: players[1].id, content: 'hi in' },
    { sender: players[1].id, recipient: players[2].id, content: 'another out' },
    { sender: players[2].id, recipient: players[1].id, content: 'another in' }
  ];
  for (const m of messages) {
    await pool.query(
      `INSERT INTO private_messages (id, sender_id, recipient_id, content, created_at)
       VALUES (gen_random_uuid(), $1,$2,$3, NOW() - INTERVAL '1 minute')`,
      [m.sender, m.recipient, m.content]
    );
  }
}

async function runMigrations(container: Container): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "../infrastructure/migrations");
  let entries: string[] = [];
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return; // no migrations directory (unexpected in repo) – skip
  }
  const sqlFiles = entries.filter((f) => /\.sql$/i.test(f)).sort();
  for (const file of sqlFiles) {
    const full = path.join(migrationsDir, file);
    const sql = await readFile(full, "utf8");
    // Execute as single multi-statement query; each migration file is idempotent
    try {
      await container.postgres.query(sql);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Migration ${file} failed`, err);
      throw err;
    }
  }
}

export async function getTestContainer(): Promise<Container> {
  if (!testContainer) {
    testContainer = await initializeContainer();
  }
  return testContainer;
}

export async function cleanupTestServer(): Promise<void> {
  if (testContainer) {
    await shutdownContainer();
    testContainer = null;
  }
}
