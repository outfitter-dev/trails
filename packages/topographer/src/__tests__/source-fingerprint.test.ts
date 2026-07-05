import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveSourceFingerprint } from '../source-fingerprint.js';

const withFixtureDir = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'source-fingerprint-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

describe('deriveSourceFingerprint', () => {
  test('is stable for unchanged sources and changes on any content edit', () => {
    withFixtureDir((dir) => {
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1;\n');

      const first = deriveSourceFingerprint(dir);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(deriveSourceFingerprint(dir)).toBe(first);

      writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 2;\n');
      expect(deriveSourceFingerprint(dir)).not.toBe(first);
    });
  });

  test('changes when files are added or renamed', () => {
    withFixtureDir((dir) => {
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
      const first = deriveSourceFingerprint(dir);

      writeFileSync(join(dir, 'extra.ts'), 'export const b = 2;\n');
      const withExtra = deriveSourceFingerprint(dir);
      expect(withExtra).not.toBe(first);

      rmSync(join(dir, 'extra.ts'));
      writeFileSync(join(dir, 'renamed.ts'), 'export const b = 2;\n');
      expect(deriveSourceFingerprint(dir)).not.toBe(withExtra);
    });
  });

  test('ignores derived artifacts and excluded directories', () => {
    withFixtureDir((dir) => {
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
      const first = deriveSourceFingerprint(dir);

      writeFileSync(join(dir, 'trails.lock'), '{}\n');
      mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), '1;\n');
      mkdirSync(join(dir, 'dist'));
      writeFileSync(join(dir, 'dist', 'app.js'), '1;\n');
      mkdirSync(join(dir, '.trails-tmp'));
      writeFileSync(join(dir, '.trails-tmp', 'mirror.ts'), '1;\n');

      expect(deriveSourceFingerprint(dir)).toBe(first);
    });
  });
});
