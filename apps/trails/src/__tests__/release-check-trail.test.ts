import { deriveCliCommands } from '@ontrails/cli';
import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from '../app.js';
import { releaseCheckTrail } from '../trails/release-check.js';

const roots: string[] = [];
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const trailsBinPath = fileURLToPath(
  new URL('../../bin/trails.ts', import.meta.url)
);
const cliTimeoutMs = 30_000;

interface RawCliRun {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const runRawCli = (
  args: readonly string[],
  cwd: string = repoRoot
): RawCliRun => {
  const command = [process.execPath, trailsBinPath, ...args];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, NO_COLOR: '1', TRAILS_ENV: 'test' } as Record<
      string,
      string
    >,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: cliTimeoutMs,
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const signalCode = proc.signalCode ?? undefined;
  if (proc.exitedDueToTimeout || signalCode !== undefined) {
    throw new Error(
      [
        `Release check CLI subprocess ${proc.exitedDueToTimeout ? 'timed out' : 'terminated'} before producing output.`,
        `command: ${command.join(' ')}`,
        `cwd: ${cwd}`,
        ...(proc.exitedDueToTimeout ? [`timeoutMs: ${cliTimeoutMs}`] : []),
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }

  return {
    exitCode: proc.exitCode ?? -1,
    stderr,
    stdout,
  };
};

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

const writeJson = (
  root: string,
  path: string,
  value: Record<string, unknown>
): void => {
  writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
};

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-release-check-'));
  roots.push(root);
  writeJson(root, 'package.json', {
    name: 'fixture-root',
    workspaces: ['apps/*'],
  });
  writeJson(root, 'apps/trails/package.json', {
    name: '@ontrails/trails',
  });
  writeFile(root, 'apps/trails/src/app.ts', 'export {};\n');
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync(
    'git -c user.email=test@example.com -c user.name=Test commit -m initial',
    { cwd: root, stdio: 'ignore' }
  );
  return root;
};

const writeChangedFiles = (
  root: string,
  paths: readonly string[] = ['apps/trails/src/app.ts']
): string => {
  const changedFilesPath = join(root, 'changed-files.txt');
  writeFileSync(changedFilesPath, `${paths.join('\n')}\n`);
  return changedFilesPath;
};

const writeChangeset = (root: string): void => {
  writeFile(
    root,
    '.changeset/trails-release.md',
    '---\n"@ontrails/trails": patch\n---\n\nUpdate Trails app release behavior.\n'
  );
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('trails release check', () => {
  test('renders as a nested CLI command', () => {
    const commands = deriveCliCommands(app);
    if (commands.isErr()) {
      throw commands.error;
    }

    const paths = commands.value.map((command) => command.path.join(' '));
    expect(paths).toContain('release check');
  });

  test('runs release rules over a workspace changed-file list', async () => {
    const root = makeTempRoot();
    writeChangeset(root);
    const changedFilesPath = writeChangedFiles(root, [
      '.changeset/trails-release.md',
      'apps/trails/src/app.ts',
    ]);

    const result = await releaseCheckTrail.implementation(
      { baseRef: 'HEAD', changedFiles: changedFilesPath, rootDir: root },
      { cwd: root, env: { TRAILS_ENV: 'test' } } as never
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.passed).toBe(true);
    expect(result.value.affectedPackages).toEqual(['@ontrails/trails']);
    expect(result.value.formatted).toContain('Release check passed');
  });

  test('loads release rules from trails.config.ts', async () => {
    const root = makeTempRoot();
    const changedFilesPath = writeChangedFiles(root);
    writeFile(
      root,
      'trails.config.ts',
      `export default {
  release: {
    rules: [
      {
        enabled: false,
        facts: ['package-content'],
        id: 'package-content-requires-intent',
        intent: ['changeset'],
        severity: 'error',
      },
    ],
  },
};
`
    );

    const result = await releaseCheckTrail.implementation(
      { baseRef: 'HEAD', changedFiles: changedFilesPath, rootDir: root },
      { cwd: root, env: { TRAILS_ENV: 'test' } } as never
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.passed).toBe(true);
    expect(result.value.configPath).toBe(join(root, 'trails.config.ts'));
  }, 30_000);

  test('loads release rules from trails.config.json', async () => {
    const root = makeTempRoot();
    const changedFilesPath = writeChangedFiles(root);
    writeJson(root, 'trails.config.json', {
      release: {
        rules: [
          {
            enabled: false,
            facts: ['package-content'],
            id: 'package-content-requires-intent',
            intent: ['changeset'],
            severity: 'error',
          },
        ],
      },
    });

    const result = await releaseCheckTrail.implementation(
      { baseRef: 'HEAD', changedFiles: changedFilesPath, rootDir: root },
      { cwd: root, env: { TRAILS_ENV: 'test' } } as never
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.passed).toBe(true);
    expect(result.value.configPath).toBe(join(root, 'trails.config.json'));
  });

  test('returns structured JSON and non-zero exit for missing release intent', () => {
    const root = makeTempRoot();
    const changedFilesPath = writeChangedFiles(root);

    const result = runRawCli([
      'release',
      'check',
      '--root-dir',
      root,
      '--changed-files',
      changedFilesPath,
      '--base-ref',
      'HEAD',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      readonly errors?: readonly string[];
      readonly passed?: boolean;
    };
    expect(parsed.passed).toBe(false);
    expect(parsed.errors).toContain(
      'Release rules require intent for package content changes: @ontrails/trails'
    );
  });
});
