import type { RegradeReport } from '@ontrails/regrade';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
