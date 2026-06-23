import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, test } from 'bun:test';

import { parseWardenCommandArgs, runWardenCommand } from '../command.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), 'warden-command-'));

describe('parseWardenCommandArgs', () => {
  test('expands presets and generic CLI value aliases', () => {
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

  test('accepts canonical enum flag values alongside value aliases', () => {
    const parsed = parseWardenCommandArgs([
      '--format',
      'github',
      '--lock',
      'refresh',
      '--drafts',
      'only',
    ]);

    expect(parsed.cli).toMatchObject({
      drafts: 'only',
      format: 'github',
      lock: 'refresh',
    });
    expect(parsed.diagnostics).toEqual([]);
  });

  test('reports invalid canonical enum flag values', () => {
    const parsed = parseWardenCommandArgs(['--format', 'xml']);

    expect(parsed.diagnostics[0]?.message).toContain(
      'Invalid --format value "xml". Expected one of: summary, github, json.'
    );
  });

  test('parses --fix as a boolean flag', () => {
    expect(parseWardenCommandArgs(['--fix']).fix).toBe(true);
    expect(parseWardenCommandArgs(['--fix']).diagnostics).toEqual([]);
  });

  test('defaults --fix to false when absent', () => {
    expect(parseWardenCommandArgs([]).fix).toBe(false);
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

  test('--fix threads through to the runner and reports review-only fixes as skipped', async () => {
    const dir = makeTempDir();
    try {
      const filePath = join(dir, 'legacy.ts');
      const source = '// references authLayer in a note';
      writeFileSync(filePath, source);

      const result = await runWardenCommand({
        args: ['--fix', '--depth', 'source', '--lock', 'skip'],
        cwd: dir,
        env: {},
      });

      expect(result.report.fixes).toBeDefined();
      expect(result.report.fixes?.applied).toBe(0);
      expect(result.report.fixes?.filesChanged).toBe(0);
      expect(result.report.fixes?.skipped).toBeGreaterThanOrEqual(1);
      expect(result.output).toContain('**Fixes:** 0 applied, 0 files changed,');
      // Review-only legacy fixes never rewrite source.
      expect(readFileSync(filePath, 'utf8')).toBe(source);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('omits the fix summary when --fix is not passed', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'legacy.ts'),
        '// references authLayer in a note'
      );

      const result = await runWardenCommand({
        args: ['--depth', 'source', '--lock', 'skip'],
        cwd: dir,
        env: {},
      });

      expect(result.report.fixes).toBeUndefined();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('--fix JSON output includes the fix summary', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'legacy.ts'),
        '// references authLayer in a note'
      );

      const result = await runWardenCommand({
        args: [
          '--fix',
          '--format',
          'json',
          '--depth',
          'source',
          '--lock',
          'skip',
        ],
        cwd: dir,
        env: {},
      });
      const output = JSON.parse(result.output) as {
        readonly fixes?: {
          readonly applied: number;
          readonly filesChanged: number;
          readonly skipped: number;
        };
      };

      expect(output.fixes).toEqual(result.report.fixes);
      expect(output.fixes?.applied).toBe(0);
      expect(output.fixes?.filesChanged).toBe(0);
      expect(output.fixes?.skipped).toBeGreaterThanOrEqual(1);
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

  test('loads a root trails.config.json warden section when present', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'trails.config.json'),
        `${JSON.stringify({ warden: { depth: 'source', lock: 'skip' } })}\n`
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

  test('discovers root config and project-local rules from nested cwd', async () => {
    const dir = makeTempDir();
    try {
      const nested = join(dir, 'packages', 'app', 'src');
      mkdirSync(join(dir, '.trails'), { recursive: true });
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(dir, 'trails.config.ts'),
        `export default { warden: { depth: 'source', lock: 'skip' } };\n`
      );
      writeFileSync(
        join(dir, '.trails', 'rules.ts'),
        `export const rule = {
  name: 'nested-root-project-rule',
  severity: 'error',
  description: 'Nested cwd fixture rule.',
  check(sourceCode, filePath) {
    return sourceCode.includes('nestedRootProblem')
      ? [{ filePath, line: 1, message: 'Nested root fixture marker found.', rule: 'nested-root-project-rule', severity: 'error' }]
      : [];
  },
};\n`
      );
      const sourcePath = join(dir, 'fixture.ts');
      writeFileSync(sourcePath, 'const nestedRootProblem = 1;\n');

      const result = await runWardenCommand({ cwd: nested, env: {} });

      expect(result.report.effectiveConfig).toMatchObject({
        depth: 'source',
        lock: 'skip',
      });
      expect(result.report.diagnostics).toContainEqual(
        expect.objectContaining({
          filePath: sourcePath,
          message: 'Nested root fixture marker found.',
          rule: 'nested-root-project-rule',
        })
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('explicit --root-dir wins over nested cwd discovery', async () => {
    const dir = makeTempDir();
    try {
      const explicitRoot = join(dir, 'explicit');
      const discoveredRoot = join(dir, 'discovered');
      const nested = join(discoveredRoot, 'packages', 'app', 'src');
      mkdirSync(explicitRoot, { recursive: true });
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(explicitRoot, 'trails.config.ts'),
        `export default { warden: { depth: 'source', lock: 'skip' } };\n`
      );
      writeFileSync(
        join(discoveredRoot, 'trails.config.ts'),
        `export default { warden: { depth: 'project', lock: 'skip' } };\n`
      );

      const result = await runWardenCommand({
        args: ['--root-dir', explicitRoot],
        cwd: nested,
        env: {},
      });

      expect(result.report.effectiveConfig).toMatchObject({
        depth: 'source',
        lock: 'skip',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
