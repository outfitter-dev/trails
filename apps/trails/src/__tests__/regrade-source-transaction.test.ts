import type { RegradeReport } from '@ontrails/regrade';
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  regradeApplyErrorAfterRollback,
  snapshotRegradeSources,
} from '../regrade/source-transaction.js';

describe('Regrade source transactions', () => {
  test('restores earlier source phases after a later apply failure', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    const path = join(rootDir, 'vocabulary.md');
    try {
      writeFileSync(path, 'alpha\n');
      const report = {
        entries: [{ outcome: 'rewrite', path: 'vocabulary.md' }],
      } as RegradeReport;
      const snapshots = snapshotRegradeSources({ reports: [report], rootDir });
      expect(snapshots.isOk()).toBe(true);
      if (snapshots.isErr()) {
        throw snapshots.error;
      }

      writeFileSync(path, 'omega\n');
      const result = regradeApplyErrorAfterRollback(
        new Error('simulated later apply failure'),
        snapshots.value
      );

      expect(result.isErr()).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('alpha\n');
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('snapshots review entries that can contain safe rewrites', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    const path = join(rootDir, 'mixed.md');
    try {
      writeFileSync(path, 'alpha and ambiguousAlpha\n');
      const report = {
        entries: [{ outcome: 'needs-review', path: 'mixed.md' }],
      } as RegradeReport;
      const snapshots = snapshotRegradeSources({ reports: [report], rootDir });
      expect(snapshots.isOk()).toBe(true);
      if (snapshots.isErr()) {
        throw snapshots.error;
      }

      writeFileSync(path, 'omega and ambiguousAlpha\n');
      const result = regradeApplyErrorAfterRollback(
        new Error('simulated later apply failure'),
        snapshots.value
      );

      expect(result.isErr()).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('alpha and ambiguousAlpha\n');
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('restores rename endpoints that did not exist before apply', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    const sourcePath = join(rootDir, 'before.ts');
    const targetPath = join(rootDir, 'nested/after.ts');
    try {
      writeFileSync(sourcePath, 'export const before = true;\n');
      const report = {
        entries: [{ outcome: 'rewrite', path: 'before.ts' }],
      } as RegradeReport;
      const snapshots = snapshotRegradeSources({
        optionalPaths: ['nested/after.ts'],
        reports: [report],
        rootDir,
      });
      expect(snapshots.isOk()).toBe(true);
      if (snapshots.isErr()) {
        throw snapshots.error;
      }

      rmSync(sourcePath);
      mkdirSync(join(rootDir, 'nested'));
      writeFileSync(targetPath, 'export const after = true;\n');
      const result = regradeApplyErrorAfterRollback(
        new Error('simulated receipt failure'),
        snapshots.value
      );

      expect(result.isErr()).toBe(true);
      expect(readFileSync(sourcePath, 'utf8')).toBe(
        'export const before = true;\n'
      );
      expect(() => readFileSync(targetPath)).toThrow();
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('preserves executable mode when restoring a renamed source', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    const sourcePath = join(rootDir, 'before.js');
    const targetPath = join(rootDir, 'after.js');
    try {
      writeFileSync(sourcePath, '#!/usr/bin/env node\n');
      chmodSync(sourcePath, 0o755);
      const report = {
        entries: [{ outcome: 'rewrite', path: 'before.js' }],
      } as RegradeReport;
      const snapshots = snapshotRegradeSources({
        optionalPaths: ['after.js'],
        reports: [report],
        rootDir,
      });
      expect(snapshots.isOk()).toBe(true);
      if (snapshots.isErr()) {
        throw snapshots.error;
      }

      rmSync(sourcePath);
      writeFileSync(targetPath, '#!/usr/bin/env node\n');
      regradeApplyErrorAfterRollback(
        new Error('simulated receipt failure'),
        snapshots.value
      );

      expect(lstatSync(sourcePath).mode % 0o1000).toBe(0o755);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('rejects symbolic-link mutation before apply', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    try {
      writeFileSync(join(rootDir, 'target.ts'), 'export const old = true;\n');
      symlinkSync('target.ts', join(rootDir, 'linked.ts'));
      const report = {
        entries: [{ outcome: 'rewrite', path: 'linked.ts' }],
      } as RegradeReport;

      const snapshots = snapshotRegradeSources({ reports: [report], rootDir });

      expect(snapshots.isErr()).toBe(true);
      expect(lstatSync(join(rootDir, 'linked.ts')).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(rootDir, 'target.ts'), 'utf8')).toBe(
        'export const old = true;\n'
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('rejects a dangling symbolic-link rename endpoint before apply', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    try {
      symlinkSync('missing.ts', join(rootDir, 'linked.ts'));

      const snapshots = snapshotRegradeSources({
        optionalPaths: ['linked.ts'],
        reports: [],
        rootDir,
      });

      expect(snapshots.isErr()).toBe(true);
      expect(lstatSync(join(rootDir, 'linked.ts')).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('rejects mutation through a symbolic-link ancestor before apply', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    const outsideDir = mkdtempSync(
      join(tmpdir(), 'regrade-source-transaction-outside-')
    );
    try {
      writeFileSync(join(outsideDir, 'outside.ts'), 'keep outside\n');
      symlinkSync(outsideDir, join(rootDir, 'linked'));
      const report = {
        entries: [{ outcome: 'rewrite', path: 'linked/outside.ts' }],
      } as RegradeReport;

      const snapshots = snapshotRegradeSources({ reports: [report], rootDir });

      expect(snapshots.isErr()).toBe(true);
      expect(readFileSync(join(outsideDir, 'outside.ts'), 'utf8')).toBe(
        'keep outside\n'
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
      rmSync(outsideDir, { force: true, recursive: true });
    }
  });

  test('continues restoring later paths after one rollback failure', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'regrade-source-transaction-'));
    const blockedPath = join(rootDir, 'blocked.ts');
    const restoredPath = join(rootDir, 'restored.ts');
    try {
      writeFileSync(blockedPath, 'export const blocked = "before";\n');
      writeFileSync(restoredPath, 'export const restored = "before";\n');
      const report = {
        entries: [
          { outcome: 'rewrite', path: 'blocked.ts' },
          { outcome: 'rewrite', path: 'restored.ts' },
        ],
      } as RegradeReport;
      const snapshots = snapshotRegradeSources({ reports: [report], rootDir });
      expect(snapshots.isOk()).toBe(true);
      if (snapshots.isErr()) {
        throw snapshots.error;
      }

      rmSync(blockedPath);
      mkdirSync(blockedPath);
      writeFileSync(join(blockedPath, 'obstruction'), 'keep');
      writeFileSync(restoredPath, 'export const restored = "after";\n');
      const result = regradeApplyErrorAfterRollback(
        new Error('simulated receipt failure'),
        snapshots.value
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('source rollback failed');
        expect(JSON.stringify(result.error)).not.toContain(rootDir);
      }
      expect(readFileSync(restoredPath, 'utf8')).toBe(
        'export const restored = "before";\n'
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
