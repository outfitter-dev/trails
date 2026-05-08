import type { ActionResultContext } from '@ontrails/cli';
import { Result } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryWardenOutput } from '../run-warden.js';
import { buildWardenCommandArgs, wardenTrail } from '../trails/warden.js';

const wardenBinPath = fileURLToPath(
  new URL('../../../../packages/warden/bin/warden.ts', import.meta.url)
);
const trailsBinPath = fileURLToPath(
  new URL('../../bin/trails.ts', import.meta.url)
);
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const cliTimeoutMs = 30_000;

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `trails-warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

interface WardenJsonOutput {
  readonly diagnostics: readonly {
    readonly rule: string;
    readonly severity: 'error' | 'warn';
  }[];
  readonly passed: boolean;
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
  };
}

interface CliRun {
  readonly exitCode: number;
  readonly json: WardenJsonOutput;
  readonly stderr: string;
  readonly stdout: string;
}

const runCli = (
  binPath: string,
  args: readonly string[],
  cwd: string
): CliRun => {
  const command = [process.execPath, binPath, ...args];
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
        `Warden CLI subprocess ${proc.exitedDueToTimeout ? 'timed out' : 'terminated'} before producing JSON output.`,
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

  let json: WardenJsonOutput;
  try {
    json = JSON.parse(stdout) as WardenJsonOutput;
  } catch (error) {
    throw new Error(
      [
        `Failed to parse JSON output from ${binPath}`,
        `command: ${command.join(' ')}`,
        `cwd: ${cwd}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${proc.signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n'),
      { cause: error }
    );
  }

  return {
    exitCode: proc.exitCode ?? -1,
    json,
    stderr,
    stdout,
  };
};

const writeProjectOnlyErrorFixture = (dir: string): void => {
  writeFileSync(
    join(dir, 'project-only.ts'),
    `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => Result.ok({ ok: true }),
});`
  );
};

const writeAllDepthWarningFixture = (dir: string): void => {
  writeFileSync(
    join(dir, 'warning-only.ts'),
    `trail('entity.show', {
  input: z.object({ firstName: z.string() }),
  fields: {
    firstName: { label: 'First Name' },
  },
  blaze: async () => Result.ok({ ok: true }),
});`
  );
};

describe('trails warden', () => {
  test('projects final Warden flags into the shared command surface', () => {
    const args = buildWardenCommandArgs({
      apps: ['trails', 'demo'],
      cached: true,
      ci: true,
      depth: 'topo',
      drafts: 'include',
      excludeDrafts: true,
      failOn: 'error',
      format: 'summary',
      github: true,
      includeDrafts: false,
      json: false,
      lock: 'auto',
      noLockMutation: true,
      onlyDrafts: false,
      prePush: false,
      refresh: false,
      skipLock: false,
      strict: true,
      summary: false,
    });

    expect(args).toEqual([
      '--ci',
      '--depth',
      'topo',
      '--strict',
      '--github',
      '--cached',
      '--exclude-drafts',
      '--no-lock-mutation',
      '--apps',
      'trails,demo',
    ]);
  });

  test('runs through the shared Warden command and returns formatted output', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("hello", {
  blaze: async () => {
    throw new Error("boom");
  },
});`
      );

      const result = await wardenTrail.blaze(
        { depth: 'source', format: 'summary', lock: 'skip', rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.passed).toBe(false);
      expect(result.value.errorCount).toBe(1);
      expect(result.value.formatted).toContain('## Warden Report');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('format aliases produce raw Warden formatter output', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {};');

      const result = await wardenTrail.blaze(
        { depth: 'source', json: true, lock: 'skip', rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(JSON.parse(result.value.formatted)).toMatchObject({
        passed: true,
        summary: { errors: 0, warnings: 0 },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('onResult bridge writes formatted output and sets the exit code', () => {
    const originalWrite = process.stdout.write;
    const originalExitCode = process.exitCode;
    let output = '';
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;
    process.exitCode = undefined;

    try {
      const handled = tryWardenOutput({
        args: {},
        flags: {},
        input: {},
        result: Result.ok({ formatted: 'warden says no', passed: false }),
        topoName: 'trails',
        trail: wardenTrail as unknown as ActionResultContext['trail'],
      });

      expect(handled).toBe(true);
      expect(output).toBe('warden says no\n');
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
      // Bun does not clear a non-zero exitCode when assigned undefined.
      process.exitCode = originalExitCode ?? 0;
    }
  });

  test.each([
    {
      depth: 'source',
      expectedErrors: 0,
      expectedExitCode: 0,
      expectedRule: undefined,
      expectedWarnings: 0,
      failOn: 'error',
      fixture: writeProjectOnlyErrorFixture,
      name: 'source/error ignores project-only findings',
    },
    {
      depth: 'source',
      expectedErrors: 0,
      expectedExitCode: 0,
      expectedRule: undefined,
      expectedWarnings: 0,
      failOn: 'warning',
      fixture: writeAllDepthWarningFixture,
      name: 'source/warning ignores advisory findings',
    },
    {
      depth: 'project',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'error',
      fixture: writeProjectOnlyErrorFixture,
      name: 'project/error fails on project findings',
    },
    {
      depth: 'project',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'warning',
      fixture: writeProjectOnlyErrorFixture,
      name: 'project/warning still fails on errors',
    },
    {
      depth: 'topo',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'error',
      fixture: writeProjectOnlyErrorFixture,
      name: 'topo/error includes shallower project findings',
    },
    {
      depth: 'topo',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'warning',
      fixture: writeProjectOnlyErrorFixture,
      name: 'topo/warning still fails on errors',
    },
    {
      depth: 'all',
      expectedErrors: 0,
      expectedExitCode: 0,
      expectedRule: 'prefer-schema-inference',
      expectedWarnings: 1,
      failOn: 'error',
      fixture: writeAllDepthWarningFixture,
      name: 'all/error reports warnings without failing',
    },
    {
      depth: 'all',
      expectedErrors: 0,
      expectedExitCode: 1,
      expectedRule: 'prefer-schema-inference',
      expectedWarnings: 1,
      failOn: 'warning',
      fixture: writeAllDepthWarningFixture,
      name: 'all/warning fails on warning-only findings',
    },
  ] as const)(
    'acceptance: $name across Warden bin and trails warden',
    ({
      depth,
      expectedErrors,
      expectedExitCode,
      expectedRule,
      expectedWarnings,
      failOn,
      fixture,
    }) => {
      const dir = makeTempDir();
      try {
        fixture(dir);
        const args = [
          '--depth',
          depth,
          '--fail-on',
          failOn,
          '--lock',
          'skip',
          '--format',
          'json',
          '--root-dir',
          dir,
        ];
        const warden = runCli(wardenBinPath, args, repoRoot);
        const trails = runCli(trailsBinPath, ['warden', ...args], repoRoot);

        expect(warden.exitCode).toBe(expectedExitCode);
        expect(trails.exitCode).toBe(expectedExitCode);
        expect(warden.stderr).toBe('');
        expect(trails.stderr).toBe('');
        expect(warden.json).toEqual(trails.json);
        expect(warden.json.passed).toBe(expectedExitCode === 0);
        expect(warden.json.summary).toMatchObject({
          errors: expectedErrors,
          warnings: expectedWarnings,
        });
        if (expectedRule === undefined) {
          expect(warden.json.diagnostics).toHaveLength(0);
        } else {
          expect(warden.json.diagnostics.map((entry) => entry.rule)).toContain(
            expectedRule
          );
        }
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  );
});
