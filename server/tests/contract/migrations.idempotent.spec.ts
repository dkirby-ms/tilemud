import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'vitest';

// This test validates that running the migration script twice is idempotent.
// It uses a throwaway database name by appending a UUID, assuming DATABASE_URL points to a template DB name.
// If DATABASE_URL not set, we skip (contract environment test elsewhere ensures presence in real runs).

function withTempDatabaseUrl(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;
  // naive: replace last path segment with random one
  try {
    const url = new URL(base);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) parts.push('tilemud');
    parts[parts.length - 1] = parts[parts.length - 1] + '_test_' + randomUUID().replace(/-/g, '').slice(0, 8);
    url.pathname = '/' + parts.join('/');
    return url.toString();
  } catch {
    return undefined;
  }
}

describe('migrations idempotency', () => {
  const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
  // Using runtime conditional skip because Vitest's test.skipIf may not be available in current version.
  (skip ? test.skip : test)('applies cleanly twice', () => {
    const tempUrl = withTempDatabaseUrl();
    if (!tempUrl) return; // skip
    const env = { ...process.env, DATABASE_URL: tempUrl };
    const script = 'npm run migrate';
    // First run
    execSync(script, { stdio: 'inherit', env });
    // Second run should no-op without throwing
    execSync(script, { stdio: 'inherit', env });
  });
});
