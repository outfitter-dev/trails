import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  findTrailsProjectRoot,
  resolveTrailsProjectRoot,
} from '../trails-conventions.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), 'trails-conventions-'));

describe('Trails project root conventions', () => {
  test('walks up from nested cwd to the nearest root config marker', () => {
    const root = makeTempDir();
    try {
      const nested = join(root, 'packages', 'app', 'src');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, 'trails.config.ts'), 'export default {};\n');

      expect(findTrailsProjectRoot({ startDir: nested })).toMatchObject({
        marker: 'config',
        markerPath: join(root, 'trails.config.ts'),
        rootDir: root,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('recognizes data-format root config markers', () => {
    const root = makeTempDir();
    try {
      const nested = join(root, 'packages', 'app', 'src');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, 'trails.config.json'), '{}\n');

      expect(findTrailsProjectRoot({ startDir: nested })).toMatchObject({
        marker: 'config',
        markerPath: join(root, 'trails.config.json'),
        rootDir: root,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('prefers the nearest committed project marker in nested projects', () => {
    const workspace = makeTempDir();
    try {
      const member = join(workspace, 'packages', 'app');
      const nested = join(member, 'src', 'feature');
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(workspace, 'trails.config.ts'),
        'export default {};\n'
      );
      writeFileSync(join(member, 'trails.lock'), '{}\n');

      expect(findTrailsProjectRoot({ startDir: nested })).toMatchObject({
        marker: 'lock',
        markerPath: join(member, 'trails.lock'),
        rootDir: member,
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test('does not treat a bare .trails directory as a root marker', () => {
    const root = makeTempDir();
    try {
      const nested = join(root, 'src');
      mkdirSync(join(root, '.trails', 'rules'), { recursive: true });
      mkdirSync(nested, { recursive: true });

      expect(findTrailsProjectRoot({ startDir: nested })).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('does not treat a local override alone as a root marker', () => {
    const root = makeTempDir();
    try {
      const nested = join(root, 'packages', 'app');
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(root, 'trails.config.local.ts'),
        'export default {};\n'
      );

      expect(findTrailsProjectRoot({ startDir: nested })).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('recognizes source-shaped projects without requiring control files', () => {
    const root = makeTempDir();
    try {
      const sourceRoot = join(root, 'src', 'trails');
      const nested = join(sourceRoot, 'features');
      mkdirSync(nested, { recursive: true });

      expect(findTrailsProjectRoot({ startDir: nested })).toMatchObject({
        marker: 'source',
        markerPath: sourceRoot,
        rootDir: root,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('treats source-shaped projects as fallback below committed workspace markers', () => {
    const workspace = makeTempDir();
    try {
      const member = join(workspace, 'packages', 'app');
      const sourceRoot = join(member, 'src', 'trails');
      const nested = join(sourceRoot, 'features');
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(workspace, 'trails.config.ts'),
        'export default {};\n'
      );

      expect(findTrailsProjectRoot({ startDir: nested })).toMatchObject({
        marker: 'config',
        markerPath: join(workspace, 'trails.config.ts'),
        rootDir: workspace,
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test('ignores directory-shaped config and lock marker lookalikes', () => {
    const root = makeTempDir();
    try {
      const nested = join(root, 'src');
      mkdirSync(join(root, 'trails.config.ts'), { recursive: true });
      mkdirSync(join(root, 'trails.lock'), { recursive: true });
      mkdirSync(nested, { recursive: true });

      expect(findTrailsProjectRoot({ startDir: nested })).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('explicit roots win over discovered parent markers', () => {
    const root = makeTempDir();
    try {
      const explicit = join(root, 'scratch');
      const nested = join(root, 'packages', 'app', 'src');
      mkdirSync(explicit, { recursive: true });
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, 'trails.config.ts'), 'export default {};\n');

      expect(
        resolveTrailsProjectRoot({
          explicitRootDir: explicit,
          startDir: nested,
        })
      ).toMatchObject({
        marker: 'explicit',
        rootDir: explicit,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('falls back to the resolved start directory when no marker exists', () => {
    const root = makeTempDir();
    try {
      const nested = join(root, 'loose');
      mkdirSync(nested, { recursive: true });

      expect(resolveTrailsProjectRoot({ startDir: nested })).toMatchObject({
        marker: 'fallback',
        rootDir: resolve(nested),
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('stops discovery at the inclusive collection boundary', () => {
    const root = makeTempDir();
    try {
      const boundary = join(root, 'worktree');
      const nested = join(boundary, 'packages', 'app');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, 'trails.config.ts'), 'export default {};\n');

      expect(
        findTrailsProjectRoot({ boundaryDir: boundary, startDir: nested })
      ).toBeUndefined();
      expect(
        resolveTrailsProjectRoot({ boundaryDir: boundary, startDir: nested })
      ).toMatchObject({ marker: 'fallback', rootDir: resolve(nested) });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('rejects a discovery start outside the collection boundary', () => {
    const root = makeTempDir();
    try {
      const boundary = join(root, 'worktree');
      const outside = join(root, 'outside');
      mkdirSync(boundary, { recursive: true });
      mkdirSync(outside, { recursive: true });

      expect(() =>
        findTrailsProjectRoot({ boundaryDir: boundary, startDir: outside })
      ).toThrow('outside collection boundary');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('rejects a discovery start that escapes through a boundary symlink', () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    try {
      const boundary = join(root, 'worktree');
      mkdirSync(boundary, { recursive: true });
      writeFileSync(join(outside, 'trails.config.ts'), 'export default {};\n');
      const linkedStart = join(boundary, 'linked-outside');
      symlinkSync(outside, linkedStart, 'dir');

      expect(() =>
        findTrailsProjectRoot({ boundaryDir: boundary, startDir: linkedStart })
      ).toThrow('outside collection boundary');
    } finally {
      rmSync(outside, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('walks canonical ancestry from an external alias into the boundary', () => {
    const root = makeTempDir();
    const aliasRoot = makeTempDir();
    try {
      const boundary = join(root, 'worktree');
      const appRoot = join(boundary, 'apps', 'demo');
      mkdirSync(appRoot, { recursive: true });
      writeFileSync(join(boundary, 'trails.config.ts'), 'export default {};\n');
      const linkedStart = join(aliasRoot, 'linked-demo');
      symlinkSync(appRoot, linkedStart, 'dir');

      expect(
        findTrailsProjectRoot({ boundaryDir: boundary, startDir: linkedStart })
      ).toMatchObject({
        marker: 'config',
        markerPath: join(boundary, 'trails.config.ts'),
        rootDir: boundary,
      });
    } finally {
      rmSync(aliasRoot, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });
});
