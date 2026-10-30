import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkDocumentationMigrations } from '../docs/migrations.ts';

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const git = (root: string, ...args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], { cwd: root });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString().trim();
};
const write = (root: string, path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const commit = (root: string): string => {
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
};
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'trails-docs-migrations-'));
  fixtures.push(root);
  git(root, 'init', '--quiet', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  write(
    root,
    'package.json',
    JSON.stringify({ workspaces: ['packages/*', 'examples/*'] })
  );
  write(root, 'README.md', '# Front door\n');
  write(root, 'docs/index.md', '# Router\n');
  write(root, 'docs/old.md', '# Original guide\n');
  return { base: commit(root), root };
};
const move = (root: string, from: string, to: string): void => {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  renameSync(join(root, from), join(root, to));
};
const ledger = (root: string, entries: readonly unknown[]): void => {
  write(
    root,
    'docs/migration-map.json',
    JSON.stringify({ entries, version: 1 })
  );
};

describe('documentation migration accounting', () => {
  test('does not require an empty ledger when no public source disappears', () => {
    const { root, base } = fixture();
    const result = checkDocumentationMigrations(root, base);
    expect(result.failures).toEqual([]);
    expect(result.head).toBe(base);
    expect(result.before).toBe(base);
  });

  test('rejects a deletion without migration intent', () => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/old.md'));
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('docs/old.md');
  });

  test('accepts a move even when its rewritten content defeats rename similarity', () => {
    const { root, base } = fixture();
    move(root, 'docs/old.md', 'docs/new.md');
    write(root, 'docs/new.md', '# Entirely different teaching\nNew content.\n');
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/new.md'] },
    ]);
    commit(root);
    expect(
      git(root, 'diff', '--name-status', '--find-renames', base, 'HEAD')
    ).toContain('D\tdocs/old.md');
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
  });

  test.each([
    { disposition: 'split', to: ['docs/one.md', 'docs/two.md'] },
    { disposition: 'archived', to: ['docs/releases/archive/old.md'] },
    { disposition: 'deleted', to: [] },
  ])('accounts for $disposition intent', ({ disposition, to }) => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/old.md'));
    for (const path of to) {
      write(root, path, '# Surviving content\n');
    }
    ledger(root, [
      {
        disposition,
        from: 'docs/old.md',
        reason: 'Intentionally retired.',
        to,
      },
    ]);
    commit(root);
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
  });

  test.each([
    { disposition: 'moved', from: 'docs/old.md', to: ['docs/missing.md'] },
    { disposition: 'moved', from: 'docs/old.md', to: ['../outside.md'] },
    { disposition: 'deleted', from: 'docs/old.md', to: [] },
  ])('rejects missing, escaping or unexplained destinations %#', (entry) => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/old.md'));
    ledger(root, [entry]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.length
    ).toBeGreaterThan(0);
  });

  test('uses the caller-selected base for actual stacked history', () => {
    const { root, base } = fixture();
    git(root, 'switch', '--quiet', '-c', 'lower');
    move(root, 'docs/old.md', 'docs/middle[1].md');
    // Leave lower-layer debt unaccounted so a focused upper check can miss it.
    const lower = commit(root);
    git(root, 'switch', '--quiet', '-c', 'upper');
    move(root, 'docs/middle[1].md', 'docs/final.md');
    ledger(root, [
      {
        disposition: 'moved',
        from: 'docs/middle[1].md',
        to: ['docs/final.md'],
      },
    ]);
    const head = commit(root);
    const focused = checkDocumentationMigrations(root, lower);
    expect(focused.failures).toEqual([]);
    expect(focused.base).toBe(lower);
    expect(focused.head).toBe(head);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('docs/old.md');
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/final.md'] },
      {
        disposition: 'moved',
        from: 'docs/middle[1].md',
        to: ['docs/final.md'],
      },
    ]);
    commit(root);
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
  });

  test('requires accounting for an intermediate path absent from both endpoint trees', () => {
    const { root, base } = fixture();
    const intermediate = 'docs/intermediate [guide]\nname.md';
    move(root, 'docs/old.md', intermediate);
    commit(root);
    move(root, intermediate, 'docs/final.md');
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/final.md'] },
    ]);
    commit(root);
    expect(checkDocumentationMigrations(root, base).failures).toContain(
      `${intermediate}: missing migration entry in docs/migration-map.json`
    );
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/final.md'] },
      { disposition: 'moved', from: intermediate, to: ['docs/final.md'] },
    ]);
    commit(root);
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
  });

  test('accounts for a workspace README deleted after its manifest disappeared', () => {
    const { root } = fixture();
    write(root, 'examples/demo/package.json', JSON.stringify({ name: 'demo' }));
    write(root, 'examples/demo/README.md', '# Demo\n');
    const start = commit(root);
    rmSync(join(root, 'examples/demo/package.json'));
    commit(root);
    rmSync(join(root, 'examples/demo/README.md'));
    commit(root);
    expect(checkDocumentationMigrations(root, start).failures).toContain(
      'examples/demo/README.md: missing migration entry in docs/migration-map.json'
    );
    ledger(root, [
      {
        disposition: 'deleted',
        from: 'examples/demo/README.md',
        reason: 'demo workspace retired',
        to: [],
      },
    ]);
    commit(root);
    expect(checkDocumentationMigrations(root, start).failures).toEqual([]);
  });

  test('ignores removals trunk made before a merge back into the branch', () => {
    const { root, base } = fixture();
    git(root, 'checkout', '--quiet', '-b', 'feature');
    write(root, 'docs/feature.md', '# Feature\n');
    const start = commit(root);
    git(root, 'checkout', '--quiet', 'main');
    rmSync(join(root, 'docs/old.md'));
    commit(root);
    git(root, 'checkout', '--quiet', 'feature');
    git(root, 'merge', '--quiet', '--no-edit', '--no-ff', 'main');
    // Trunk's removal is trunk's accounting: the branch window ignores it
    // whether it starts at the fork or at the branch's own first commit.
    expect(checkDocumentationMigrations(root, start).failures).toEqual([]);
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
    git(root, 'checkout', '--quiet', 'main');
    expect(checkDocumentationMigrations(root, base).failures).toContain(
      'docs/old.md: missing migration entry in docs/migration-map.json'
    );
  });

  test('rejects an unrecorded fixed-root deletion even when the root is restored', () => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/index.md'));
    commit(root);
    write(root, 'docs/index.md', '# Restored router\n');
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('docs/index.md: fixed documentation root cannot be removed');
  });

  test.each(['docs/invented.md', 'docs/old.md'])(
    'rejects a new migration record without a removal (%s)',
    (from) => {
      const { root, base } = fixture();
      ledger(root, [{ disposition: 'moved', from, to: ['README.md'] }]);
      commit(root);
      expect(
        checkDocumentationMigrations(root, base).failures.join('\n')
      ).toContain('new migration entry has no removed public source');
    }
  );

  test('keeps ADR lifecycle destinations outside this ledger owner', () => {
    const { root, base } = fixture();
    move(root, 'docs/old.md', 'docs/adr/0099-example.md');
    ledger(root, [
      {
        disposition: 'archived',
        from: 'docs/old.md',
        to: ['docs/adr/0099-example.md'],
      },
    ]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('not a surviving public Markdown source');
  });

  test.each(['new', 'prior'])(
    'rejects a restored source with a %s migration record',
    (kind) => {
      const { root } = fixture();
      const initial = git(root, 'rev-parse', 'HEAD');
      move(root, 'docs/old.md', 'docs/new.md');
      if (kind === 'prior') {
        ledger(root, [
          { disposition: 'moved', from: 'docs/old.md', to: ['docs/new.md'] },
        ]);
      }
      const moved = commit(root);
      write(root, 'docs/old.md', '# Restored\n');
      ledger(root, [
        { disposition: 'moved', from: 'docs/old.md', to: ['docs/new.md'] },
      ]);
      commit(root);
      expect(
        checkDocumentationMigrations(
          root,
          kind === 'prior' ? moved : initial
        ).failures.join('\n')
      ).toContain('migration source remains or was restored');
    }
  );

  test('fails closed for an unavailable base without fetching', () => {
    const { root } = fixture();
    const config = readFileSync(join(root, '.git/config'), 'utf8');
    expect(
      checkDocumentationMigrations(root, 'missing-base').failures.join('\n')
    ).toContain('base');
    expect(readFileSync(join(root, '.git/config'), 'utf8')).toBe(config);
  });

  test('uses historical workspace declarations when a whole workspace disappears', () => {
    const { root, base } = fixture();
    write(root, 'examples/app/package.json', '{}');
    write(root, 'examples/app/README.md', '# Example\n');
    commit(root);
    rmSync(join(root, 'examples'), { recursive: true });
    write(root, 'package.json', JSON.stringify({ workspaces: [] }));
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('examples/app/README.md');
  });

  test('does not turn private, distribution, changelog or ADR changes into this ledger', () => {
    const { root } = fixture();
    const excluded = [
      '.agents/notes/private.md',
      'plugins/trails/README.md',
      'packages/internal/CHANGELOG.md',
      'docs/adr/0000-history.md',
    ];
    for (const path of excluded) {
      write(root, path, '# Excluded\n');
    }
    const base = commit(root);
    for (const path of excluded) {
      rmSync(join(root, path));
    }
    commit(root);
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
  });

  test('preserves whitespace in source and successor paths', () => {
    const { root } = fixture();
    write(root, 'docs/old guide.md', '# Guide\n');
    const base = commit(root);
    move(root, 'docs/old guide.md', 'docs/new guide.md');
    ledger(root, [
      {
        disposition: 'moved',
        from: 'docs/old guide.md',
        to: ['docs/new guide.md'],
      },
    ]);
    commit(root);
    expect(checkDocumentationMigrations(root, base).failures).toEqual([]);
  });

  test('fixed navigation roots cannot be deleted through a ledger entry', () => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/index.md'));
    ledger(root, [
      { disposition: 'deleted', from: 'docs/index.md', reason: 'No.', to: [] },
    ]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('fixed');
  });

  test('fixed roots cannot gain an entry through an intermediate delete and restore', () => {
    const { root, base } = fixture();
    rmSync(join(root, 'README.md'));
    commit(root);
    write(root, 'README.md', '# Restored\n');
    ledger(root, [
      { disposition: 'moved', from: 'README.md', to: ['docs/old.md'] },
    ]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('fixed documentation root');
  });

  test('does not report committed history as a clean check of dirty public paths', () => {
    const { root, base } = fixture();
    write(root, 'docs/old.md', '# Uncommitted\n');
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('uncommitted');
  });

  test('rejects an untracked workspace manifest before its README enters the committed population', () => {
    const { root, base } = fixture();
    write(root, 'packages/new/package.json', '{}');
    write(root, 'packages/new/README.md', '# New workspace\n');
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('uncommitted documentation inputs: packages/new/package.json');
  });

  test('rejects a dirty manifest of an existing workspace', () => {
    const { root } = fixture();
    write(root, 'packages/existing/package.json', '{}');
    write(root, 'packages/existing/README.md', '# Existing workspace\n');
    const base = commit(root);
    write(root, 'packages/existing/package.json', '{"private":true}');
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain(
      'uncommitted documentation inputs: packages/existing/package.json'
    );
  });
  test('rejects malformed or duplicate authored migration records', () => {
    const { root, base } = fixture();
    ledger(root, [
      {
        disposition: 'deleted',
        from: 'docs/old.md',
        reason: 'Retired.',
        to: [],
      },
      {
        disposition: 'deleted',
        from: 'docs/old.md',
        reason: 'Retired.',
        to: [],
      },
    ]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('duplicate source');
    write(root, 'docs/migration-map.json', '{not-json');
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.length
    ).toBeGreaterThan(0);
  });

  test('rejects a symlink as a surviving source instead of reading its destination', () => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/old.md'));
    symlinkSync('../README.md', join(root, 'docs/alias.md'));
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/alias.md'] },
    ]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('not a surviving');
  });

  test('accounts for a regular source replaced by a symlink', () => {
    const { root, base } = fixture();
    rmSync(join(root, 'docs/old.md'));
    symlinkSync('../README.md', join(root, 'docs/old.md'));
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('docs/old.md: missing migration entry');
  });

  test('requires old records to point to surviving final targets after another move', () => {
    const { root, base } = fixture();
    move(root, 'docs/old.md', 'docs/middle.md');
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/middle.md'] },
    ]);
    commit(root);
    move(root, 'docs/middle.md', 'docs/final.md');
    ledger(root, [
      { disposition: 'moved', from: 'docs/old.md', to: ['docs/middle.md'] },
      { disposition: 'moved', from: 'docs/middle.md', to: ['docs/final.md'] },
    ]);
    commit(root);
    expect(
      checkDocumentationMigrations(root, base).failures.join('\n')
    ).toContain('docs/middle.md is not a surviving');
  });

  test.each(['entry', 'ledger'])(
    'retains prior accounting when the current %s disappears',
    (removed) => {
      const { root } = fixture();
      move(root, 'docs/old.md', 'docs/new.md');
      ledger(root, [
        { disposition: 'moved', from: 'docs/old.md', to: ['docs/new.md'] },
      ]);
      const base = commit(root);
      if (removed === 'entry') {
        ledger(root, []);
      } else {
        rmSync(join(root, 'docs/migration-map.json'));
      }
      commit(root);
      expect(
        checkDocumentationMigrations(root, base).failures.join('\n')
      ).toContain('prior migration entry must be retained');
    }
  );

  test('fails closed in a shallow clone and leaves its shallow boundary unchanged', () => {
    const { root, base } = fixture();
    write(root, 'docs/second.md', '# Second\n');
    commit(root);
    const clone = mkdtempSync(join(tmpdir(), 'trails-docs-shallow-'));
    fixtures.push(clone);
    git(root, 'clone', '--quiet', '--depth=1', pathToFileURL(root).href, clone);
    const boundary = readFileSync(join(clone, '.git/shallow'), 'utf8');
    expect(
      checkDocumentationMigrations(clone, base).failures.join('\n')
    ).toContain('Fetch/provide');
    expect(readFileSync(join(clone, '.git/shallow'), 'utf8')).toBe(boundary);
  });
  test('the aggregate requires an explicit base before running owner checks', () => {
    const result = Bun.spawnSync(
      [process.execPath, resolve(import.meta.dir, '../docs.ts'), 'check'],
      { cwd: resolve(import.meta.dir, '../..') }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('requires --base-ref');
  });

  test.each(['HEAD', ''])(
    'generation rejects history-selection flags before running writers (%#)',
    (baseRef) => {
      const result = Bun.spawnSync(
        [
          process.execPath,
          resolve(import.meta.dir, '../docs.ts'),
          'generate',
          '--base-ref',
          baseRef,
        ],
        { cwd: resolve(import.meta.dir, '../..') }
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        'generation does not select history'
      );
    }
  );
});
