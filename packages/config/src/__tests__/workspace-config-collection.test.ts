import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SourceCollectionDecision } from '@ontrails/source';

import { collectStableSourceTree } from '../workspace-config-collection.js';

const withTempRoot = (execute: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'config-stable-collection-'));
  try {
    execute(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

const recurseOrCollect = (kind: string): SourceCollectionDecision =>
  kind === 'directory' ? { action: 'recurse' } : { action: 'collect' };

describe('collectStableSourceTree', () => {
  test('rescans past a directory removed mid-walk', () => {
    withTempRoot((root) => {
      mkdirSync(join(root, 'transient'));
      writeFileSync(join(root, 'kept.ts'), 'export {};\n');
      let attempts = 0;

      const collection = collectStableSourceTree(root, () => {
        attempts += 1;
        return (entry) => {
          if (entry.path === 'transient') {
            rmSync(join(root, 'transient'), { force: true, recursive: true });
          }
          return recurseOrCollect(entry.kind);
        };
      });

      expect(attempts).toBe(2);
      expect(collection?.files.map((file) => file.path)).toEqual(['kept.ts']);
      expect(collection?.skipped).toEqual([]);
    });
  });

  test('finds a config marker in a directory renamed mid-walk', () => {
    withTempRoot((root) => {
      mkdirSync(join(root, 'old'));
      writeFileSync(join(root, 'old', 'trails.config.ts'), 'export {};\n');

      const collection = collectStableSourceTree(root, () => (entry) => {
        if (entry.path === 'old') {
          renameSync(join(root, 'old'), join(root, 'new'));
        }
        return recurseOrCollect(entry.kind);
      });

      expect(collection?.files.map((file) => file.path)).toEqual([
        'new/trails.config.ts',
      ]);
      expect(collection?.skipped).toEqual([]);
    });
  });

  test('keeps persistent churn visible after bounded retries', () => {
    withTempRoot((root) => {
      let attempts = 0;

      const collection = collectStableSourceTree(root, () => {
        attempts += 1;
        mkdirSync(join(root, 'churn'));
        return (entry) => {
          if (entry.path === 'churn') {
            rmSync(join(root, 'churn'), { force: true, recursive: true });
          }
          return recurseOrCollect(entry.kind);
        };
      });

      expect(attempts).toBe(3);
      expect(collection?.skipped).toEqual([
        { path: 'churn', reason: 'vanished-directory' },
      ]);
    });
  });
});
