import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { NotFoundError } from '../errors.js';
import {
  findWorkspacePackage,
  findWorkspaceRoot,
  isInsideWorkspace,
  deriveRelativePath,
  listWorkspacePackageDirs,
  listWorkspacePackages,
  listWorkspacePatterns,
} from '../workspace.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTempDir = (): string =>
  mkdtempSync(join(tmpdir(), 'trails-ws-test-'));

const writeJson = (dir: string, filename: string, data: unknown): void => {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2));
};

/** Set up nested workspaces: outer > inner > packages/lib. Returns the deepest path. */
const setupNestedWorkspaces = (outer: string): string => {
  writeJson(outer, 'package.json', { name: 'outer', workspaces: ['inner/*'] });
  const inner = join(outer, 'inner', 'nested');
  mkdirSync(inner, { recursive: true });
  writeJson(join(outer, 'inner'), 'package.json', {
    name: 'inner',
    workspaces: ['packages/*'],
  });
  const deep = join(inner, 'packages', 'lib');
  mkdirSync(deep, { recursive: true });
  return deep;
};

// ---------------------------------------------------------------------------
// findWorkspaceRoot
// ---------------------------------------------------------------------------

describe('findWorkspaceRoot', () => {
  test('finds workspace root when started inside a nested directory', async () => {
    const root = createTempDir();
    try {
      writeJson(root, 'package.json', {
        name: 'my-workspace',
        workspaces: ['packages/*'],
      });

      const nested = join(root, 'packages', 'core', 'src');
      mkdirSync(nested, { recursive: true });

      const result = await findWorkspaceRoot(nested);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(resolve(root));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('skips package.json without workspaces field', async () => {
    const root = createTempDir();
    try {
      // Root has workspaces
      writeJson(root, 'package.json', {
        name: 'root',
        workspaces: ['packages/*'],
      });

      // Nested package has no workspaces
      const pkg = join(root, 'packages', 'core');
      mkdirSync(pkg, { recursive: true });
      writeJson(pkg, 'package.json', { name: '@scope/core' });

      const result = await findWorkspaceRoot(pkg);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(resolve(root));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('returns the closest workspace root', async () => {
    const outer = createTempDir();
    try {
      const deep = setupNestedWorkspaces(outer);
      const result = await findWorkspaceRoot(deep);
      expect(result.isOk()).toBe(true);
      // Should find inner workspace first (closest ancestor)
      expect(result.unwrap()).toBe(resolve(join(outer, 'inner')));
    } finally {
      rmSync(outer, { force: true, recursive: true });
    }
  });

  test('returns NotFoundError when no workspace root exists', async () => {
    const dir = createTempDir();
    try {
      // No package.json at all
      const result = await findWorkspaceRoot(dir);
      // This will either find one above in the actual filesystem or fail.
      // We walk up to /, so it depends on the host. Use a deep isolated path.
      // Since tmpdir might be under a workspace, let's just check the type
      // is correct if it does fail. When the host has a workspace root above
      // tmpdir, the result will be Ok — both outcomes are acceptable.
      const isAcceptable =
        // oxlint-disable-next-line no-conditional-in-test -- host-dependent: tmpdir may sit under a real workspace
        result.isOk() ||
        (result as unknown as { error: Error }).error instanceof NotFoundError;
      expect(isAcceptable).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('handles malformed package.json gracefully', async () => {
    const root = createTempDir();
    try {
      // Write invalid JSON
      writeFileSync(join(root, 'package.json'), 'not json {{{');

      const result = await findWorkspaceRoot(root);
      // Should not throw — just skip and keep walking.
      // On some hosts tmpdir sits under a real workspace, so Ok is valid too.
      const isAcceptable =
        // oxlint-disable-next-line no-conditional-in-test -- host-dependent: tmpdir may sit under a real workspace
        result.isOk() ||
        (result as unknown as { error: Error }).error instanceof NotFoundError;
      expect(isAcceptable).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// workspace package discovery
// ---------------------------------------------------------------------------

describe('workspace package discovery', () => {
  test('lists patterns from array and packages-object manifest forms', () => {
    expect(
      listWorkspacePatterns({ workspaces: ['packages/*', 123, 'apps/demo'] })
    ).toEqual(['packages/*', 'apps/demo']);
    expect(
      listWorkspacePatterns({
        workspaces: { packages: ['adapters/*', false, 'apps/*'] },
      })
    ).toEqual(['adapters/*', 'apps/*']);
    expect(
      listWorkspacePatterns({ workspaces: { nope: ['packages/*'] } })
    ).toEqual([]);
  });

  test('lists exact and one-level workspace package directories only', () => {
    const root = createTempDir();
    try {
      const packagesDir = join(root, 'packages');
      const core = join(packagesDir, 'core');
      const docs = join(packagesDir, 'docs');
      const nested = join(packagesDir, 'nested', 'child');
      const app = join(root, 'apps', 'demo');
      mkdirSync(core, { recursive: true });
      mkdirSync(docs, { recursive: true });
      mkdirSync(nested, { recursive: true });
      mkdirSync(app, { recursive: true });
      writeJson(core, 'package.json', { name: '@scope/core' });
      writeJson(nested, 'package.json', { name: '@scope/nested-child' });
      writeJson(app, 'package.json', { name: '@scope/app' });

      expect(
        listWorkspacePackageDirs(root, ['packages/*', 'apps/demo']).map((dir) =>
          dir.replace(root, '<root>')
        )
      ).toEqual(['<root>/packages/core', '<root>/apps/demo']);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('lists workspace packages with normalized metadata and stable ordering', () => {
    const root = createTempDir();
    try {
      writeJson(root, 'package.json', {
        name: 'root',
        workspaces: ['packages/*', 'apps/demo'],
      });
      mkdirSync(join(root, 'packages', 'b'), { recursive: true });
      mkdirSync(join(root, 'packages', 'a'), { recursive: true });
      mkdirSync(join(root, 'apps', 'demo'), { recursive: true });
      writeJson(join(root, 'packages', 'b'), 'package.json', {
        name: '@scope/b',
      });
      writeJson(join(root, 'packages', 'a'), 'package.json', {
        name: '@scope/a',
      });
      writeJson(join(root, 'apps', 'demo'), 'package.json', {
        name: '@scope/demo',
      });

      expect(
        listWorkspacePackages(root).map((workspacePackage) => ({
          name: workspacePackage.manifest.name,
          workspacePath: workspacePackage.workspacePath,
        }))
      ).toEqual([
        { name: '@scope/demo', workspacePath: 'apps/demo' },
        { name: '@scope/a', workspacePath: 'packages/a' },
        { name: '@scope/b', workspacePath: 'packages/b' },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('finds a workspace package by package name', () => {
    const root = createTempDir();
    try {
      writeJson(root, 'package.json', {
        name: 'root',
        workspaces: ['packages/*'],
      });
      mkdirSync(join(root, 'packages', 'core'), { recursive: true });
      writeJson(join(root, 'packages', 'core'), 'package.json', {
        name: '@scope/core',
      });

      expect(findWorkspacePackage(root, '@scope/core')?.workspacePath).toBe(
        'packages/core'
      );
      expect(findWorkspacePackage(root, '@scope/missing')).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// isInsideWorkspace
// ---------------------------------------------------------------------------

describe('isInsideWorkspace', () => {
  test('returns true for a file inside the workspace', () => {
    expect(
      isInsideWorkspace('/project/packages/core/src/index.ts', '/project')
    ).toBe(true);
  });

  test('returns false for a file outside the workspace', () => {
    expect(isInsideWorkspace('/other/file.ts', '/project')).toBe(false);
  });

  test('returns false for the workspace root itself', () => {
    // The root directory itself is not \"inside\" the workspace
    expect(isInsideWorkspace('/project', '/project')).toBe(false);
  });

  test('handles relative-looking paths by resolving them', () => {
    expect(
      isInsideWorkspace('/project/packages/../packages/core', '/project')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveRelativePath
// ---------------------------------------------------------------------------

describe('deriveRelativePath', () => {
  test('returns relative path from workspace root', () => {
    expect(
      deriveRelativePath('/project/packages/core/src/index.ts', '/project')
    ).toBe('packages/core/src/index.ts');
  });

  test('returns .. segments for paths outside workspace', () => {
    const rel = deriveRelativePath('/other/file.ts', '/project');
    expect(rel.startsWith('..')).toBe(true);
  });

  test('returns empty string for the root itself', () => {
    expect(deriveRelativePath('/project', '/project')).toBe('');
  });
});
