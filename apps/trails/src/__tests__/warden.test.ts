import type { ActionResultContext } from '@ontrails/cli';
import { Result } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tryWardenOutput } from '../run-warden.js';
import { buildWardenCommandArgs, wardenTrail } from '../trails/warden.js';

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `trails-warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
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
});
