import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { PermissionError, ValidationError } from '@ontrails/core';

import {
  createIsolatedExampleRoot,
  removeRootRelativeFileIfPresent,
  writeIsolatedExampleAppModule,
} from '../local-state-io.js';

const tempRoot = (): string =>
  join(
    tmpdir(),
    `trails-local-state-io-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

describe('local state I/O helpers', () => {
  test('removes root-relative files without escaping the root', () => {
    const root = tempRoot();

    try {
      const relativePath = '.trails/trails.db';
      const targetPath = join(root, relativePath);
      const outsideName = `${basename(root)}-outside.db`;
      const outsidePath = join(dirname(root), outsideName);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, '');
      writeFileSync(outsidePath, '');

      const removed = removeRootRelativeFileIfPresent(root, relativePath);
      expect(removed.isOk()).toBe(true);
      if (removed.isErr()) {
        throw removed.error;
      }
      expect(removed.value).toBe(true);
      expect(existsSync(targetPath)).toBe(false);

      const missing = removeRootRelativeFileIfPresent(root, relativePath);
      expect(missing.isOk()).toBe(true);
      if (missing.isErr()) {
        throw missing.error;
      }
      expect(missing.value).toBe(false);

      const escaped = removeRootRelativeFileIfPresent(
        root,
        `../${outsideName}`
      );
      expect(escaped.isErr()).toBe(true);
      if (escaped.isErr()) {
        expect(escaped.error).toBeInstanceOf(PermissionError);
      }
      expect(existsSync(outsidePath)).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(join(dirname(root), `${basename(root)}-outside.db`), {
        force: true,
      });
    }
  });

  test('recreates isolated example roots with constrained names', () => {
    const name = `local-state-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const root = createIsolatedExampleRoot(name);
    const markerPath = join(root, 'marker.txt');

    try {
      writeFileSync(markerPath, 'stale');
      const recreated = createIsolatedExampleRoot(name);

      expect(recreated).toBe(root);
      expect(existsSync(root)).toBe(true);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('rejects path-shaped isolated example names', () => {
    expect(() => createIsolatedExampleRoot('../outside')).toThrow(
      ValidationError
    );
  });

  test('requires absolute source modules for isolated example app wrappers', () => {
    const root = tempRoot();

    try {
      expect(() => writeIsolatedExampleAppModule(root, 'src/app.ts')).toThrow(
        ValidationError
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
