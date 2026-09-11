import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkReleaseRules } from '../release/check.js';

const roots: string[] = [];
const workspaces = [
  { isPrivate: false, name: '@ontrails/core', relativePath: 'packages/core' },
];
const manifest = {
  exports: './index.ts',
  name: '@ontrails/core',
  version: '1.0.0',
};
const versionFiles = [
  'packages/core/package.json',
  'packages/core/CHANGELOG.md',
];

const git = (root: string, ...args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], { cwd: root });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
};

const stableBump = { version: '1.0.1' };

const fixture = (update: Record<string, unknown> = stableBump) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'trails-stable-version-'));
  roots.push(repoRoot);
  mkdirSync(join(repoRoot, '.changeset'));
  mkdirSync(join(repoRoot, 'packages/core'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'packages/core/package.json'),
    JSON.stringify(manifest)
  );
  writeFileSync(
    join(repoRoot, 'packages/core/CHANGELOG.md'),
    '# Core\n\n## 1.0.0\n'
  );
  writeFileSync(
    join(repoRoot, '.changeset/core.md'),
    "---\n'@ontrails/core': patch\n---\n\nFix core.\n"
  );
  git(repoRoot, 'init');
  git(repoRoot, 'add', '.');
  git(
    repoRoot,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'base'
  );
  const baseRef = git(repoRoot, 'rev-parse', 'HEAD');
  rmSync(join(repoRoot, '.changeset/core.md'));
  writeFileSync(
    join(repoRoot, 'packages/core/package.json'),
    JSON.stringify({ ...manifest, ...update })
  );
  writeFileSync(
    join(repoRoot, 'packages/core/CHANGELOG.md'),
    `# Core\n\n## ${String(update.version ?? manifest.version)}\n\nFix core.\n\n## 1.0.0\n`
  );
  return {
    baseRef,
    baseWorkspaces: workspaces,
    contractFacts: [],
    repoRoot,
    workspaces,
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('stable generated version releases', () => {
  test.each(
    [versionFiles, [...versionFiles, '.changeset/core.md', 'bun.lock']].map(
      (changedFiles) => ({ changedFiles })
    )
  )(
    'accepts version-only manifests and changelogs with consumed intent absent',
    ({ changedFiles }) => {
      const result = checkReleaseRules({ ...fixture(), changedFiles });
      expect(result.versionRelease).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.coveredPackages).toEqual([]);
    }
  );

  test.each([
    { exports: './different.ts', version: '1.0.1' },
    { dependencies: { external: '^2.0.0' }, version: '1.0.1' },
    { version: '1.0.0' },
    { version: '0.9.9' },
    { version: 'invalid' },
  ])('requires intent for ordinary manifest edits: %j', (update) => {
    const result = checkReleaseRules({
      ...fixture(update),
      changedFiles: versionFiles,
    });
    expect(result.versionRelease).toBe(false);
    expect(result.passed).toBe(false);
  });

  test.each(
    [
      [...versionFiles, 'packages/core/src/index.ts'],
      ['packages/core/package.json'],
      ['packages/core/CHANGELOG.md'],
    ].map((changedFiles) => ({ changedFiles }))
  )(
    'requires intent when version evidence is incomplete or source changes',
    ({ changedFiles }) => {
      const result = checkReleaseRules({ ...fixture(), changedFiles });
      expect(result.versionRelease).toBe(false);
      expect(result.passed).toBe(false);
    }
  );

  test('requires a readable base manifest', () => {
    const result = checkReleaseRules({
      ...fixture(),
      baseRef: 'missing-ref',
      changedFiles: versionFiles,
    });
    expect(result.versionRelease).toBe(false);
    expect(result.passed).toBe(false);
  });
});
