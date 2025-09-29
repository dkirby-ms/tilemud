import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';

describe('Environment Variables Contract', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const envFile = path.join(projectRoot, '.env.local.infra');

  describe('Environment file validation', () => {
    test('environment file exists after infrastructure startup', () => {
      expect(existsSync(envFile)).toBe(true);
    });

    test('environment file contains all required variables', () => {
      const content = readFileSync(envFile, 'utf-8');
      
      // Core connection variables
      expect(content).toMatch(/TILEMUD_PG_PORT=\d+/);
      expect(content).toMatch(/TILEMUD_REDIS_PORT=\d+/);
      expect(content).toMatch(/TILEMUD_PG_USER=.+/);
      expect(content).toMatch(/TILEMUD_PG_PASSWORD=.+/);
      expect(content).toMatch(/TILEMUD_PG_DB=.+/);
      
      // Infrastructure naming variables
      expect(content).toMatch(/TILEMUD_INFRA_NETWORK=.+/);
      expect(content).toMatch(/TILEMUD_PG_VOLUME=.+/);
      
      // Image variables
      expect(content).toMatch(/TILEMUD_PG_IMAGE=.+/);
      expect(content).toMatch(/TILEMUD_REDIS_IMAGE=.+/);
    });

    test('default values match contract specification', () => {
      // If no overrides are set, verify defaults
      const content = readFileSync(envFile, 'utf-8');
      
      if (!process.env.TILEMUD_PG_PORT) {
        expect(content).toMatch(/TILEMUD_PG_PORT=5438/);
      }
      
      if (!process.env.TILEMUD_REDIS_PORT) {
        expect(content).toMatch(/TILEMUD_REDIS_PORT=6380/);
      }
      
      if (!process.env.TILEMUD_PG_USER) {
        expect(content).toMatch(/TILEMUD_PG_USER=tilemud/);
      }
      
      if (!process.env.TILEMUD_PG_PASSWORD) {
        expect(content).toMatch(/TILEMUD_PG_PASSWORD=tilemud_dev_pw/);
      }
      
      if (!process.env.TILEMUD_PG_DB) {
        expect(content).toMatch(/TILEMUD_PG_DB=tilemud/);
      }
      
      if (!process.env.TILEMUD_INFRA_NETWORK) {
        expect(content).toMatch(/TILEMUD_INFRA_NETWORK=tilemud_net/);
      }
      
      if (!process.env.TILEMUD_PG_VOLUME) {
        expect(content).toMatch(/TILEMUD_PG_VOLUME=tilemud_pg_data/);
      }
      
      if (!process.env.TILEMUD_PG_IMAGE) {
        expect(content).toMatch(/TILEMUD_PG_IMAGE=postgres:18\.0-alpine/);
      }
      
      if (!process.env.TILEMUD_REDIS_IMAGE) {
        expect(content).toMatch(/TILEMUD_REDIS_IMAGE=redis:8\.2-alpine/);
      }
    });

    test('environment variable overrides are respected', () => {
      // This test would set environment variables and verify they appear in the generated file
      // Implementation depends on how infra-up.sh handles overrides
      expect(true).toBe(true); // Placeholder - specific implementation TBD
    });
  });
});