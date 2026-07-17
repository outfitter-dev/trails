import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { partitionFormatTargets } from '../format-staged.ts';

describe('format-staged', () => {
  test('partitions code and JSON inputs', () => {
    expect(
      partitionFormatTargets([
        'src/app.ts',
        'src/app.test.tsx',
        'package.json',
        'tsconfig.jsonc',
        'README.md',
      ])
    ).toEqual({
      code: ['src/app.ts', 'src/app.test.tsx'],
      json: ['package.json', 'tsconfig.jsonc'],
    });
  });

  test('formats JSON-only inputs without invoking the code lint path', () => {
    const root = mkdtempSync(join(tmpdir(), 'format-staged-'));
    const jsonPath = join(root, 'package.json');
    writeFileSync(jsonPath, '{"b":1,"a":2}\n');

    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, 'scripts/format-staged.ts', jsonPath],
        cwd: resolve(import.meta.dir, '..', '..'),
        stderr: 'pipe',
        stdout: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(jsonPath, 'utf8')).toBe(
        '{\n  "a": 2,\n  "b": 1\n}\n'
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('accepts a JSON-only batch excluded by formatter configuration', () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        'scripts/format-staged.ts',
        '.trails/regrade/history/generated.json',
      ],
      cwd: resolve(import.meta.dir, '..', '..'),
      stderr: 'pipe',
      stdout: 'pipe',
    });

    expect(result.exitCode).toBe(0);
  });

  test('still fails for invalid matched JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'format-staged-invalid-'));
    const jsonPath = join(root, 'package.json');
    writeFileSync(jsonPath, '{invalid}\n');

    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, 'scripts/format-staged.ts', jsonPath],
        cwd: resolve(import.meta.dir, '..', '..'),
        stderr: 'pipe',
        stdout: 'pipe',
      });

      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
