import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
const binPath = join(repoRoot, 'apps/ci/bin/ci.ts');
const tempRoots: string[] = [];

interface CliRunResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const runCli = (
  rootDir: string,
  options: {
    readonly failOn: 'error' | 'warning';
    readonly format?: 'github' | 'json' | 'summary';
  }
): CliRunResult => {
  const proc = Bun.spawnSync({
    cmd: [
      'bun',
      binPath,
      '--root-dir',
      rootDir,
      '--fail-on',
      options.failOn,
      '--format',
      options.format ?? 'github',
    ],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  return {
    exitCode: proc.exitCode,
    stderr: proc.stderr.toString(),
    stdout: proc.stdout.toString(),
  };
};

const createFixtureRoot = (sourceFileContents: string): string => {
  const rootDir = mkdtempSync(join(tmpdir(), 'trails-ci-governance-'));
  tempRoots.push(rootDir);
  const srcDir = join(rootDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'fixture.ts'), sourceFileContents);
  return rootDir;
};

afterEach(() => {
  while (tempRoots.length > 0) {
    const rootDir = tempRoots.pop();
    if (!rootDir) {
      continue;
    }
    rmSync(rootDir, { force: true, recursive: true });
  }
});

describe('apps/ci bin', () => {
  test('exits non-zero and emits GitHub annotations for error-level findings', () => {
    const result = runCli(
      createFixtureRoot(`import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const badTrail = trail('fixture.bad-trail', {
  blaze: () => {
    throw new Error('boom');
    return Result.ok({ ok: true });
  },
  description: 'Fixture trail with an implementation throw for CI smoke tests',
  examples: [{ input: {}, name: 'Default run' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});
`),
      { failOn: 'error' }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('::error');
    expect(result.stdout).toContain('title=no-throw-in-implementation');
  });

  test('keeps warning-only findings non-blocking when failOn is error', () => {
    const result = runCli(
      createFixtureRoot(`import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const internalTrail = trail('fixture.internal-trail', {
  blaze: () => Result.ok({ ok: true }),
  description:
    'Fixture internal trail with no crossings or activation for CI smoke tests',
  examples: [{ input: {}, name: 'Default run' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  visibility: 'internal',
});
`),
      { failOn: 'error' }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('::warning');
    expect(result.stdout).toContain('title=dead-internal-trail');
  });

  test('promotes warning-only findings to blocking when failOn is warning', () => {
    const result = runCli(
      createFixtureRoot(`import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const internalTrail = trail('fixture.internal-trail', {
  blaze: () => Result.ok({ ok: true }),
  description:
    'Fixture internal trail with no crossings or activation for CI smoke tests',
  examples: [{ input: {}, name: 'Default run' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  visibility: 'internal',
});
`),
      { failOn: 'warning' }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('::warning');
    expect(result.stdout).toContain('title=dead-internal-trail');
  });
});
