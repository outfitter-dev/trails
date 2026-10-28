import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

const repo = join(import.meta.dir, '../..');
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  ),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  PATH: `${join(repo, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
};

const run = async (
  cwd: string,
  command: string[],
  expected = 0
): Promise<string> => {
  const child = Bun.spawn(command, {
    cwd,
    env: {
      ...env,
      SKILLSET_INTERNAL_SUPPRESS_WORKSPACE_REGISTRATION: '1',
      XDG_CACHE_HOME: join(cwd, '.fixture-state/cache'),
      XDG_CONFIG_HOME: join(cwd, '.fixture-state/config'),
      XDG_DATA_HOME: join(cwd, '.fixture-state/data'),
      XDG_STATE_HOME: join(cwd, '.fixture-state/state'),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== expected) {
    throw new Error(
      `${command.join(' ')} exited ${code} (expected ${expected})\n${stdout}\n${stderr}`
    );
  }
  return stdout + stderr;
};

test('real generator and commit hooks keep unrelated branches stable and regenerate canonical changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trails-skillset-sync-'));
  try {
    const archive = Bun.spawn(['git', 'archive', 'HEAD'], {
      cwd: repo,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const archivePath = join(root, 'source.tar');
    await Bun.write(
      archivePath,
      await new Response(archive.stdout).arrayBuffer()
    );
    expect(await archive.exited).toBe(0);
    await run(root, ['tar', '-xf', archivePath]);
    await rm(archivePath);
    for (const path of [
      'package.json',
      'lefthook.yml',
      'scripts/sync-skillset-outputs.ts',
      'scripts/skillset-lock-provenance.ts',
      'scripts/check-skillset-lock-provenance.ts',
    ]) {
      await cp(join(repo, path), join(root, path));
    }
    await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
    await run(root, ['git', 'init', '--quiet', '--initial-branch=main']);
    await run(root, ['git', 'config', 'user.name', 'Trails Test']);
    await run(root, [
      'git',
      'config',
      'user.email',
      'trails-test@example.invalid',
    ]);
    await run(root, ['git', 'add', '.']);
    await run(root, [
      'git',
      'commit',
      '--quiet',
      '-m',
      'test: fixture baseline',
    ]);
    await run(root, ['lefthook', 'install']);
    const head = await run(root, ['git', 'rev-parse', 'HEAD']);
    const baseline = head.trim();
    const original = await Bun.file(join(root, 'skillset.lock')).text();

    for (const branch of ['unrelated-a', 'unrelated-b', 'dependencies']) {
      await run(root, ['git', 'switch', '-c', branch, baseline]);
      // Exercise explicit sync on a different branch/HEAD as well as real hooks.
      await run(root, ['bun', 'run', 'skillset:sync']);
      expect(await Bun.file(join(root, 'skillset.lock')).text()).toBe(original);
      if (branch === 'dependencies') {
        const path = join(root, 'package.json');
        const manifest = await Bun.file(path).json();
        manifest.devDependencies['@types/node'] = '~25.9.9';
        await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
        const lockPath = join(root, 'bun.lock');
        const lock = await Bun.file(lockPath).text();
        await Bun.write(
          lockPath,
          lock.replace('"@types/node": "^25.9.9"', '"@types/node": "~25.9.9"')
        );
        await run(root, ['git', 'add', 'package.json', 'bun.lock']);
      } else {
        await Bun.write(
          join(root, 'unrelated.ts'),
          'export const unrelated = true;\n'
        );
        await run(root, ['git', 'add', 'unrelated.ts']);
      }
      const commit = await run(root, [
        'git',
        'commit',
        '-m',
        `test: ${branch}`,
      ]);
      expect(commit).toContain('lefthook');
      await run(root, ['bun', 'run', 'skillset:sync']);
      expect(
        (await Bun.file(join(root, 'skillset.lock')).text()) === original
      ).toBe(true);
      expect(
        await run(root, [
          'git',
          'diff',
          baseline,
          'HEAD',
          '--',
          'skillset.lock',
        ])
      ).toBe('');
      await run(root, [
        'bun',
        'scripts/check-skillset-lock-provenance.ts',
        baseline,
      ]);
    }

    const guideHook = await run(root, [
      'lefthook',
      'run',
      'pre-commit',
      '--command',
      'team_skills',
      '--file',
      'packages/warden/src/guide.ts',
    ]);
    expect(guideHook).toContain(
      'skillset: build projects source to generated output'
    );
    const unrelatedHook = await run(root, [
      'lefthook',
      'run',
      'pre-commit',
      '--command',
      'team_skills',
      '--file',
      'packages/warden/src/__tests__/guide.test.ts',
    ]);
    expect(unrelatedHook).not.toContain(
      'skillset: build projects source to generated output'
    );

    await run(root, ['git', 'switch', '-c', 'canonical', baseline]);
    const canonical = '.skillset/agents/maintainer.md';
    await Bun.write(
      join(root, canonical),
      `${await Bun.file(join(root, canonical)).text()}\nFixture instruction for canonical regeneration.\n`
    );
    await run(root, ['skillset', 'change', 'refresh', '--yes', '--root', '.']);
    await run(root, ['git', 'add', canonical, '.skillset/changes']);
    const commit = await run(root, [
      'git',
      'commit',
      '-m',
      'test: canonical input',
    ]);
    expect(commit).toContain('team_skills');
    expect(
      (await Bun.file(join(root, 'skillset.lock')).text()) === original
    ).toBe(false);
    expect(
      await run(root, ['git', 'diff', baseline, 'HEAD', '--name-only'])
    ).toContain('.claude/agents/maintainer.md');
    await run(root, ['bun', 'run', 'skillset:check']);
    await run(root, [
      'bun',
      'scripts/check-skillset-lock-provenance.ts',
      baseline,
    ]);

    await run(root, ['git', 'switch', '-c', 'provenance-only', baseline]);
    const lock = JSON.parse(original);
    lock.provenanceHash = 'changed';
    lock.marketplaces.entries[0].resolved.sha = 'changed';
    await Bun.write(
      join(root, 'skillset.lock'),
      `${JSON.stringify(lock, null, 2)}\n`
    );
    await run(root, ['git', 'add', 'skillset.lock']);
    await run(root, ['git', 'commit', '-m', 'test: provenance-only lock']);
    const rejected = await run(
      root,
      ['bun', 'scripts/check-skillset-lock-provenance.ts', baseline],
      1
    );
    expect(rejected).toContain(`git checkout '${baseline}' -- skillset.lock`);
    expect(rejected).toContain(
      'git checkout origin/main -- skillset.lock && bun run skillset:check'
    );
    await run(
      root,
      ['bun', 'scripts/check-skillset-lock-provenance.ts', 'missing-base'],
      1
    );
    // A pre-existing edit disables restoration even when generation changes only
    // provenance relative to HEAD. Otherwise sync would restore the fake SHA.
    const committedNoise = await Bun.file(join(root, 'skillset.lock')).text();
    await Bun.write(join(root, 'skillset.lock'), `${committedNoise}\n`);
    await run(root, ['bun', 'run', 'skillset:sync']);
    expect(
      (await Bun.file(join(root, 'skillset.lock')).text()) === committedNoise
    ).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}, 180_000);
