import { deriveCliCommands } from '@ontrails/cli';
import { Result, ValidationError } from '@ontrails/core';
import { runWardenAdapterChecks } from '@ontrails/warden';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from '../app.js';
import { tryAdapterCheckOutput } from '../run-adapter-check.js';
import { adapterCheckTrail } from '../trails/adapter-check.js';

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
    env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
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
        `Adapter check CLI subprocess ${proc.exitedDueToTimeout ? 'timed out' : 'terminated'} before producing output.`,
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
  const root = mkdtempSync(join(tmpdir(), 'trails-adapter-check-cli-'));
  roots.push(root);
  return root;
};

const makeRoot = (): string => {
  const root = makeTempRoot();
  writeJson(root, 'package.json', {
    name: 'fixture-root',
    workspaces: ['packages/*', 'adapters/*'],
  });
  return root;
};

const writePackage = (
  root: string,
  workspacePath: string,
  manifest: Record<string, unknown>
): void => {
  writeJson(root, join(workspacePath, 'package.json'), manifest);
};

const writeHttpOwner = (root: string): void => {
  writePackage(root, 'packages/http', {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
      './testing': './src/testing.ts',
    },
    name: '@ontrails/http',
    trails: {
      adapterTargets: {
        http: {
          placements: ['extracted'],
          testingImport: '@ontrails/http/testing',
        },
      },
    },
  });
  writeFile(root, 'packages/http/src/testing.ts', 'export {};\n');
};

const expectValidationError = (
  result: Awaited<ReturnType<typeof adapterCheckTrail.blaze>>
): ValidationError => {
  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error('Expected adapter.check to return Result.err');
  }
  expect(result.error).toBeInstanceOf(ValidationError);
  return result.error as ValidationError;
};

const writeHonoAdapter = (
  root: string,
  manifestOverrides: Record<string, unknown> = {}
): void => {
  writePackage(root, 'adapters/hono', {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    name: '@ontrails/hono',
    peerDependencies: {
      '@ontrails/http': 'workspace:^',
    },
    trails: {
      adapter: true,
    },
    ...manifestOverrides,
  });
  writeFile(
    root,
    'adapters/hono/src/index.ts',
    'export const honoAdapter = {};\n'
  );
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('trails adapter check', () => {
  test('projects as a nested CLI command', () => {
    const commands = deriveCliCommands(app);
    if (commands.isErr()) {
      throw commands.error;
    }

    const paths = commands.value.map((command) => command.path.join(' '));
    expect(paths).toContain('adapter check');
  });

  test('returns the same diagnostic codes as the Warden projection', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const result = await adapterCheckTrail.blaze({ rootDir: root }, {
      cwd: root,
      env: {},
    } as never);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const localCodes = result.value.diagnostics.map((entry) => entry.code);
    const wardenCodes = runWardenAdapterChecks(root).map((entry) => entry.code);

    expect(result.value.passed).toBe(false);
    expect(localCodes).toEqual(['invalid-adapter-metadata']);
    expect(wardenCodes).toEqual(localCodes);
  });

  test('runs locally and exits non-zero for adapter readiness failures', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const result = runRawCli(['adapter', 'check', '--root-dir', root]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('## Adapter Check Report');
    expect(result.stdout).toContain('invalid-adapter-metadata');
  });

  test('exits non-zero for adapter readiness failures under trace JSON', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const result = runRawCli([
      'adapter',
      'check',
      '--root-dir',
      root,
      '--trace',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('adapter.check');
    const parsed = JSON.parse(result.stdout) as {
      readonly ok?: boolean;
      readonly value?: { readonly passed?: boolean };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.passed).toBe(false);
  });

  test('rejects missing root directories before reporting pass', async () => {
    const root = makeRoot();
    const missingRoot = join(root, 'missing-root');

    const result = await adapterCheckTrail.blaze({ rootDir: missingRoot }, {
      cwd: root,
      env: {},
    } as never);

    const error = expectValidationError(result);
    expect(error.message).toContain('rootDir does not exist');
  });

  test('rejects roots without workspace manifests before reporting pass', async () => {
    const root = makeTempRoot();
    writeJson(root, 'package.json', {
      name: 'not-a-workspace-root',
    });

    const result = await adapterCheckTrail.blaze({ rootDir: root }, {
      cwd: root,
      env: {},
    } as never);

    const error = expectValidationError(result);
    expect(error.message).toContain('must declare workspace packages');
  });

  test('CLI exits non-zero for missing root directories', () => {
    const root = makeRoot();
    const missingRoot = join(root, 'missing-root');

    const result = runRawCli(['adapter', 'check', '--root-dir', missingRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Result: PASS');
    expect(result.stderr).toContain('rootDir does not exist');
  });

  test('CLI exits non-zero for missing root directories under trace JSON', () => {
    const root = makeRoot();
    const missingRoot = join(root, 'missing-root');

    const result = runRawCli([
      'adapter',
      'check',
      '--root-dir',
      missingRoot,
      '--trace',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('adapter.check');
    const parsed = JSON.parse(result.stdout) as {
      readonly error?: { readonly message?: string };
      readonly ok?: boolean;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.message).toContain('rootDir does not exist');
  });

  test('lets --jsonl shorthand use structured output', () => {
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = 0;

      const handled = tryAdapterCheckOutput({
        flags: { jsonl: true },
        result: Result.ok({ formatted: 'adapter report', passed: false }),
        trail: { id: 'adapter.check' },
      } as never);

      expect(handled).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode ?? 0;
    }
  });

  for (const envKey of ['TRAILS_JSON', 'TRAILS_JSONL'] as const) {
    test(`lets ${envKey}=1 use structured output`, () => {
      const previousExitCode = process.exitCode;
      const previousValue = process.env[envKey];
      try {
        process.exitCode = 0;
        process.env[envKey] = '1';

        const handled = tryAdapterCheckOutput({
          flags: {},
          result: Result.ok({ formatted: 'adapter report', passed: false }),
          topoName: 'trails',
          trail: { id: 'adapter.check' },
        } as never);

        expect(handled).toBe(false);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode ?? 0;
        if (previousValue === undefined) {
          if (envKey === 'TRAILS_JSON') {
            delete process.env.TRAILS_JSON;
          } else {
            delete process.env.TRAILS_JSONL;
          }
        } else {
          process.env[envKey] = previousValue;
        }
      }
    });
  }
});
