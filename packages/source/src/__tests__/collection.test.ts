import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectSourceTree } from '../collection.js';

const git = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
};

const initializeRepository = (root: string, file = 'root.ts'): void => {
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'trails@example.test');
  git(root, 'config', 'user.name', 'Trails Test');
  writeFileSync(join(root, file), 'export const root = true;\n');
  git(root, 'add', file);
  git(root, 'commit', '--quiet', '-m', 'test: initialize fixture');
};

describe('collectSourceTree Git boundaries', () => {
  test('fails closed when Git marker or submodule metadata cannot be read', () => {
    const markerRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-marker-failure-')
    );
    const configRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-config-failure-')
    );
    const danglingConfigRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-dangling-config-')
    );
    const linkedConfigRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-linked-config-')
    );
    const externalConfigRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-external-config-')
    );
    const malformedConfigRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-malformed-config-')
    );
    try {
      const ambiguous = join(markerRoot, 'ambiguous');
      mkdirSync(ambiguous);
      symlinkSync(join(ambiguous, '.git'), join(ambiguous, '.git'));
      writeFileSync(join(ambiguous, 'hidden.ts'), 'export const hidden = 1;\n');
      const markerResult = collectSourceTree(markerRoot);
      expect(markerResult?.skipped).toContainEqual({
        path: 'ambiguous',
        reason: 'unreadable-git-boundary',
      });
      expect(
        markerResult?.files.some((file) => file.path.endsWith('hidden.ts'))
      ).toBe(false);

      mkdirSync(join(configRoot, '.gitmodules'));
      const nested = join(configRoot, 'nested');
      mkdirSync(join(nested, '.git'), { recursive: true });
      writeFileSync(join(nested, 'hidden.ts'), 'export const hidden = 1;\n');
      const possibleSubmodule = join(configRoot, 'possible-submodule');
      mkdirSync(possibleSubmodule);
      writeFileSync(
        join(possibleSubmodule, 'foreign.ts'),
        'export const foreign = 1;\n'
      );
      const configResult = collectSourceTree(configRoot);
      expect(configResult?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        { path: 'nested', reason: 'unreadable-git-boundary' },
        {
          path: 'possible-submodule',
          reason: 'unreadable-git-boundary',
        },
      ]);
      expect(
        configResult?.files.some(
          (file) =>
            file.path.endsWith('hidden.ts') || file.path.endsWith('foreign.ts')
        )
      ).toBe(false);

      symlinkSync(
        join(danglingConfigRoot, 'missing-gitmodules'),
        join(danglingConfigRoot, '.gitmodules')
      );
      const possibleDanglingSubmodule = join(
        danglingConfigRoot,
        'possible-submodule'
      );
      mkdirSync(possibleDanglingSubmodule);
      writeFileSync(
        join(possibleDanglingSubmodule, 'foreign.ts'),
        'export const foreign = 1;\n'
      );
      const danglingConfigResult = collectSourceTree(danglingConfigRoot);
      expect(danglingConfigResult?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        {
          path: 'possible-submodule',
          reason: 'unreadable-git-boundary',
        },
      ]);
      expect(danglingConfigResult?.files).toEqual([]);

      const externalGitmodules = join(externalConfigRoot, '.gitmodules');
      writeFileSync(externalGitmodules, '');
      symlinkSync(externalGitmodules, join(linkedConfigRoot, '.gitmodules'));
      const possibleLinkedSubmodule = join(
        linkedConfigRoot,
        'possible-submodule'
      );
      mkdirSync(possibleLinkedSubmodule);
      writeFileSync(
        join(possibleLinkedSubmodule, 'foreign.ts'),
        'export const foreign = 1;\n'
      );
      const linkedConfigResult = collectSourceTree(linkedConfigRoot);
      expect(linkedConfigResult?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        {
          path: 'possible-submodule',
          reason: 'unreadable-git-boundary',
        },
      ]);
      expect(linkedConfigResult?.files).toEqual([]);

      writeFileSync(
        join(malformedConfigRoot, '.gitmodules'),
        'this is not git config\n'
      );
      const possibleMalformedSubmodule = join(
        malformedConfigRoot,
        'possible-submodule'
      );
      mkdirSync(possibleMalformedSubmodule);
      writeFileSync(
        join(possibleMalformedSubmodule, 'foreign.ts'),
        'export const foreign = 1;\n'
      );
      const malformedConfigResult = collectSourceTree(malformedConfigRoot);
      expect(malformedConfigResult?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        {
          path: 'possible-submodule',
          reason: 'unreadable-git-boundary',
        },
      ]);
      expect(malformedConfigResult?.files).toEqual([]);
    } finally {
      rmSync(markerRoot, { force: true, recursive: true });
      rmSync(configRoot, { force: true, recursive: true });
      rmSync(danglingConfigRoot, { force: true, recursive: true });
      rmSync(linkedConfigRoot, { force: true, recursive: true });
      rmSync(externalConfigRoot, { force: true, recursive: true });
      rmSync(malformedConfigRoot, { force: true, recursive: true });
    }
  });

  test('fails closed for dangling, malformed, and invalid Git markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'source-collection-markers-'));
    try {
      const dangling = join(root, 'dangling');
      const malformed = join(root, 'malformed');
      const invalidRepository = join(root, 'invalid-repository');
      for (const directory of [dangling, malformed, invalidRepository]) {
        mkdirSync(directory);
        writeFileSync(
          join(directory, 'hidden.ts'),
          'export const hidden = 1;\n'
        );
      }
      symlinkSync(join(root, 'missing-git-dir'), join(dangling, '.git'));
      writeFileSync(join(malformed, '.git'), 'not a gitdir pointer\n');
      mkdirSync(join(invalidRepository, '.git'));

      const collection = collectSourceTree(root);
      expect(collection?.skipped).toEqual(
        expect.arrayContaining(
          ['dangling', 'invalid-repository', 'malformed'].map((path) => ({
            path,
            reason: 'unreadable-git-boundary',
          }))
        )
      );
      expect(
        collection?.files.some((file) => file.path.endsWith('hidden.ts'))
      ).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('uses Git config semantics and fails closed for incomplete submodule metadata', () => {
    const inlineCommentRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-inline-comment-')
    );
    const unterminatedQuoteRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-unterminated-quote-')
    );
    const pathlessRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-pathless-submodule-')
    );
    const mixedKeylessRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-mixed-keyless-submodule-')
    );
    const dottedSectionRoot = mkdtempSync(
      join(tmpdir(), 'source-collection-dotted-submodule-')
    );
    try {
      for (const root of [
        inlineCommentRoot,
        unterminatedQuoteRoot,
        pathlessRoot,
        mixedKeylessRoot,
        dottedSectionRoot,
      ]) {
        mkdirSync(join(root, 'vendor/x'), { recursive: true });
        writeFileSync(
          join(root, 'vendor/x/foreign.ts'),
          'export const foreign = 1;\n'
        );
      }

      writeFileSync(
        join(inlineCommentRoot, '.gitmodules'),
        '[submodule "x"]\n\tpath = vendor/x # trailing comment\n\turl = ../x\n'
      );
      expect(collectSourceTree(inlineCommentRoot)?.skipped).toContainEqual({
        path: 'vendor/x',
        reason: 'submodule-boundary',
      });
      expect(
        collectSourceTree(inlineCommentRoot)?.files.some((file) =>
          file.path.endsWith('foreign.ts')
        )
      ).toBe(false);

      writeFileSync(
        join(unterminatedQuoteRoot, '.gitmodules'),
        '[submodule "x"]\n\tpath = "vendor/x\n'
      );
      expect(collectSourceTree(unterminatedQuoteRoot)?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        { path: 'vendor', reason: 'unreadable-git-boundary' },
      ]);
      expect(collectSourceTree(unterminatedQuoteRoot)?.files).toEqual([]);

      writeFileSync(
        join(pathlessRoot, '.gitmodules'),
        '[submodule "x"]\n\turl = ../x\n'
      );
      expect(collectSourceTree(pathlessRoot)?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        { path: 'vendor', reason: 'unreadable-git-boundary' },
      ]);
      expect(collectSourceTree(pathlessRoot)?.files).toEqual([]);

      writeFileSync(
        join(mixedKeylessRoot, '.gitmodules'),
        '[submodule "good"]\n\tpath = vendor/good\n\turl = ../good\n[submodule "incomplete"]\n'
      );
      expect(collectSourceTree(mixedKeylessRoot)?.skipped).toEqual([
        { path: '.gitmodules', reason: 'unreadable-git-metadata' },
        { path: 'vendor', reason: 'unreadable-git-boundary' },
      ]);
      expect(collectSourceTree(mixedKeylessRoot)?.files).toEqual([]);

      writeFileSync(
        join(dottedSectionRoot, '.gitmodules'),
        '[submodule.x]\n\tpath = vendor/x\n\turl = ../x\n'
      );
      expect(collectSourceTree(dottedSectionRoot)?.skipped).toContainEqual({
        path: 'vendor/x',
        reason: 'submodule-boundary',
      });
      expect(
        collectSourceTree(dottedSectionRoot)?.files.some((file) =>
          file.path.endsWith('foreign.ts')
        )
      ).toBe(false);
    } finally {
      rmSync(inlineCommentRoot, { force: true, recursive: true });
      rmSync(unterminatedQuoteRoot, { force: true, recursive: true });
      rmSync(pathlessRoot, { force: true, recursive: true });
      rmSync(mixedKeylessRoot, { force: true, recursive: true });
      rmSync(dottedSectionRoot, { force: true, recursive: true });
    }
  });

  test('prunes declared submodule paths even when the checkout is absent', () => {
    const root = mkdtempSync(
      join(tmpdir(), 'source-collection-submodule-path-')
    );
    try {
      writeFileSync(
        join(root, '.gitmodules'),
        '[submodule "vendor/fixture"]\n\tpath = vendor/fixture/\n\turl = ../fixture\n'
      );
      mkdirSync(join(root, 'vendor/fixture'), { recursive: true });
      writeFileSync(
        join(root, 'vendor/fixture/residual.ts'),
        'export const residual = 1;\n'
      );

      const collection = collectSourceTree(root);
      expect(collection?.skipped).toContainEqual({
        path: 'vendor/fixture',
        reason: 'submodule-boundary',
      });
      expect(
        collection?.files.some((file) => file.path.endsWith('residual.ts'))
      ).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('sorts paths by locale-independent code units', () => {
    const root = mkdtempSync(join(tmpdir(), 'source-collection-order-'));
    try {
      const paths = ['Z.ts', '_under.ts', 'a.ts', 'é.ts'];
      for (const path of paths) {
        writeFileSync(join(root, path), 'export {};\n');
      }
      const collection = collectSourceTree(root);
      expect(collection?.files.map((file) => file.path)).toEqual(
        paths.toSorted()
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('derives worktree, repository, and submodule boundaries while direct roots stay first-class', () => {
    const root = mkdtempSync(join(tmpdir(), 'source-collection-root-'));
    const submoduleSource = mkdtempSync(
      join(tmpdir(), 'source-collection-submodule-')
    );
    const linked = join(root, '.worktrees', 'linked');

    try {
      initializeRepository(root);
      git(root, 'worktree', 'add', '--quiet', '--detach', linked);
      writeFileSync(
        join(linked, 'linked-only.ts'),
        'export const linked = 1;\n'
      );

      const nestedRepository = join(root, 'nested-repository');
      mkdirSync(nestedRepository);
      initializeRepository(nestedRepository, 'nested.ts');

      initializeRepository(submoduleSource, 'submodule.ts');
      git(
        root,
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '--quiet',
        submoduleSource,
        'vendor/submodule'
      );

      writeFileSync(join(root, 'agent-a.ts'), 'export const agentA = 1;\n');
      const primary = collectSourceTree(root);
      expect(primary).not.toBeNull();
      expect(primary?.skipped).toContainEqual({
        path: '.worktrees/linked',
        reason: 'nested-worktree',
      });
      expect(primary?.skipped).toContainEqual({
        path: 'nested-repository',
        reason: 'nested-repository',
      });
      expect(primary?.skipped).toContainEqual({
        path: 'vendor/submodule',
        reason: 'submodule-boundary',
      });
      expect(primary?.files.some((file) => file.path === 'agent-a.ts')).toBe(
        true
      );
      expect(
        primary?.files.some((file) => file.path.endsWith('linked-only.ts'))
      ).toBe(false);

      const directWorktree = collectSourceTree(linked);
      expect(
        directWorktree?.files.some((file) => file.path === 'linked-only.ts')
      ).toBe(true);
      expect(
        directWorktree?.files.some((file) => file.path === 'agent-a.ts')
      ).toBe(false);
      expect(
        directWorktree?.skipped.some(
          (entry) => entry.reason === 'nested-worktree'
        )
      ).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(submoduleSource, { force: true, recursive: true });
    }
  });
});
