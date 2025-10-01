import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';

describe('scripts parity', () => {
  test('no TS application scripts live outside src/scripts', () => {
    const root = path.resolve(__dirname, '../../..');
    const legacyDir = path.join(root, 'scripts');
    let entries: string[] = [];
    try {
      entries = readdirSync(legacyDir).filter(f => f.endsWith('.ts'));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err; // directory simply gone -> OK
    }
    expect(entries).toEqual([]);
  });
});
