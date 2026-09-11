import { afterEach, describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { copyLockRoundtripWorkspace } from '../release/lock-roundtrip-workspace.js';

const repoRoot = resolve(import.meta.dir, '../../../..');
const smokeModule = join(
  repoRoot,
  'apps/trails/src/release/lock-roundtrip-smoke.ts'
);
const guard = join(repoRoot, 'scripts/tree-guard.ts');
const fixtures: string[] = [];

const env = {
  ...process.env,
  GIT_COMMON_DIR: undefined,
  GIT_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_WORK_TREE: undefined,
};

const command = (cwd: string, cmd: string[]) =>
  Bun.spawnSync({
    cmd,
    cwd,
    env,
    stderr: 'pipe',
    stdout: 'pipe',
  });

const fixture = async (behavior = '') => {
  const root = await mkdtemp(join(tmpdir(), 'lock-isolation-test-'));
  fixtures.push(root);
  await mkdir(join(root, 'apps/trails/bin'), { recursive: true });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/app.ts'), '// current app\n');
  await writeFile(join(root, 'trails.config.ts'), '// original config\n');
  await writeFile(join(root, 'trails.lock'), '{}\n');
  await writeFile(
    join(root, 'apps/trails/bin/trails.ts'),
    `
import { join, resolve } from 'node:path';
const operation = process.argv[2];
const root = resolve(process.argv[process.argv.indexOf('--root-dir') + 1]);
${behavior}
if (operation === 'compile') await Bun.write(join(root, 'trails.lock'), '{}\\n');
`
  );
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'fixture@example.test'],
    ['config', 'user.name', 'Fixture'],
    ['add', '.'],
    ['commit', '-qm', 'fixture'],
  ]) {
    const result = command(root, ['git', ...args]);
    expect(result.exitCode).toBe(0);
  }
  return root;
};

const runGuardedSmoke = (root: string) =>
  command(root, [
    process.execPath,
    guard,
    'run',
    '--',
    process.execPath,
    '-e',
    `import { runLockRoundtripSmoke } from ${JSON.stringify(smokeModule)};
await runLockRoundtripSmoke({ repoRoot: ${JSON.stringify(root)} });`,
  ]);

