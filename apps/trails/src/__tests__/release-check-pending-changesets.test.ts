import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkReleaseRules, discoverWorkspaces } from '../release/check.js';
import type { WorkspaceInfo } from '../release/check.js';

const roots: string[] = [];
const workspaces: readonly WorkspaceInfo[] = [
  { isPrivate: false, name: '@ontrails/core', relativePath: 'packages/core' },
];

const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-pending-changesets-'));
  roots.push(root);
  mkdirSync(join(root, '.changeset'));
  return root;
};

const writeChangeset = (
  root: string,
  id: string,
  frontmatter: string
): void => {
  writeFileSync(
    join(root, '.changeset', `${id}.md`),
    `---\n${frontmatter}\n---\n\nRelease intent.\n`
  );
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('pending changeset workspace names', () => {
  test('accepts pnpm-only workspace packages and rejects unknown names', async () => {
    const repoRoot = fixture();
    writeFileSync(
      join(repoRoot, 'package.json'),
      JSON.stringify({ name: 'workspace-root' })
    );
    writeFileSync(
      join(repoRoot, 'pnpm-workspace.yaml'),
      'packages: ["packages/*"]\n'
    );
    mkdirSync(join(repoRoot, 'packages/child'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'packages/child/package.json'),
      JSON.stringify({ name: '@other/child', version: '1.0.0' })
    );
    writeChangeset(repoRoot, 'child', "'@other/child': patch");
    const input = {
      changedFiles: [],
      repoRoot,
      workspaces: await discoverWorkspaces(repoRoot),
    };
    expect(checkReleaseRules(input).errors).toEqual([]);
    writeChangeset(repoRoot, 'missing', "'@other/missing': patch");
    expect(checkReleaseRules(input).errors).toEqual([
      "Changeset '.changeset/missing.md' references unknown workspace package '@other/missing'.",
    ]);
  });

  test.each(['pnpm-workspace.yaml', 'lerna.json'])(
    'reports malformed %s as a validation error',
    (filename) => {
      const repoRoot = fixture();
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'workspace-root' })
      );
      writeFileSync(
        join(repoRoot, filename),
        filename.endsWith('.yaml') ? 'packages: [' : '{'
      );
      writeChangeset(repoRoot, 'root', "'workspace-root': patch");
      const result = checkReleaseRules({
        changedFiles: [],
        repoRoot,
        workspaces: [],
      });
      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(
        'Cannot validate changeset package inventory'
      );
      expect(result.errors[0]).toContain(repoRoot);
      expect(result.errors[0]).toContain(
        filename.endsWith('.yaml') ? 'unexpected end' : filename
      );
    }
  );

  test('accepts the root package in a repository without workspaces', async () => {
    const repoRoot = fixture();
    writeFileSync(
      join(repoRoot, 'package.json'),
      JSON.stringify({ name: 'single-package', version: '1.0.0' })
    );
    writeChangeset(repoRoot, 'root', "'single-package': patch");
    const result = checkReleaseRules({
      changedFiles: [],
      repoRoot,
      workspaces: await discoverWorkspaces(repoRoot),
    });
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
    writeChangeset(repoRoot, 'unknown', "'missing-package': patch");
    expect(
      checkReleaseRules({
        changedFiles: [],
        repoRoot,
        workspaces: await discoverWorkspaces(repoRoot),
      }).errors
    ).toEqual([
      "Changeset '.changeset/unknown.md' references unknown workspace package 'missing-package'.",
    ]);
  });

  test.each(['workspaces', 'pnpm', 'bolt', 'lerna'])(
    'does not treat an empty %s workspace repository as a root package',
    async (mode) => {
      const repoRoot = fixture();
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({
          name: 'workspace-root',
          ...(mode === 'workspaces' ? { workspaces: ['packages/*'] } : {}),
          ...(mode === 'bolt' ? { bolt: { workspaces: ['packages/*'] } } : {}),
        })
      );
      if (mode === 'pnpm') {
        writeFileSync(
          join(repoRoot, 'pnpm-workspace.yaml'),
          'packages: ["packages/*"]\n'
        );
      }
      if (mode === 'lerna') {
        writeFileSync(join(repoRoot, 'lerna.json'), '{}');
      }
      writeChangeset(repoRoot, 'root', "'workspace-root': patch");
      const result = checkReleaseRules({
        changedFiles: [],
        repoRoot,
        workspaces: await discoverWorkspaces(repoRoot),
      });
      expect(result.errors).toEqual([
        "Changeset '.changeset/root.md' references unknown workspace package 'workspace-root'.",
      ]);
    }
  );

  test('validates retained v1 changeset directories supported by Changesets', () => {
    const repoRoot = fixture();
    mkdirSync(join(repoRoot, '.changeset/legacy'));
    writeFileSync(
      join(repoRoot, '.changeset/legacy/changes.md'),
      'Legacy intent.\n'
    );
    writeFileSync(
      join(repoRoot, '.changeset/legacy/changes.json'),
      JSON.stringify({
        releases: [{ name: '@ontrails/retired', type: 'patch' }],
      })
    );
    const result = checkReleaseRules({
      changedFiles: [],
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual([
      "Changeset '.changeset/legacy/changes.json' references unknown workspace package '@ontrails/retired'.",
    ]);
  });

  test('rejects an unchanged pending changeset after its package is removed', () => {
    const repoRoot = fixture();
    writeChangeset(repoRoot, 'stale', "'@ontrails/retired': patch");
    const result = checkReleaseRules({
      changedFiles: ['packages/retired/package.json'],
      releaseNone: true,
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toContain(
      "Changeset '.changeset/stale.md' references unknown workspace package '@ontrails/retired'."
    );
  });

  test('rejects an unknown name alongside valid package coverage', () => {
    const repoRoot = fixture();
    writeChangeset(
      repoRoot,
      'mixed',
      "'@ontrails/core': patch\n'@ontrails/ghost': patch"
    );
    const result = checkReleaseRules({
      changedFiles: ['packages/core/src/index.ts', '.changeset/mixed.md'],
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual([
      "Changeset '.changeset/mixed.md' references unknown workspace package '@ontrails/ghost'.",
    ]);
  });

  test('validates unscoped and other-scope keys in YAML frontmatter', () => {
    const repoRoot = fixture();
    writeChangeset(
      repoRoot,
      'other',
      '{ghost: patch, "@other/missing": minor}'
    );
    const result = checkReleaseRules({
      changedFiles: [],
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual([
      "Changeset '.changeset/other.md' references unknown workspace package '@other/missing'.",
      "Changeset '.changeset/other.md' references unknown workspace package 'ghost'.",
    ]);
  });

  test.each(['pre', 'exit'] as const)(
    'validates retained consumed package names before filtering in %s mode',
    (mode) => {
      const repoRoot = fixture();
      writeChangeset(repoRoot, 'consumed', "'@ontrails/retired': patch");
      writeFileSync(
        join(repoRoot, '.changeset/pre.json'),
        JSON.stringify({
          changesets: ['consumed'],
          initialVersions: {},
          mode,
          tag: 'beta',
        })
      );
      const result = checkReleaseRules({
        changedFiles: [],
        repoRoot,
        workspaces,
      });
      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Changeset '.changeset/consumed.md' references unknown workspace package '@ontrails/retired'.",
      ]);
    }
  );

  test('accepts deleted changesets and skips README and hidden metadata', () => {
    const repoRoot = fixture();
    writeChangeset(repoRoot, 'README', 'ghost: patch');
    writeChangeset(repoRoot, '.hidden', 'ghost: patch');
    const result = checkReleaseRules({
      changedFiles: ['.changeset/deleted.md'],
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(true);
  });

  test('preserves valid consumed history without requiring another release fact', () => {
    const repoRoot = fixture();
    writeChangeset(repoRoot, 'consumed', "'@ontrails/core': patch");
    writeFileSync(
      join(repoRoot, '.changeset/pre.json'),
      JSON.stringify({
        changesets: ['consumed'],
        initialVersions: {},
        mode: 'pre',
        tag: 'beta',
      })
    );
    const result = checkReleaseRules({
      changedFiles: [],
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(true);
    expect(result.coveredPackages).toEqual([]);
  });

  test('reports unreadable frontmatter instead of silently skipping validation', () => {
    const repoRoot = fixture();
    writeChangeset(repoRoot, 'broken', '"@ontrails/core": [');
    const result = checkReleaseRules({
      changedFiles: [],
      repoRoot,
      workspaces,
    });
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toStartWith(
      "Cannot validate changeset '.changeset/broken.md':"
    );
  });

  test('accepts names discovered from every supported workspace root', async () => {
    const repoRoot = fixture();
    const entries = [
      ['packages/core', '@ontrails/core'],
      ['adapters/http', '@other/http'],
      ['apps/operator', 'operator'],
      ['examples/demo', 'demo'],
    ] as const;
    writeFileSync(
      join(repoRoot, 'package.json'),
      JSON.stringify({
        workspaces: ['packages/*', 'adapters/*', 'apps/*', 'examples/*'],
      })
    );
    for (const [path, name] of entries) {
      mkdirSync(join(repoRoot, path), { recursive: true });
      writeFileSync(
        join(repoRoot, path, 'package.json'),
        JSON.stringify({ name, private: name === 'demo' })
      );
    }
    writeChangeset(
      repoRoot,
      'valid',
      entries.map(([, name]) => `'${name}': patch`).join('\n')
    );
    const result = checkReleaseRules({
      changedFiles: [],
      repoRoot,
      workspaces: await discoverWorkspaces(repoRoot),
    });
    expect(result.passed).toBe(true);
  });
});
