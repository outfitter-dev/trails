import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkReleaseRules,
  discoverWorkspaces,
  runReleaseCheck,
  runReleaseCheckCli,
} from '../release/check.js';
import type { WorkspaceInfo } from '../release/check.js';
import type { ContractReleaseFact } from '../release/contract-facts.js';

const workspaces: readonly WorkspaceInfo[] = [
  {
    isPrivate: false,
    name: '@ontrails/core',
    relativePath: 'packages/core',
  },
  {
    isPrivate: false,
    name: '@ontrails/http',
    relativePath: 'packages/http',
  },
  {
    isPrivate: true,
    name: '@ontrails/oxlint-plugin',
    relativePath: 'packages/oxlint-plugin',
  },
  {
    isPrivate: false,
    name: 'trails-demo',
    relativePath: 'apps/demo',
  },
];

const contractFact = (
  aspect: ContractReleaseFact['aspect'] = 'input'
): ContractReleaseFact => ({
  aspect,
  baseHash: 'base-hash',
  changedFiles: ['packages/core/src/user.ts'],
  currentHash: 'current-hash',
  packageName: '@ontrails/core',
  path: 'packages/core/src/user.ts',
  trailId: 'user.create',
  workspacePath: 'packages/core',
});

const basePackage = (name: string): WorkspaceInfo => ({
  isPrivate: false,
  name,
  relativePath: `packages/${name.slice('@ontrails/'.length)}`,
});

const withTempRepo = <T>(
  setup: (repoRoot: string) => T
): { readonly repoRoot: string; readonly value: T } => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-'));
  mkdirSync(join(repoRoot, '.changeset'), { recursive: true });

  try {
    return {
      repoRoot,
      value: setup(repoRoot),
    };
  } catch (error) {
    rmSync(repoRoot, { force: true, recursive: true });
    throw error;
  }
};