const output = (result: ReturnType<typeof command>) =>
  `${result.stdout.toString()}${result.stderr.toString()}`;

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe('lock round-trip output isolation', () => {
  test('identical-byte writes are detected even when final git status is clean', async () => {
    const root = await fixture();
    const result = command(root, [
      process.execPath,
      guard,
      'run',
      '--',
      process.execPath,
      '-e',
      "await Bun.write('trails.lock', await Bun.file('trails.lock').text()); await Bun.sleep(300);",
    ]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain('repo-known tracked path changed');
    expect(
      command(root, ['git', 'status', '--porcelain']).stdout.toString()
    ).toBe('');
  });

  test('successful cold compile and validate do not touch tracked inputs', async () => {
    const root = await fixture();
    const result = runGuardedSmoke(root);
    expect(output(result)).not.toContain('tree-guard:');
    expect(result.exitCode).toBe(0);
    expect(
      command(root, ['git', 'status', '--porcelain']).stdout.toString()
    ).toBe('');
  });

  test('copying large tracked inputs does not trigger the guard', async () => {
    const root = await fixture();
    await writeFile(join(root, 'large.txt'), 'x'.repeat(256 * 1024));
    expect(command(root, ['git', 'add', 'large.txt']).exitCode).toBe(0);
    expect(
      command(root, ['git', 'commit', '-qm', 'large input']).exitCode
    ).toBe(0);
    const result = runGuardedSmoke(root);
    expect(output(result)).not.toContain('tree-guard:');
    expect(result.exitCode).toBe(0);
  });

  for (const operation of ['compile', 'validate']) {
    test(`${operation} failure leaves inputs untouched`, async () => {
      const root = await fixture(
        `if (operation === '${operation}') process.exit(2);`
      );
      const result = runGuardedSmoke(root);
      expect(result.exitCode).toBe(1);
      expect(output(result)).toContain(
        `${operation === 'compile' ? 'cold compile' : 'validate'} failed`
      );
      expect(output(result)).not.toContain('tree-guard:');
      expect(await readFile(join(root, 'trails.lock'), 'utf8')).toBe('{}\n');
    });
  }

  test('copies current config, untracked source and workspace dependency links', async () => {
    const root = await fixture();
    const copy = await mkdtemp(join(tmpdir(), 'lock-isolation-copy-'));
    fixtures.push(copy);
    await mkdir(join(root, 'node_modules/.bun'), { recursive: true });
    await mkdir(join(root, 'packages/local'), { recursive: true });
    await writeFile(join(root, 'trails.config.ts'), '// dirty config\n');
    await writeFile(
      join(root, 'packages/local/index.ts'),
      '// untracked dependency\n'
    );
    await symlink('../packages/local', join(root, 'node_modules/local'));
    await copyLockRoundtripWorkspace(root, copy, ['trails.lock']);
    await writeFile(join(root, 'packages/local/index.ts'), '// later edit\n');
    expect(await readFile(join(copy, 'trails.config.ts'), 'utf8')).toBe(
      '// dirty config\n'
    );
    expect(
      await readFile(join(copy, 'node_modules/local/index.ts'), 'utf8')
    ).toBe('// untracked dependency\n');
    expect(await realpath(join(copy, 'node_modules/.bun'))).toBe(
      await realpath(join(root, 'node_modules/.bun'))
    );
  });

  test.each(['.claude/worktrees', '.worktrees'])(
    'skips %s before traversing sibling checkout contents',
    async (worktreeRoot) => {
      const root = await fixture();
      const copy = await mkdtemp(join(tmpdir(), 'lock-isolation-copy-'));
      fixtures.push(copy);
      await mkdir(join(root, `${worktreeRoot}/sibling`), { recursive: true });
      // A removed sibling input would fail copying if traversal reached it.
      await symlink(
        'removed-source',
        join(root, `${worktreeRoot}/sibling/missing.ts`)
      );
      await copyLockRoundtripWorkspace(root, copy, ['trails.lock']);
      expect(
        await access(join(copy, worktreeRoot)).then(
          () => true,
          () => false
        )
      ).toBe(false);
    }
  );

  test.each(['.claude/worktrees', '.worktrees'])(
    'skips disposable paths but keeps selected and tracked %s inputs',
    async (worktreeRoot) => {
      const root = await fixture();
      const copy = await mkdtemp(join(tmpdir(), 'lock-isolation-copy-'));
      fixtures.push(copy);
      for (const dir of [
        '.tmp-tests/selected',
        '.tmp-tests/unrelated',
        `${worktreeRoot}/selected`,
        `${worktreeRoot}/unrelated`,
        '.turbo',
        '.agents/notes',
        'dist',
      ]) {
        await mkdir(join(root, dir), { recursive: true });
        await writeFile(join(root, dir, 'input.js'), '// current bytes\n');
      }
      await writeFile(
        join(root, '.tmp-tests/unrelated/tracked.ts'),
        '// tracked input\n'
      );
      expect(
        command(root, ['git', 'add', '-f', '.tmp-tests/unrelated/tracked.ts'])
          .exitCode
      ).toBe(0);
      await writeFile(
        join(root, `${worktreeRoot}/unrelated/tracked.ts`),
        '// tracked agent input\n'
      );
      expect(
        command(root, [
          'git',
          'add',
          '-f',
          `${worktreeRoot}/unrelated/tracked.ts`,
        ]).exitCode
      ).toBe(0);
      await symlink(
        'removed-payload',
        join(root, '.tmp-tests/unrelated/disappeared')
      );
      await copyLockRoundtripWorkspace(root, copy, [
        '.tmp-tests/selected/trails.lock',
        `${worktreeRoot}/selected/trails.lock`,
      ]);
      expect(
        await readFile(join(copy, '.tmp-tests/unrelated/tracked.ts'), 'utf8')
      ).toBe('// tracked input\n');
      expect(
        await readFile(
          join(copy, `${worktreeRoot}/unrelated/tracked.ts`),
          'utf8'
        )
      ).toBe('// tracked agent input\n');
      expect(
        await access(join(copy, '.tmp-tests/unrelated/disappeared')).then(
          () => true,
          () => false
        )
      ).toBe(false);
      for (const dir of [
        '.tmp-tests/unrelated/input.js',
        `${worktreeRoot}/unrelated/input.js`,
        '.turbo',
        '.agents/notes',
      ]) {
        expect(
          await access(join(copy, dir)).then(
            () => true,
            () => false
          )
        ).toBe(false);
      }
      for (const dir of [
        '.tmp-tests/selected',
        `${worktreeRoot}/selected`,
        'dist',
      ]) {
        expect(await readFile(join(copy, dir, 'input.js'), 'utf8')).toBe(
          '// current bytes\n'
        );
      }
    }
  );

  test('missing authored source fails instead of being silently skipped', async () => {
    const root = await fixture();
    const copy = await mkdtemp(join(tmpdir(), 'lock-isolation-copy-'));
    fixtures.push(copy);
    await symlink('removed-source', join(root, 'src/missing.ts'));
    await expect(
      copyLockRoundtripWorkspace(root, copy, ['trails.lock'])
    ).rejects.toThrow();
  });

  test('a real edit during compile is detected and preserved on cleanup', async () => {
    const root = await fixture();
    // The subprocess edits the caller only after the smoke reaches compile.
    // This orders the overlap deterministically, without racing a timer.
    await writeFile(
      join(root, 'apps/trails/bin/trails.ts'),
      `
if (process.argv[2] === 'compile') {
  await Bun.write(${JSON.stringify(join(root, 'trails.lock'))}, 'concurrent edit\\n');
  process.exit(2);
}
`
    );
    const result = runGuardedSmoke(root);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain('tree-guard: the working tree changed');
    expect(await readFile(join(root, 'trails.lock'), 'utf8')).toBe(
      'concurrent edit\n'
    );
  });
});
