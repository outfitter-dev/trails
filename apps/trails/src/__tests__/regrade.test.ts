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
      expect(result.value.run?.preserveInventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: expect.arrayContaining(['**/*.ts']),
            pattern: expect.stringContaining('facetId'),
            reason: 'current-live-mcp-facet-field',
            source: 'derived-live-api',
          }),
          expect.objectContaining({
            pattern: expect.stringContaining('wayfind\\.facets'),
            reason: 'current-live-trail-id',
            source: 'derived-live-api',
          }),
        ])
      );
      expect(result.value.run?.ledger.forms).toEqual({
        facet: 'modified',
        facetId: 'skipped',
        facets: 'skipped',
      });
      expect(
        result.value.run?.ledger.occurrences.map((occurrence) => ({
          disposition: occurrence.disposition,
          form: occurrence.form,
          replacement: occurrence.replacement,
          verdict: occurrence.verdict,
        }))
      ).toEqual(
        expect.arrayContaining([
          {
            disposition: 'in-family-modified',
            form: 'facet',
            replacement: 'trailhead',
            verdict: 'modified',
          },
          {
            disposition: 'in-family-modified',
            form: 'facet',
            replacement: 'trailhead',
            verdict: 'modified',
          },
          {
            disposition: 'in-family-modified',
            form: 'facet',
            replacement: 'trailhead',
            verdict: 'modified',
          },
          {
            disposition: 'preserve-current-live-api',
            form: 'facetId',
            replacement: undefined,
            verdict: 'skipped',
          },
          {
            disposition: 'preserve-current-live-api',
            form: 'facets',
            replacement: undefined,
            verdict: 'skipped',
          },
        ])
      );
      expect(result.value.run?.ledger.occurrences).toHaveLength(5);
      expect(result.value.run?.report).toMatchObject({
        applied: 0,
        deferred: 0,
        dispositions: {
          'in-family-modified': 3,
          'preserve-current-live-api': 2,
        },
        gate: {
          reasons: ['safe-modifications-not-yet-applied'],
          remaining: 3,
          remainingByDisposition: {
            'in-family-modified': 3,
          },
          status: 'open',
        },
        modified: 3,
        open: 3,
        skipped: 2,
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
        applied: 4,
        filesChanged: 2,
        review: 1,
        skipped: 1,
      });
      expect(result.value.run?.report).toMatchObject({
        applied: 4,
        deferred: 1,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 1,
          status: 'open',
        },
        modified: 0,
        open: 1,
        skipped: 1,
      });
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'Facet docs mention trailhead and trailheads.\n'
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

  test('CLI runs governed symbol renames from the registry-backed command path', () => {
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

      const result = runRawCli([
        'regrade',
        'facet',
        'trailhead',
        '--include',
        'src/**/*.ts',
        '--include-entries',
        'all',
        '--root-dir',
        dir,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly entries?: readonly {
          readonly classId?: string;
          readonly outcome?: string;
          readonly path?: string;
        }[];
        readonly selectedClassIds?: readonly string[];
      };
      expect(parsed.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
      );
      expect(parsed.selectedClassIds).not.toContain(
        'ast-symbol-rename:v1-facet-trailhead:facetId->trailheadId'
      );
      expect(parsed.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: 'ast-symbol-rename:v1-facet-trailhead:facet->trailhead',
            outcome: 'rewrite',
            path: 'src/surface.ts',
          }),
        ])
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI skips governed symbol renames when explicit extensions exclude source code', () => {
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

      const result = runRawCli([
        'regrade',
        'facet',
        'trailhead',
        '--extensions',
        '.md',
        '--include-entries',
        'all',
        '--root-dir',
        dir,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly selectedClassIds?: readonly string[];
      };
      expect(parsed.selectedClassIds).toEqual(['v1-facet-trailhead']);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI regrade uses governed registry review forms', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/blaze.ts',
        'export const blaze = "safe";\nexport const blazing = "review";\n'
      );

      const result = runRawCli([
        'regrade',
        'blaze',
        'implementation',
        '--root-dir',
        dir,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly ledger?: {
            readonly forms?: Record<string, string>;
            readonly occurrences?: readonly {
              readonly form?: string;
              readonly verdict?: string;
            }[];
          };
          readonly plan?: {
            readonly deferForms?: readonly string[];
            readonly id?: string;
          };
          readonly report?: {
            readonly gate?: { readonly reasons?: readonly string[] };
          };
        };
      };
      expect(parsed.run?.plan).toMatchObject({
        deferForms: expect.arrayContaining(['blazing']),
        id: 'v1-blaze-implementation',
      });
      expect(parsed.run?.ledger?.forms).toMatchObject({
        blaze: 'modified',
        blazing: 'deferred',
      });
      expect(parsed.run?.ledger?.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ form: 'blazing', verdict: 'deferred' }),
        ])
      );
      expect(parsed.run?.report?.gate?.reasons).toContain(
        'deferred-forms-or-occurrences'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI accepts path-scope exclude globs for vocabulary regrades', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, '.agents/notes/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        '.agents/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );
      writeFile(dir, '.scratch/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        'plugin/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );

      const result = runRawCli([
        'regrade',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--exclude',
        '.scratch/**',
        '--exclude',
        '.agents/notes/**',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly ledger?: {
            readonly occurrences?: readonly { readonly path: string }[];
          };
          readonly plan?: { readonly scope?: { readonly exclude?: string[] } };
        };
        readonly scan?: {
          readonly byDirectory?: readonly {
            readonly files: number;
            readonly occurrences?: number;
            readonly path: string;
          }[];
          readonly byExtension?: readonly {
            readonly extension: string;
            readonly files: number;
            readonly occurrences?: number;
          }[];
          readonly files?: {
            readonly matched: number;
            readonly scanned: number;
            readonly skipped: number;
          };
        };
        readonly skipsByReason?: Record<string, number>;
      };
      expect(parsed.run?.plan?.scope?.exclude).toEqual([
        '.scratch/**',
        '.agents/notes/**',
      ]);
      expect(parsed.run?.ledger?.occurrences?.map((o) => o.path)).toEqual([
        '.agents/skills/trails/SKILL.ts',
        'plugin/skills/trails/SKILL.ts',
      ]);
      expect(parsed.scan?.files).toEqual({
        matched: 2,
        scanned: 2,
        skipped: 2,
      });
      expect(parsed.scan?.byDirectory).toEqual([
        { files: 1, occurrences: 1, path: '.agents' },
        { files: 1, occurrences: 1, path: 'plugin' },
      ]);
      expect(parsed.scan?.byExtension).toEqual([
        { extension: '.ts', files: 2, occurrences: 2 },
      ]);
      expect(parsed.skipsByReason).toMatchObject({ 'ignored-glob': 2 });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI accepts structured preserve rules through input json', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facetId = "preserved";\n');
      writeFile(dir, 'docs/surface.md', 'The facetId field needs review.\n');

      const input = {
        from: 'facet',
        include: ['src/**', 'docs/**'],
        preserve: [
          {
            disposition: 'preserve-current-live-api',
            paths: ['src/**'],
            pattern: '^facetId$',
            reason: 'live-api-identifier',
          },
        ],
        to: 'trailhead',
      };

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify(input),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly ledger?: {
            readonly occurrences?: readonly {
              readonly disposition: string;
              readonly form: string;
              readonly path: string;
              readonly reason: string;
              readonly verdict: string;
            }[];
          };
          readonly plan?: {
            readonly preserve?: readonly {
              readonly disposition?: string;
              readonly paths?: readonly string[];
              readonly pattern?: string;
              readonly reason?: string;
            }[];
          };
          readonly preserveInventory?: readonly {
            readonly evidence?: readonly string[];
            readonly pattern?: string;
            readonly reason?: string;
            readonly source?: string;
          }[];
          readonly report?: {
            readonly deferred?: number;
            readonly dispositions?: Readonly<Record<string, number>>;
            readonly modified?: number;
            readonly skipped?: number;
          };
        };
      };
      expect(parsed.run?.plan?.preserve).toEqual([
        {
          disposition: 'preserve-current-live-api',
          paths: ['src/**'],
          pattern: '^facetId$',
          reason: 'live-api-identifier',
        },
      ]);
      expect(parsed.run?.preserveInventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: expect.arrayContaining(['**/*.ts']),
            pattern: expect.stringContaining('facetId'),
            reason: 'current-live-mcp-facet-field',
            source: 'derived-live-api',
          }),
        ])
      );
      expect(
        parsed.run?.ledger?.occurrences?.map((occurrence) => ({
          disposition: occurrence.disposition,
          form: occurrence.form,
          path: occurrence.path,
          reason: occurrence.reason,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        {
          disposition: 'in-family-unresolved',
          form: 'facetId',
          path: 'docs/surface.md',
          reason: 'unclassified-neighbor',
          verdict: 'deferred',
        },
        {
          disposition: 'preserve-current-live-api',
          form: 'facetId',
          path: 'src/surface.ts',
          reason: 'live-api-identifier',
          verdict: 'skipped',
        },
      ]);
      expect(parsed.run?.report).toMatchObject({
        deferred: 1,
        dispositions: {
          'in-family-unresolved': 1,
          'preserve-current-live-api': 1,
        },
        modified: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('derived live API preserves match the occurrence span, not just the line', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        [
          "ctx.compose('wayfind.facets', { facets });",
          'export type McpSurfaceFacetMap = Record<string, unknown>;',
          'export interface Options {',
          '  readonly facets?: McpSurfaceFacetMap | undefined;',
          '}',
          '',
        ].join('\n')
      );

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        'facet',
        'trailhead',
        '--apply',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const source = readFileSync(join(dir, 'src', 'surface.ts'), 'utf8');
      expect(source).toContain(
        "ctx.compose('wayfind.facets', { trailheads });"
      );
      expect(source).toContain(
        'readonly facets?: McpSurfaceFacetMap | undefined;'
      );

      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly ledger?: {
            readonly occurrences?: readonly {
              readonly context: string;
              readonly form: string;
              readonly reason: string;
              readonly verdict: string;
            }[];
          };
        };
      };
      const liveApiOccurrences = parsed.run?.ledger?.occurrences
        ?.filter(
          (occurrence) =>
            occurrence.form === 'facets' ||
            occurrence.form === 'McpSurfaceFacetMap'
        )
        .map((occurrence) => ({
          context: occurrence.context,
          form: occurrence.form,
          reason: occurrence.reason,
          verdict: occurrence.verdict,
        }));
      expect(liveApiOccurrences).toEqual(
        expect.arrayContaining([
          {
            context: "ctx.compose('wayfind.facets', { trailheads });",
            form: 'facets',
            reason: 'current-live-trail-id',
            verdict: 'skipped',
          },
          {
            context:
              'export type McpSurfaceFacetMap = Record<string, unknown>;',
            form: 'McpSurfaceFacetMap',
            reason: 'current-live-mcp-facet-type',
            verdict: 'skipped',
          },
          {
            context: 'readonly facets?: McpSurfaceFacetMap | undefined;',
            form: 'facets',
            reason: 'current-live-mcp-facets-property',
            verdict: 'skipped',
          },
          {
            context: 'readonly facets?: McpSurfaceFacetMap | undefined;',
            form: 'McpSurfaceFacetMap',
            reason: 'current-live-mcp-facet-type',
            verdict: 'skipped',
          },
        ])
      );
      expect(
        liveApiOccurrences?.every(
          (occurrence) => occurrence.verdict === 'skipped'
        )
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI forwards form-scoped preserve rules from input json', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/api.ts', 'export const legacyId = legacy;\n');

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          from: 'legacy',
          include: ['src/**'],
          preserve: [
            {
              disposition: 'preserve-current-live-api',
              forms: ['legacyId'],
              pattern: String.raw`\blegacyId\b\s*=`,
              reason: 'current-live-api-field',
            },
          ],
          to: 'current',
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly ledger?: {
            readonly occurrences?: readonly {
              readonly disposition: string;
              readonly form: string;
              readonly reason: string;
              readonly verdict: string;
            }[];
          };
          readonly plan?: {
            readonly preserve?: readonly {
              readonly forms?: readonly string[];
              readonly pattern?: string;
            }[];
          };
          readonly report?: {
            readonly modified?: number;
            readonly skipped?: number;
          };
        };
      };
      expect(parsed.run?.plan?.preserve?.[0]).toMatchObject({
        forms: ['legacyId'],
        pattern: String.raw`\blegacyId\b\s*=`,
      });
      expect(
        parsed.run?.ledger?.occurrences?.map((occurrence) => ({
          disposition: occurrence.disposition,
          form: occurrence.form,
          reason: occurrence.reason,
          verdict: occurrence.verdict,
        }))
      ).toEqual(
        expect.arrayContaining([
          {
            disposition: 'preserve-current-live-api',
            form: 'legacyId',
            reason: 'current-live-api-field',
            verdict: 'skipped',
          },
          {
            disposition: 'in-family-modified',
            form: 'legacy',
            reason: 'captured-form',
            verdict: 'modified',
          },
        ])
      );
      expect(parsed.run?.report).toMatchObject({
        modified: 1,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI honors apply mode from input json without --apply', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'The facet docs are ready.\n');

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          apply: true,
          from: 'facet',
          include: ['docs/**'],
          to: 'trailhead',
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly apply?: {
          readonly applied?: number;
          readonly filesChanged?: number;
        };
        readonly run?: {
          readonly report?: {
            readonly applied?: number;
            readonly gate?: {
              readonly status?: string;
            };
          };
        };
      };
      expect(parsed.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
      });
      expect(parsed.run?.report).toMatchObject({
        applied: 1,
        gate: { status: 'green' },
      });
      expect(readFileSync(join(dir, 'docs/surface.md'), 'utf8')).toBe(
        'The trailhead docs are ready.\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI accepts path-scope exclude globs for class-mode apply', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        '.scratch/play.ts',
        'export const play = trail("play", { crosses: [] });\n'
      );
      writeFile(
        dir,
        'src/play.ts',
        'export const play = trail("play", { crosses: [] });\n'
      );

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--class-ids',
        'term-rewrite:no-retired-cross-vocabulary',
        '--exclude',
        '.scratch/**',
        '--apply',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly apply?: {
          readonly applied?: number;
          readonly filesChanged?: number;
        };
        readonly skipsByReason?: Record<string, number>;
      };
      expect(parsed.apply).toMatchObject({ applied: 1, filesChanged: 1 });
      expect(parsed.skipsByReason).toMatchObject({ 'ignored-glob': 1 });
      expect(readFileSync(join(dir, '.scratch', 'play.ts'), 'utf8')).toContain(
        'crosses'
      );
      expect(readFileSync(join(dir, 'src', 'play.ts'), 'utf8')).toContain(
        'composes'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI applies config scope defaults to class-mode apply', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'trails.config.json',
        JSON.stringify({
          regrade: {
            scope: { exclude: ['.scratch/**'] },
          },
        })
      );
      writeFile(
        dir,
        '.scratch/play.ts',
        'export const play = trail("play", { crosses: [] });\n'
      );
      writeFile(
        dir,
        'src/play.ts',
        'export const play = trail("play", { crosses: [] });\n'
      );

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--class-ids',
        'term-rewrite:no-retired-cross-vocabulary',
        '--config-path',
        'trails.config.json',
        '--apply',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly apply?: {
          readonly applied?: number;
          readonly filesChanged?: number;
        };
        readonly scan?: {
          readonly skippedByReason?: Record<string, number>;
        };
      };
      expect(parsed.apply).toMatchObject({ applied: 1, filesChanged: 1 });
      expect(parsed.scan?.skippedByReason).toMatchObject({
        'ignored-glob': 1,
      });
      expect(readFileSync(join(dir, '.scratch', 'play.ts'), 'utf8')).toContain(
        'crosses'
      );
      expect(readFileSync(join(dir, 'src', 'play.ts'), 'utf8')).toContain(
        'composes'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('loads vocabulary scope defaults from trails config', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'trails.config.json',
        JSON.stringify({
          regrade: {
            scope: { exclude: ['.scratch/**', '.agents/notes/**'] },
          },
        })
      );
      writeFile(dir, '.agents/notes/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        '.agents/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );
      writeFile(dir, '.scratch/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        'plugin/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );

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
          readonly ledger?: {
            readonly occurrences?: readonly { readonly path: string }[];
          };
          readonly plan?: { readonly scope?: { readonly exclude?: string[] } };
        };
        readonly skipsByReason?: Record<string, number>;
      };
      expect(parsed.run?.plan?.scope?.exclude).toEqual([
        '.scratch/**',
        '.agents/notes/**',
      ]);
      expect(parsed.run?.ledger?.occurrences?.map((o) => o.path)).toEqual([
        '.agents/skills/trails/SKILL.ts',
        'plugin/skills/trails/SKILL.ts',
      ]);
      expect(parsed.skipsByReason).toMatchObject({ 'ignored-glob': 2 });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('explicit vocabulary scope overrides config defaults', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'trails.config.json',
        JSON.stringify({
          regrade: {
            scope: { exclude: ['.agents/notes/**'] },
          },
        })
      );
      writeFile(dir, '.agents/notes/history.ts', 'export const facet = 1;\n');
      writeFile(dir, '.scratch/history.ts', 'export const facet = 1;\n');
      writeFile(dir, 'src/keep.ts', 'export const facet = 1;\n');

      const result = await regradeTrail.blaze(
        {
          exclude: ['.scratch/**'],
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
      expect(result.value.run?.plan.scope?.exclude).toEqual(['.scratch/**']);
      expect(result.value.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        '.agents/notes/history.ts',
        'src/keep.ts',
      ]);
      expect(result.value.skipsByReason).toMatchObject({ 'ignored-glob': 1 });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('schema exposes regrade scope inputs for CLI and MCP callers', () => {
    const result = runRawCli(['schema', 'regrade']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly command?: {
        readonly flags?: readonly {
          readonly name?: string;
          readonly type?: string;
          readonly variadic?: boolean;
        }[];
        readonly input?: {
          readonly properties?: Record<string, unknown>;
        };
        readonly output?: {
          readonly properties?: Record<string, unknown>;
        };
      };
    };
    expect(parsed.command?.input?.properties).toHaveProperty('configPath');
    expect(parsed.command?.input?.properties).toHaveProperty('exclude');
    expect(parsed.command?.output?.properties).toHaveProperty('scan');
    expect(JSON.stringify(parsed.command?.input)).toContain('disposition');
    expect(JSON.stringify(parsed.command?.input)).toContain(
      'preserve-current-live-api'
    );
    expect(JSON.stringify(parsed.command?.output)).toContain('dispositions');
    expect(JSON.stringify(parsed.command?.output)).toContain(
      'remainingByDisposition'
    );
    expect(JSON.stringify(parsed.command?.output)).toContain(
      'in-family-unresolved'
    );
    expect(parsed.command?.flags).toContainEqual(
      expect.objectContaining({
        name: 'config-path',
        type: 'string',
        variadic: false,
      })
    );
    expect(parsed.command?.flags).toContainEqual(
      expect.objectContaining({
        name: 'exclude',
        type: 'string[]',
        variadic: true,
      })
    );
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