describe('checkReleaseRules', () => {
  test('fails a removed public package without an exact governed route', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/not-governed')],
        changedFiles: [],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('does not let release:none bypass an ungoverned public package removal', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/not-governed')],
        changedFiles: [],
        releaseNone: true,
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('accepts an exact governed package rename with a present target', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'observe-rename.md'),
        "---\n'@ontrails/observability': major\n---\n\nRename observability owner.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/observe')],
        changedFiles: ['.changeset/observe-rename.md'],
        repoRoot,
        workspaces: [...workspaces, basePackage('@ontrails/observability')],
      });

      expect(result.passed).toBe(true);
      expect(result.packageRouteFacts).toEqual([
        {
          kind: 'single',
          sourcePackage: '@ontrails/observe',
          targetPackage: '@ontrails/observability',
          transitionId: 'v1-observe-observability',
        },
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('fails an exact governed route when its target package is absent', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/observe')],
        changedFiles: [],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Governed Regrade route 'v1-observe-observability' maps '@ontrails/observe' to '@ontrails/observability', but that publishable target package is absent. Add the target package before applying the route, or use a classified transition with an explicit non-migratable reason for a multi-owner fold.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('accepts a classified governed fold without inventing a root target', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'tracing-fold.md'),
        "---\n'@ontrails/core': patch\n---\n\nFold tracing ownership.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/tracing')],
        changedFiles: ['.changeset/tracing-fold.md'],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.packageRouteFacts).toEqual([
        {
          kind: 'classified',
          sourcePackage: '@ontrails/tracing',
          transitionId: 'v1-tracing-owner-fold',
        },
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('requires a branch-local changeset for a governed public package route', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/tracing')],
        changedFiles: [],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        'Public package route changesets must cover a surviving owner: @ontrails/tracing',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('rejects an unrelated changeset for a single package route', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'unrelated.md'),
        "---\n'@ontrails/core': patch\n---\n\nUnrelated.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/observe')],
        changedFiles: ['.changeset/unrelated.md'],
        repoRoot,
        workspaces: [...workspaces, basePackage('@ontrails/observability')],
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        'Public package route changesets must cover a surviving owner: @ontrails/observe',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('accepts an exact governed module-specifier package route', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'topography-rename.md'),
        "---\n'@ontrails/topography': major\n---\n\nRename topography owner.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/topographer')],
        changedFiles: ['.changeset/topography-rename.md'],
        repoRoot,
        workspaces: [...workspaces, basePackage('@ontrails/topography')],
      });

      expect(result.passed).toBe(true);
      expect(result.packageRouteFacts).toEqual([
        {
          kind: 'single',
          sourcePackage: '@ontrails/topographer',
          targetPackage: '@ontrails/topography',
          transitionId: 'v1-topographer-topography',
        },
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('counts a package route as evidence for an active changeset', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'tracing-fold.md'),
        "---\n'@ontrails/core': patch\n---\n\nFold tracing ownership.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [basePackage('@ontrails/tracing')],
        changedFiles: ['.changeset/tracing-fold.md'],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.activePackageChangesetsWithoutReleaseFacts).toEqual([]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('ignores private, added, and subpath-only package changes', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        baseWorkspaces: [
          {
            isPrivate: true,
            name: '@ontrails/private-old',
            relativePath: 'tools/private-old',
          },
        ],
        changedFiles: [],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.packageRouteFacts).toEqual([]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });
  test('fails package-affecting publishable workspace changes without a covering changeset', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: ['packages/core/src/index.ts'],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.affectedPackages).toEqual(['@ontrails/core']);
      expect(result.errors).toEqual([
        'Release rules require intent for package content changes: @ontrails/core',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('passes package-affecting changes with a real matching changeset entry', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'core-change.md'),
        "---\n'@ontrails/core': minor\n---\n\nAdd the thing.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        changedFiles: [
          'packages/core/src/index.ts',
          '.changeset/core-change.md',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.changedChangesets).toEqual(['.changeset/core-change.md']);
      expect(result.coveredPackages).toEqual(['@ontrails/core']);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('requires changeset coverage for each affected publishable package', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'core-change.md'),
        "---\n'@ontrails/core': patch\n---\n\nCore only.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        changedFiles: [
          'packages/core/src/index.ts',
          'packages/http/src/build.ts',
          '.changeset/core-change.md',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        'Release rules require intent for package content changes: @ontrails/http',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('allows generated version release changes from changeset version', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: [
          '.changeset/pre.json',
          'packages/core/CHANGELOG.md',
          'packages/core/package.json',
          'packages/http/CHANGELOG.md',
          'packages/http/package.json',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.versionRelease).toBe(true);
      expect(result.affectedPackages).toEqual([
        '@ontrails/core',
        '@ontrails/http',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('allows covered package cleanup alongside generated version release changes', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'core-docs.md'),
        "---\n'@ontrails/core': patch\n---\n\nRefresh package docs.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        changedFiles: [
          '.changeset/core-docs.md',
          '.changeset/pre.json',
          'packages/core/CHANGELOG.md',
          'packages/core/README.md',
          'packages/core/package.json',
          'packages/http/CHANGELOG.md',
          'packages/http/package.json',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.versionRelease).toBe(true);
      expect(result.coveredPackages).toEqual(['@ontrails/core']);
      expect(result.affectedPackages).toEqual([
        '@ontrails/core',
        '@ontrails/http',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('rejects active package changesets without a matching release fact', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'repo-only.md'),
        "---\n'@ontrails/core': patch\n---\n\nRepo-only note.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        changedFiles: [
          'docs/releases/release-rules-check.md',
          '.changeset/repo-only.md',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.activePackageChangesetsWithoutReleaseFacts).toEqual([
        '.changeset/repo-only.md',
      ]);
      expect(result.errors).toEqual([
        'Active changesets require a matching package or release fact on this branch. Remove .changeset/repo-only.md or include the package-facing change here.',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('ignores deleted changesets when checking active release intent', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: [
          'docs/releases/release-rules-check.md',
          '.changeset/deleted.md',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.activePackageChangesetsWithoutReleaseFacts).toEqual([]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('does not treat prerelease state plus source edits as a generated version release', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: [
          '.changeset/pre.json',
          'packages/core/CHANGELOG.md',
          'packages/core/package.json',
          'packages/core/src/index.ts',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.versionRelease).toBe(false);
      expect(result.errors).toEqual([
        'Release rules require intent for package content changes: @ontrails/core',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('ignores non-shipping package test artifacts and private workspaces', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: [
          'packages/core/src/__tests__/result.test.ts',
          'packages/core/dist/index.js',
          'packages/core/tsconfig.tsbuildinfo',
          'packages/oxlint-plugin/src/rules/shared.ts',
          'apps/demo/src/main.ts',
        ],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.affectedPackages).toEqual([]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('honors release:none and rejects contradictory changesets', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'core-change.md'),
        "---\n'@ontrails/core': patch\n---\n\nCore.\n"
      );
    });

    try {
      const bypass = checkReleaseRules({
        changedFiles: ['packages/core/src/index.ts'],
        releaseNone: true,
        repoRoot,
        workspaces,
      });
      const contradiction = checkReleaseRules({
        changedFiles: [
          'packages/core/src/index.ts',
          '.changeset/core-change.md',
        ],
        releaseNone: true,
        repoRoot,
        workspaces,
      });

      expect(bypass.passed).toBe(true);
      expect(contradiction.passed).toBe(false);
      expect(contradiction.errors).toEqual([
        '`release:none` conflicts with changed changeset files. Remove the label or the changeset.',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('reports uncovered public trail contract facts with trail evidence', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: ['packages/core/src/user.ts'],
        contractFacts: [contractFact('output')],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.uncoveredContractFacts).toHaveLength(1);
      expect(result.errors).toContain(
        'Release rules require intent for public trail contract changes: user.create output (@ontrails/core)'
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives public contract facts from changed package source files', () => {
    const { repoRoot } = withTempRepo((root) => {
      mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
      writeFileSync(
        join(root, 'packages', 'core', 'src', 'user.ts'),
        `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const userCreate = trail('user.create', {
  implementation: () => Result.ok({ id: 'u1' }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
});
`
      );
    });

    try {
      const result = checkReleaseRules({
        changedFiles: ['packages/core/src/user.ts'],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.contractFacts).toMatchObject([
        {
          aspect: 'trail',
          packageName: '@ontrails/core',
          path: 'packages/core/src/user.ts',
          trailId: 'user.create',
        },
      ]);
      expect(result.errors).toContain(
        'Release rules require intent for public trail contract changes: user.create trail (@ontrails/core)'
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('passes public trail contract facts with matching changeset coverage', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'core-contract.md'),
        "---\n'@ontrails/core': patch\n---\n\nUpdate user contract.\n"
      );
    });

    try {
      const result = checkReleaseRules({
        changedFiles: [
          'packages/core/src/user.ts',
          '.changeset/core-contract.md',
        ],
        contractFacts: [contractFact('input')],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.contractFacts).toHaveLength(1);
      expect(result.uncoveredContractFacts).toEqual([]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('allows release:none as an explicit public contract override', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkReleaseRules({
        changedFiles: ['packages/core/src/user.ts'],
        contractFacts: [contractFact('surfaces')],
        releaseNone: true,
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(true);
      expect(result.releaseNone).toBe(true);
      expect(result.contractFacts.map((fact) => fact.aspect)).toEqual([
        'surfaces',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('release:none conflicts with changed changeset files even when they are unparsable or deleted', () => {
    const { repoRoot } = withTempRepo((root) => {
      writeFileSync(
        join(root, '.changeset', 'empty-change.md'),
        'This file is not a valid changeset frontmatter block.\n'
      );
    });

    try {
      const malformed = checkReleaseRules({
        changedFiles: ['.changeset/empty-change.md'],
        releaseNone: true,
        repoRoot,
        workspaces,
      });
      const deleted = checkReleaseRules({
        changedFiles: ['.changeset/deleted-change.md'],
        releaseNone: true,
        repoRoot,
        workspaces,
      });

      expect(malformed.passed).toBe(false);
      expect(malformed.changedChangesets).toEqual([
        '.changeset/empty-change.md',
      ]);
      expect(deleted.passed).toBe(false);
      expect(deleted.changedChangesets).toEqual([
        '.changeset/deleted-change.md',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('uses the selected base ref when deriving local changed files', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-git-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'core'), { recursive: true });
      mkdirSync(join(repoRoot, '.changeset'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@ontrails/core' })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );

      await expect(
        runReleaseCheckCli(['--repo-root', repoRoot, '--base-ref', 'HEAD'])
      ).resolves.toBe(0);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('fails when an explicit base ref cannot provide the workspace inventory', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'core'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@ontrails/core' })
      );
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        baseRef: 'missing-base-ref',
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Release check could not read the base workspace inventory from 'missing-base-ref'. Fetch or provide a valid --base-ref before checking package routes.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('requires a base ref for changed-file release checks', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        'Release check requires --base-ref when --changed-files is used.',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives removed packages from base workspace patterns with a leading dot', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'core'), { recursive: true });
      mkdirSync(join(repoRoot, 'packages', 'retired'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['./packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@ontrails/core' })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'retired', 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      rmSync(join(repoRoot, 'packages', 'retired'), {
        force: true,
        recursive: true,
      });
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        baseRef: 'HEAD',
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives package routes for direct checks with a base ref', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'retired'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'retired', 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      rmSync(join(repoRoot, 'packages', 'retired'), {
        force: true,
        recursive: true,
      });

      const result = checkReleaseRules({
        baseRef: 'HEAD',
        changedFiles: [],
        repoRoot,
        workspaces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives removals from a trailing-slash base workspace selector', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'retired'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/retired/'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'retired', 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      rmSync(join(repoRoot, 'packages', 'retired'), {
        force: true,
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        baseRef: 'HEAD',
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives removed packages from an exact root workspace in the base', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed', workspaces: ['.'] })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        baseRef: 'HEAD',
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives removals from a dot-slash root workspace selector', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed', workspaces: ['./'] })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        baseRef: 'HEAD',
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('derives removals from an explicit base when current workspaces are absent', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'retired'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'retired', 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      rmSync(join(repoRoot, 'packages', 'retired'), {
        force: true,
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      writeFileSync(join(repoRoot, 'changed-files.txt'), '');

      const result = await runReleaseCheck({
        baseRef: 'HEAD',
        changedFilesPath: join(repoRoot, 'changed-files.txt'),
        repoRoot,
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('defaults local checks to origin main when current workspaces are absent', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'retired'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'retired', 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init --initial-branch=main', {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      execSync('git update-ref refs/remotes/origin/main HEAD', {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      rmSync(join(repoRoot, 'packages', 'retired'), {
        force: true,
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      execSync('git add -A', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m retire',
        { cwd: repoRoot, stdio: 'ignore' }
      );

      const result = await runReleaseCheck({ repoRoot });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Public package removal '@ontrails/not-governed' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('rejects unsupported base workspace patterns', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'retired'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/**'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'retired', 'package.json'),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init --initial-branch=main', {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      execSync('git update-ref refs/remotes/origin/main HEAD', {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      rmSync(join(repoRoot, 'packages', 'retired'), {
        force: true,
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      execSync('git add -A', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m retire',
        { cwd: repoRoot, stdio: 'ignore' }
      );

      const result = await runReleaseCheck({ repoRoot });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Unsupported workspace pattern 'packages/**'. The release check supports exact workspace paths and one-level '/*' globs.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('rejects base workspace patterns with a nested glob', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-base-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'core', 'plugins', 'retired'), {
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*/plugins/*'] })
      );
      writeFileSync(
        join(
          repoRoot,
          'packages',
          'core',
          'plugins',
          'retired',
          'package.json'
        ),
        JSON.stringify({ name: '@ontrails/not-governed' })
      );
      execSync('git init --initial-branch=main', {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );
      execSync('git update-ref refs/remotes/origin/main HEAD', {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      rmSync(join(repoRoot, 'packages', 'core', 'plugins', 'retired'), {
        force: true,
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'app' })
      );
      execSync('git add -A', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m retire',
        { cwd: repoRoot, stdio: 'ignore' }
      );

      const result = await runReleaseCheck({ repoRoot });

      expect(result.passed).toBe(false);
      expect(result.errors).toEqual([
        "Unsupported workspace pattern 'packages/*/plugins/*'. The release check supports exact workspace paths and one-level '/*' globs.",
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('passes as a no-op in non-workspace generated apps', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-app-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'fresh-app' })
      );

      await expect(runReleaseCheckCli(['--repo-root', repoRoot])).resolves.toBe(
        0
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('passes as a no-op in a git generated app without origin main', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-release-rules-app-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'fresh-app' })
      );
      execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
      execSync('git add .', { cwd: repoRoot, stdio: 'ignore' });
      execSync(
        'git -c user.email=test@example.com -c user.name=Test commit -m initial',
        { cwd: repoRoot, stdio: 'ignore' }
      );

      await expect(runReleaseCheckCli(['--repo-root', repoRoot])).resolves.toBe(
        0
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });
});

describe('discoverWorkspaces', () => {
  test('returns no workspaces for single-package apps', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-workspaces-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'fresh-app' })
      );

      await expect(discoverWorkspaces(repoRoot)).resolves.toEqual([]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('discovers publish metadata from root workspace globs', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-workspaces-'));

    try {
      mkdirSync(join(repoRoot, 'packages', 'core'), { recursive: true });
      mkdirSync(join(repoRoot, 'packages', 'private-tool'), {
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@ontrails/core' })
      );
      writeFileSync(
        join(repoRoot, 'packages', 'private-tool', 'package.json'),
        JSON.stringify({ name: '@ontrails/private-tool', private: true })
      );

      await expect(discoverWorkspaces(repoRoot)).resolves.toEqual([
        {
          isPrivate: false,
          name: '@ontrails/core',
          relativePath: 'packages/core',
        },
        {
          isPrivate: true,
          name: '@ontrails/private-tool',
          relativePath: 'packages/private-tool',
        },
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('rejects unsupported workspace glob patterns instead of ignoring them', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-workspaces-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/**'] })
      );

      await expect(discoverWorkspaces(repoRoot)).rejects.toThrow(
        "Unsupported workspace pattern 'packages/**'"
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('rejects workspace patterns with a nested glob', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-workspaces-'));

    try {
      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*/plugins/*'] })
      );

      await expect(discoverWorkspaces(repoRoot)).rejects.toThrow(
        "Unsupported workspace pattern 'packages/*/plugins/*'"
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });
});
