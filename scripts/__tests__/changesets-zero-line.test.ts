import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

const changesetCli = join(
  import.meta.dir,
  '..',
  '..',
  'node_modules',
  '@changesets',
  'cli',
  'bin.js'
);
const releasePackCoherenceCli = join(
  import.meta.dir,
  '..',
  'release-pack-coherence-check.ts'
);
const fixtureRoots: string[] = [];

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const runCommand = (rootDir: string, command: string[]): string => {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: rootDir,
    env: { ...process.env, NO_COLOR: '1' },
    stderr: 'pipe',
    stdout: 'pipe',
  });

  expect(
    result.exitCode,
    `${result.stdout.toString()}\n${result.stderr.toString()}`
  ).toBe(0);
  return result.stdout.toString();
};

const runChangeset = (rootDir: string, ...args: string[]): void => {
  runCommand(rootDir, ['node', changesetCli, ...args]);
};

const createFixture = (releaseType: 'major' | 'minor' | 'patch'): string => {
  const rootDir = mkdtempSync(join(tmpdir(), 'trails-changesets-zero-line-'));
  fixtureRoots.push(rootDir);

  mkdirSync(join(rootDir, '.changeset'));
  mkdirSync(join(rootDir, 'scripts', 'changesets'), { recursive: true });
  mkdirSync(join(rootDir, 'packages', 'core'), { recursive: true });
  mkdirSync(join(rootDir, 'packages', 'cli'), { recursive: true });
  writeFileSync(
    join(rootDir, 'scripts', 'changesets', 'changelog.cjs'),
    readFileSync(join(import.meta.dir, '..', 'changesets', 'changelog.cjs'))
  );

  writeJson(join(rootDir, 'package.json'), {
    name: 'changesets-zero-line-fixture',
    packageManager: 'bun@1.3.10',
    private: true,
    workspaces: ['packages/*'],
  });
  writeJson(join(rootDir, '.changeset', 'config.json'), {
    $schema: 'https://unpkg.com/@changesets/config@4.0.0/schema.json',
    access: 'public',
    baseBranch: 'main',
    changelog: ['../scripts/changesets/changelog.cjs', {}],
    commit: false,
    fixed: [['@fixture/core', '@fixture/cli']],
    format: false,
    ignore: [],
    linked: [],
    privatePackages: { tag: false, version: true },
    updateInternalDependencies: 'patch',
  });
  writeJson(join(rootDir, 'packages', 'core', 'package.json'), {
    name: '@fixture/core',
    version: '0.2.0',
  });
  writeJson(join(rootDir, 'packages', 'cli', 'package.json'), {
    name: '@fixture/cli',
    peerDependencies: { '@fixture/core': 'workspace:^' },
    version: '0.2.0',
  });

  runCommand(rootDir, [
    'bun',
    'install',
    '--lockfile-only',
    '--ignore-scripts',
  ]);
  runCommand(rootDir, ['git', 'init', '--initial-branch=main']);
  runCommand(rootDir, ['git', 'add', '.']);
  runCommand(rootDir, [
    'git',
    '-c',
    'user.email=fixture@example.com',
    '-c',
    'user.name=Fixture',
    'commit',
    '-m',
    'fixture baseline',
  ]);
  runCommand(rootDir, ['git', 'checkout', '-b', 'release-test']);
  writeFileSync(
    join(rootDir, '.changeset', 'release.md'),
    `---\n'@fixture/core': ${releaseType}\n---\n\nExercise the zero-major release line.\n`
  );

  return rootDir;
};

const readPackage = (
  rootDir: string,
  packageName: 'cli' | 'core'
): {
  name: string;
  peerDependencies?: Record<string, string>;
  version: string;
} =>
  JSON.parse(
    readFileSync(join(rootDir, 'packages', packageName, 'package.json'), 'utf8')
  );

afterEach(() => {
  for (const rootDir of fixtureRoots.splice(0)) {
    rmSync(rootDir, { force: true, recursive: true });
  }
});

describe('Changesets zero-major progression', () => {
  test.each([
    ['patch', '0.2.1'],
    ['minor', '0.3.0'],
    ['major', '1.0.0'],
  ] as const)(
    '%s changes produce %s across the fixed package group',
    (type, version) => {
      const rootDir = createFixture(type);
      const statusPath = join(rootDir, 'release-plan.json');

      runChangeset(rootDir, 'status', '--output', statusPath);
      const plan = JSON.parse(readFileSync(statusPath, 'utf8')) as {
        releases: { name: string; newVersion: string; type: string }[];
      };
      expect(
        plan.releases.map(({ name, newVersion, type: releaseType }) => ({
          name,
          newVersion,
          type: releaseType,
        }))
      ).toEqual([
        { name: '@fixture/core', newVersion: version, type },
        { name: '@fixture/cli', newVersion: version, type },
      ]);

      runChangeset(rootDir, 'version');
      const changelog = readFileSync(
        join(rootDir, 'packages', 'core', 'CHANGELOG.md'),
        'utf8'
      );
      expect(changelog).toContain(`## ${version}`);
      expect(changelog).toContain('Exercise the zero-major release line.');
      runCommand(rootDir, [
        'bun',
        releasePackCoherenceCli,
        '--branch',
        'changeset-release/main',
        '--lockfile-only',
        '--fix-lockfile',
      ]);
      expect(readPackage(rootDir, 'core').version).toBe(version);
      expect(readPackage(rootDir, 'cli')).toEqual({
        name: '@fixture/cli',
        peerDependencies: { '@fixture/core': 'workspace:^' },
        version,
      });

      const packDir = join(rootDir, 'packed');
      mkdirSync(packDir);
      runCommand(join(rootDir, 'packages', 'cli'), [
        'bun',
        'pm',
        'pack',
        '--destination',
        packDir,
        '--ignore-scripts',
        '--quiet',
      ]);
      const cliTarball = readdirSync(packDir).find((file) =>
        file.startsWith('fixture-cli-')
      );
      expect(cliTarball).toBeDefined();
      const packedCli = JSON.parse(
        runCommand(rootDir, [
          'tar',
          '-xOf',
          join(packDir, cliTarball as string),
          'package/package.json',
        ])
      ) as { peerDependencies: Record<string, string> };
      expect(packedCli.peerDependencies).toEqual({
        '@fixture/core': `^${version}`,
      });
    }
  );
});
