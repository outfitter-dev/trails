import { deriveCliCommands } from '@ontrails/cli';
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { operatorApp } from '../app.js';
import { regradeTrail } from '../trails/regrade.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), `trails-regrade-test-${Date.now()}-`));

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
        `Regrade CLI subprocess ${proc.exitedDueToTimeout ? 'timed out' : 'terminated'} before producing output.`,
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

const unwrapCommands = () => {
  const result = deriveCliCommands(operatorApp);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

describe('trails regrade', () => {
  test('projects regrade as a CLI command', () => {
    const commands = unwrapCommands();
    const command = commands.find(
      (candidate) => candidate.trail.id === 'regrade'
    );

    expect(command).toBeDefined();
    expect(command?.path).toEqual(['regrade']);
    expect(command?.args.map((arg) => arg.name).slice(0, 2)).toEqual([
      'from',
      'to',
    ]);
    expect(command?.trail.intent).toBe('write');
  });

  test('dry-runs vocabulary regrades with an occurrence-level ledger', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        [
          'export const facet = "facet";',
          'export const facetId = facet;',
          'export const facets = ["inspect"];',
          '',
        ].join('\n')
      );

      const result = await regradeTrail.blaze(
        {
          from: 'facet',
          include: ['src/**/*.ts'],
          rootDir: dir,
          to: 'trailhead',
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run?.plan).toMatchObject({
        from: 'facet',
        kind: 'vocabulary',
        to: 'trailhead',
      });
      expect(result.value.run?.ledger.forms).toEqual({
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
      expect(
        result.value.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          replacement: occurrence.replacement,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        { form: 'facet', replacement: 'trailhead', verdict: 'modified' },
        { form: 'facet', replacement: 'trailhead', verdict: 'modified' },
        { form: 'facet', replacement: 'trailhead', verdict: 'modified' },
        { form: 'facets', replacement: 'trailheads', verdict: 'modified' },
        { form: 'facetId', replacement: undefined, verdict: 'deferred' },
      ]);
      expect(result.value.run?.report).toMatchObject({
        applied: 0,
        deferred: 1,
        gate: {
          reasons: [
            'safe-modifications-not-yet-applied',
            'deferred-forms-or-occurrences',
          ],
          remaining: 5,
          status: 'open',
        },
        modified: 4,
        open: 5,
        skipped: 0,
      });
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('apply mode writes safe vocabulary regrades but keeps review inventory open', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        'Facet docs mention facet and facets.\n'
      );
      writeFile(
        dir,
        'src/surface.ts',
        'export const facetId = "manual";\nexport const facet = "facet";\n'
      );

      const result = await regradeTrail.blaze(
        {
          apply: true,
          extensions: ['.md', '.ts'],
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 5,
        filesChanged: 2,
        review: 1,
      });
      expect(result.value.run?.report).toMatchObject({
        applied: 5,
        deferred: 1,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 1,
          status: 'open',
        },
        modified: 0,
        open: 1,
      });
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'Trailhead docs mention trailhead and trailheads.\n'
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facetId'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI accepts regrade source and target as positional arguments', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facet = "facet";\n');

      const result = runRawCli([
        'regrade',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly plan?: { readonly from?: string; readonly to?: string };
          readonly report?: {
            readonly modified?: number;
            readonly open?: number;
          };
        };
      };
      expect(parsed.run?.plan).toMatchObject({
        from: 'facet',
        to: 'trailhead',
      });
      expect(parsed.run?.report?.modified).toBe(2);
      expect(parsed.run?.report?.open).toBe(2);
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects vocabulary-only inputs without a source and target', async () => {
    const dir = makeTempDir();
    try {
      const result = await regradeTrail.blaze(
        { include: ['src/**/*.ts'], rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toContain('requires both `from` and `to`');
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI rejects vocabulary-only inputs without a source and target', () => {
    const dir = makeTempDir();
    try {
      const result = runRawCli([
        'regrade',
        '--include',
        'src/**/*.ts',
        '--root-dir',
        dir,
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr) as {
        readonly error?: {
          readonly category?: string;
          readonly message?: string;
          readonly name?: string;
        };
        readonly ok?: boolean;
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatchObject({
        category: 'validation',
        name: 'ValidationError',
      });
      expect(parsed.error?.message).toContain('requires both `from` and `to`');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('dry-runs safe downstream rewrites by default', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'play.ts');
      writeFileSync(
        target,
        'export const play = trail("play", { crosses: [] });\n'
      );

      const result = await regradeTrail.blaze({ rootDir: dir }, {
        cwd: dir,
        env: {},
      } as never);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.rewritten).toBe(1);
      expect(result.value.apply).toBeUndefined();
      expect(readFileSync(target, 'utf8')).toContain('crosses');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('apply mode writes only safe downstream rewrites', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'play.ts');
      writeFileSync(
        target,
        'export const play = trail("play", { crosses: [] });\n'
      );

      const result = await regradeTrail.blaze({ apply: true, rootDir: dir }, {
        cwd: dir,
        env: {},
      } as never);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 0,
      });
      expect(readFileSync(target, 'utf8')).toContain('composes');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('loads project-local Warden term rewrites from the regrade root', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, '.trails'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'surface.ts');
      writeFileSync(target, 'export const facet = "inspect";\n');
      writeFileSync(
        join(dir, '.trails', 'rules.ts'),
        `
import type { WardenRule } from '@ontrails/warden';

const lineForOffset = (source: string, offset: number): number => {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.codePointAt(index) === 10) {
      line += 1;
    }
  }
  return line;
};

const rule = {
  check(sourceCode: string, filePath: string) {
    const diagnostics = [];
    const matcher = /\\bfacet\\b/g;
    for (const match of sourceCode.matchAll(matcher)) {
      const start = match.index ?? 0;
      diagnostics.push({
        filePath,
        fix: {
          class: 'term-rewrite',
          edits: [{ end: start + 'facet'.length, replacement: 'trailhead', start }],
          reason: "Rename 'facet' to 'trailhead'.",
          safety: 'safe',
        },
        line: lineForOffset(sourceCode, start),
        message: "Rename 'facet' to 'trailhead'.",
        rule: 'repo-local-facet-vocab',
        severity: 'error',
      });
    }
    return diagnostics;
  },
  description: 'Rename repo-local facet vocabulary.',
  metadata: {
    concern: 'meta',
    depth: 'source',
    fix: { class: 'term-rewrite', safety: 'safe' },
    invariant: 'Repo-local facet vocabulary migrates through Regrade.',
    lifecycle: { state: 'temporary', retireWhen: 'facet family cutover completes' },
    scope: 'repo-local',
    tier: 'source-static',
  },
  name: 'repo-local-facet-vocab',
  severity: 'error',
} satisfies WardenRule;

export default rule;
`
      );

      const result = await regradeTrail.blaze(
        {
          apply: true,
          classIds: ['term-rewrite:repo-local-facet-vocab'],
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.selectedClassIds).toEqual([
        'term-rewrite:repo-local-facet-vocab',
      ]);
      expect(result.value.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 0,
      });
      expect(readFileSync(target, 'utf8')).toContain('trailhead');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('apply mode returns a Trails error when a rewrite cannot be written', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'play.ts');
      writeFileSync(
        target,
        'export const play = trail("play", { crosses: [] });\n'
      );
      chmodSync(target, 0o444);

      const result = await regradeTrail.blaze({ apply: true, rootDir: dir }, {
        cwd: dir,
        env: {},
      } as never);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('InternalError');
      }
    } finally {
      chmodSync(join(dir, 'src', 'play.ts'), 0o644);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
