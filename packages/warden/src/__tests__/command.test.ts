import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, test } from 'bun:test';

import { parseWardenCommandArgs, runWardenCommand } from '../command.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), 'warden-command-'));

describe('parseWardenCommandArgs', () => {
  test('expands presets and local aliases without @ontrails/cli alias generalization', () => {
    const parsed = parseWardenCommandArgs([
      '--ci',
      '--json',
      '--strict',
      '--cached',
      '--exclude-drafts',
      '-a',
      'trails,admin',
      '--no-lock-mutation',
    ]);

    expect(parsed.ci).toBe(true);
    expect(parsed.cli).toMatchObject({
      apps: ['trails', 'admin'],
      depth: 'all',
      drafts: 'exclude',
      failOn: 'warning',
      format: 'json',
      lock: 'cached',
      noLockMutation: true,
    });
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe('runWardenCommand', () => {
  test('pre-push preset is permissive when no app topo can be discovered', async () => {
    const dir = makeTempDir();
    try {
      const result = await runWardenCommand({
        args: ['--pre-push', '--lock', 'skip'],
        cwd: dir,
        env: {},
      });

      expect(result.exitCode).toBe(0);
      expect(
        result.report.diagnostics.some(
          (diagnostic) => diagnostic.rule === 'topo-load'
        )
      ).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('ci preset fails when topo-aware checks cannot load an app', async () => {
    const dir = makeTempDir();
    try {
      const result = await runWardenCommand({
        args: ['--ci', '--lock', 'skip', '--format', 'json'],
        cwd: dir,
        env: {},
      });
      const output = JSON.parse(result.output) as {
        readonly diagnostics: readonly { readonly rule: string }[];
      };

      expect(result.exitCode).toBe(1);
      expect(output.diagnostics[0]?.rule).toBe('topo-load');
      expect(result.report.diagnostics[0]).toMatchObject({
        rule: 'topo-load',
        severity: 'error',
      });
      expect(result.report.diagnostics[0]?.message).toContain('--apps');
      expect(result.report.diagnostics[0]?.message).not.toContain('--module');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('ci topo ambiguity diagnostics point at warden app selection', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'apps', 'primary', 'src'), { recursive: true });
      mkdirSync(join(dir, 'apps', 'admin', 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'apps', 'primary', 'src', 'app.ts'),
        'export {};\n'
      );
      writeFileSync(
        join(dir, 'apps', 'admin', 'src', 'app.ts'),
        'export {};\n'
      );

      const result = await runWardenCommand({
        args: ['--ci', '--lock', 'skip', '--format', 'json'],
        cwd: dir,
        env: {},
      });

      expect(result.exitCode).toBe(1);
      expect(result.report.diagnostics[0]).toMatchObject({
        rule: 'topo-load',
        severity: 'error',
      });
      expect(result.report.diagnostics[0]?.message).toContain('--apps');
      expect(result.report.diagnostics[0]?.message).not.toContain('--module');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('loads a root trails.config.ts warden section when present', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'trails.config.ts'),
        `export default { warden: { depth: 'source', lock: 'skip' } };\n`
      );

      const result = await runWardenCommand({ cwd: dir, env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.report.effectiveConfig).toMatchObject({
        depth: 'source',
        lock: 'skip',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
