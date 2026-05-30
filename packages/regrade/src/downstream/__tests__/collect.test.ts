import { describe, expect, test } from 'bun:test';
import { executeTrail } from '@ontrails/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import {
  classifyDownstreamEntry,
  collectDownstreamSources,
  collectDownstreamSourcesTrail,
} from '../collect.js';

describe('classifyDownstreamEntry', () => {
  test('collects supported source extensions', () => {
    expect(classifyDownstreamEntry('signal.ts', 'file')).toEqual({
      action: 'collect',
    });
    expect(classifyDownstreamEntry('view.tsx', 'file')).toEqual({
      action: 'collect',
    });
  });

  test('skips unsupported extensions with a reason', () => {
    expect(classifyDownstreamEntry('README.md', 'file')).toEqual({
      action: 'skip',
      reason: 'unsupported-extension',
    });
    expect(classifyDownstreamEntry('Makefile', 'file')).toEqual({
      action: 'skip',
      reason: 'unsupported-extension',
    });
  });

  test('recurses into ordinary directories and skips ignored ones', () => {
    expect(classifyDownstreamEntry('src', 'directory')).toEqual({
      action: 'recurse',
    });
    for (const ignored of [
      'node_modules',
      'dist',
      '.turbo',
      '.git',
      '.trails',
    ]) {
      expect(classifyDownstreamEntry(ignored, 'directory')).toEqual({
        action: 'skip',
        reason: 'ignored-directory',
      });
    }
  });

  test('skips non-file non-directory entries', () => {
    expect(classifyDownstreamEntry('socket', 'other')).toEqual({
      action: 'skip',
      reason: 'unsupported-entry',
    });
  });

  test('honors custom extension and ignored-directory options', () => {
    expect(
      classifyDownstreamEntry('app.js', 'file', { extensions: ['.js'] })
    ).toEqual({ action: 'collect' });
    expect(
      classifyDownstreamEntry('build', 'directory', {
        ignoredDirectories: ['build'],
      })
    ).toEqual({ action: 'skip', reason: 'ignored-directory' });
  });
});

const writeFixture = (): string => {
  // Scratch under the OS temp root, not the package tree, so a concurrent
  // collector run never walks another test's scratch dir and an interrupted
  // run leaves nothing under `src/`.
  const root = mkdtempSync(join(tmpdir(), 'regrade-collect-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'src', 'nested'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'src', 'signal.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'view.tsx'), 'export const b = 2;\n');
  writeFileSync(join(root, 'src', 'README.md'), '# docs\n');
  writeFileSync(
    join(root, 'src', 'nested', 'ping.ts'),
    'export const c = 3;\n'
  );
  writeFileSync(join(root, 'node_modules', 'dep', 'index.ts'), 'export {};\n');
  writeFileSync(join(root, 'dist', 'out.ts'), 'export {};\n');
  return root;
};

describe('collectDownstreamSources', () => {
  test('collects supported sources deterministically and records skips', () => {
    const root = writeFixture();
    try {
      const collection = collectDownstreamSources(root);
      expect(collection).not.toBeNull();
      const result = collection as NonNullable<typeof collection>;

      expect(result.files.map((file) => file.path)).toEqual([
        'src/nested/ping.ts',
        'src/signal.ts',
        'src/view.tsx',
      ]);
      // node_modules and dist are skipped at the directory level — their
      // contents never appear as collected files.
      const skippedReasons = new Map(
        result.skipped.map((entry) => [entry.path, entry.reason])
      );
      expect(skippedReasons.get('node_modules')).toBe('ignored-directory');
      expect(skippedReasons.get('dist')).toBe('ignored-directory');
      expect(skippedReasons.get('src/README.md')).toBe('unsupported-extension');
      expect(
        result.files.some((file) => file.path.startsWith('node_modules/'))
      ).toBe(false);

      // Absolute paths resolve back under the root.
      for (const file of result.files) {
        expect(file.absolutePath.startsWith(root)).toBe(true);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('normalizes relative roots to preserve absolute file paths', () => {
    const root = writeFixture();
    try {
      const relativeRoot = relative(process.cwd(), root);
      const collection = collectDownstreamSources(relativeRoot);
      expect(collection).not.toBeNull();
      const result = collection as NonNullable<typeof collection>;

      expect(result.root).toBe(resolve(relativeRoot));
      expect(result.files[0]?.absolutePath).toBe(
        join(result.root, 'src', 'nested', 'ping.ts')
      );
      for (const file of result.files) {
        expect(file.absolutePath.startsWith(result.root)).toBe(true);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('returns null for a root that cannot be read', () => {
    expect(
      collectDownstreamSources(join(import.meta.dir, 'does-not-exist-xyz'))
    ).toBeNull();
  });
});

describe('collectDownstreamSourcesTrail', () => {
  test('returns Ok with the collection for a readable root', async () => {
    const root = writeFixture();
    try {
      const result = await executeTrail(collectDownstreamSourcesTrail, {
        root,
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // executeTrail returns Result<unknown, Error>; narrow the Ok value to
        // the trail's output shape for property access.
        const value = result.value as { files: { path: string }[] };
        expect(value.files.map((file) => file.path)).toEqual([
          'src/nested/ping.ts',
          'src/signal.ts',
          'src/view.tsx',
        ]);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('returns a NotFoundError for an unreadable root', async () => {
    const result = await executeTrail(collectDownstreamSourcesTrail, {
      root: join(import.meta.dir, 'does-not-exist-xyz'),
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('NotFoundError');
    }
  });
});
