import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkChangesetGate,
  discoverWorkspaces,
} from '../check-changeset-gate.ts';
import type { WorkspaceInfo } from '../check-changeset-gate.ts';
import type { ContractReleaseFact } from '../contract-release-facts.ts';

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

const withTempRepo = <T>(
  setup: (repoRoot: string) => T
): { readonly repoRoot: string; readonly value: T } => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'trails-changeset-gate-'));
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

describe('checkChangesetGate', () => {
  test('fails package-affecting publishable workspace changes without a covering changeset', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkChangesetGate({
        changedFiles: ['packages/core/src/index.ts'],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.affectedPackages).toEqual(['@ontrails/core']);
      expect(result.errors).toEqual([
        'Package-affecting changes need changeset entries for: @ontrails/core',
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
      const result = checkChangesetGate({
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
      const result = checkChangesetGate({
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
        'Package-affecting changes need changeset entries for: @ontrails/http',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('allows generated version release changes from changeset version', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkChangesetGate({
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
      const result = checkChangesetGate({
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

  test('does not treat prerelease state plus source edits as a generated version release', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkChangesetGate({
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
        'Package-affecting changes need changeset entries for: @ontrails/core',
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test('ignores non-shipping package test artifacts and private workspaces', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkChangesetGate({
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
      const bypass = checkChangesetGate({
        changedFiles: ['packages/core/src/index.ts'],
        releaseNone: true,
        repoRoot,
        workspaces,
      });
      const contradiction = checkChangesetGate({
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
      const result = checkChangesetGate({
        changedFiles: ['packages/core/src/user.ts'],
        contractFacts: [contractFact('output')],
        repoRoot,
        workspaces,
      });

      expect(result.passed).toBe(false);
      expect(result.uncoveredContractFacts).toHaveLength(1);
      expect(result.errors).toContain(
        'Public trail contract changes need release disposition: user.create output (@ontrails/core)'
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
  blaze: () => Result.ok({ id: 'u1' }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
});
`
      );
    });

    try {
      const result = checkChangesetGate({
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
        'Public trail contract changes need release disposition: user.create trail (@ontrails/core)'
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
      const result = checkChangesetGate({
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

  test('allows release:none as an explicit public contract disposition', () => {
    const { repoRoot } = withTempRepo(() => {});

    try {
      const result = checkChangesetGate({
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
      const malformed = checkChangesetGate({
        changedFiles: ['.changeset/empty-change.md'],
        releaseNone: true,
        repoRoot,
        workspaces,
      });
      const deleted = checkChangesetGate({
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
});

describe('discoverWorkspaces', () => {
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
});
