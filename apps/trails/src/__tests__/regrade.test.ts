import { deriveCliCommands } from '@ontrails/cli';
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
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
const facetTrailheadRegistryExcludes = [
  '.agents/memory/**',
  '.agents/plans/archive/**',
  '.changeset/**',
  '**/CHANGELOG.md',
  'packages/warden/src/rules/retired-vocabulary.ts',
];

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

const parseCliJson = <T>(run: RawCliRun): T => JSON.parse(run.stdout) as T;

const writeVocabularyTransitionRecord = (
  args: readonly string[],
  cwd: string = repoRoot
): string => {
  const result = runRawCli(
    ['regrade', ...args, '--write-record', '--json'],
    cwd
  );
  expect(result.exitCode).toBe(0);
  const parsed = parseCliJson<{
    readonly record?: { readonly path?: string; readonly status?: string };
  }>(result);
  expect(parsed.record).toMatchObject({ status: 'candidate' });
  if (parsed.record?.path === undefined) {
    throw new Error('Expected vocabulary transition record path.');
  }
  return parsed.record.path;
};

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

interface RegradeSchemaCommand {
  readonly commandPath?: readonly string[];
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
}

const expectRegradeSchemaFields = (
  command: RegradeSchemaCommand | undefined
) => {
  expect(command?.input?.properties).toHaveProperty('configPath');
  expect(command?.input?.properties).toHaveProperty('exclude');
  expect(command?.input?.properties).toHaveProperty('from');
  expect(command?.input?.properties).toHaveProperty('to');
  expect(command?.output?.properties).toHaveProperty('path');
  expect(command?.output?.properties).toHaveProperty('plan');
  expect(command?.output?.properties).toHaveProperty('provenance');
  expect(JSON.stringify(command?.input)).toContain('disposition');
  expect(JSON.stringify(command?.input)).toContain('preserve-current-live-api');
  expect(JSON.stringify(command?.output)).toContain('regrade-plan');
  expect(JSON.stringify(command?.output)).toContain('schemaVersion');
};

const expectRegradeSchemaFlags = (
  command: RegradeSchemaCommand | undefined
) => {
  expect(command?.flags).toContainEqual(
    expect.objectContaining({
      name: 'config-path',
      type: 'string',
      variadic: false,
    })
  );
  expect(command?.flags).toContainEqual(
    expect.objectContaining({
      name: 'exclude',
      type: 'string[]',
      variadic: true,
    })
  );
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
    const regradeCommands = commands
      .filter((candidate) => candidate.path[0] === 'regrade')
      .map((candidate) => ({
        id: candidate.trail.id,
        path: candidate.path,
      }))
      .toSorted((left, right) =>
        left.path.join(' ').localeCompare(right.path.join(' '))
      );

    expect(regradeCommands).toEqual([
      { id: 'regrade', path: ['regrade'] },
      { id: 'adjust.regrade', path: ['regrade', 'adjust'] },
      { id: 'apply.regrade', path: ['regrade', 'apply'] },
      { id: 'check.regrade', path: ['regrade', 'check'] },
      { id: 'plan.regrade', path: ['regrade', 'plan'] },
      { id: 'list.regrades', path: ['regrade', 'plans'] },
      { id: 'preview.regrade', path: ['regrade', 'preview'] },
    ]);
  });

  test('dry-runs vocabulary regrades with an occurrence-level ledger', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        [
          'The facet docs mention facetId.',
          'The facets docs mention grouping.',
          '',
        ].join('\n')
      );

      const result = await regradeTrail.blaze(
        {
          from: 'facet',
          include: ['docs/**/*.md'],
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
      expect(result.value.run?.preserveInventory).toBeUndefined();
      expect(result.value.run?.ledger.forms).toEqual({
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
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
            disposition: 'in-family-unresolved',
            form: 'facetId',
            replacement: undefined,
            verdict: 'deferred',
          },
          {
            disposition: 'in-family-modified',
            form: 'facets',
            replacement: 'trailheads',
            verdict: 'modified',
          },
        ])
      );
      expect(result.value.run?.ledger.occurrences).toHaveLength(3);
      expect(result.value.run?.report).toMatchObject({
        applied: 0,
        deferred: 1,
        dispositions: {
          'in-family-modified': 2,
          'in-family-unresolved': 1,
        },
        gate: {
          reasons: [
            'deferred-forms-or-occurrences',
            'safe-modifications-not-yet-applied',
          ],
          remaining: 3,
          remainingByDisposition: {
            'in-family-modified': 2,
            'in-family-unresolved': 1,
          },
          status: 'open',
        },
        modified: 2,
        open: 3,
        skipped: 1,
      });
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test(
    'CLI writes, previews, dry-runs, and applies Regrade plans',
    () => {
      const dir = makeTempDir();
      try {
        writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

        const planResult = runRawCli([
          'regrade',
          'plan',
          'facet',
          'trailhead',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(planResult.exitCode).toBe(0);
        const plan = parseCliJson<{
          readonly kind?: string;
          readonly path?: string;
          readonly plan?: { readonly from?: string; readonly to?: string };
        }>(planResult);
        expect(plan).toMatchObject({
          kind: 'regrade-plan',
          path: '.trails/regrade/facet-to-trailhead.json',
          plan: { from: 'facet', to: 'trailhead' },
        });
        if (plan.path === undefined) {
          throw new Error('Expected Regrade plan path.');
        }
        expect(existsSync(join(dir, plan.path))).toBe(true);

        const plansResult = runRawCli([
          'regrade',
          'plans',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(plansResult.exitCode).toBe(0);
        expect(parseCliJson(plansResult)).toMatchObject({
          plans: [
            {
              path: '.trails/regrade/facet-to-trailhead.json',
              status: 'active',
            },
          ],
        });

        const previewResult = runRawCli([
          'regrade',
          'preview',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(previewResult.exitCode).toBe(0);
        expect(parseCliJson(previewResult)).toMatchObject({
          plan: {
            path: '.trails/regrade/facet-to-trailhead.json',
            status: 'active',
          },
          run: {
            report: {
              gate: { status: 'open' },
            },
          },
        });

        const dryApplyResult = runRawCli([
          'regrade',
          'apply',
          '--root-dir',
          dir,
          '--dry-run',
          '--json',
        ]);
        expect(dryApplyResult.exitCode).toBe(0);
        expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toContain(
          'facet'
        );
        expect(existsSync(join(dir, plan.path))).toBe(true);

        const applyResult = runRawCli([
          'regrade',
          'apply',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(applyResult.exitCode).toBe(0);
        const applied = parseCliJson<{
          readonly history?: {
            readonly path?: string;
            readonly status?: string;
          };
        }>(applyResult);
        expect(applied.history).toMatchObject({
          path: '.trails/regrade/history/facet-to-trailhead.json',
          status: 'applied',
        });
        expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toContain(
          'trailhead'
        );
        expect(existsSync(join(dir, plan.path))).toBe(false);
        if (applied.history?.path === undefined) {
          throw new Error('Expected Regrade history path.');
        }
        const historyFile = join(dir, applied.history.path);
        expect(existsSync(historyFile)).toBe(true);

        // Re-plan the same transition over the migrated tree and re-apply: the
        // consolidated file gains a second run instead of a sibling file.
        const replanResult = runRawCli([
          'regrade',
          'plan',
          'facet',
          'trailhead',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(replanResult.exitCode).toBe(0);
        const reapplyResult = runRawCli([
          'regrade',
          'apply',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(reapplyResult.exitCode).toBe(0);
        const reapplied = parseCliJson<{
          readonly history?: {
            readonly path?: string;
            readonly status?: string;
          };
        }>(reapplyResult);
        expect(reapplied.history?.path).toBe(applied.history.path);

        interface HistoryFile {
          readonly id?: string;
          readonly kind?: string;
          readonly runs?: readonly {
            readonly lockHashAtRun?: string;
            readonly planContentHash?: string;
          }[];
          readonly schemaVersion?: number;
        }
        const consolidated = JSON.parse(
          readFileSync(historyFile, 'utf8')
        ) as HistoryFile;
        expect(consolidated.kind).toBe('regrade-history');
        expect(consolidated.schemaVersion).toBe(2);
        expect(consolidated.id).toMatch(/^[0-9a-f]{12}$/);
        expect(consolidated.runs).toHaveLength(2);
        expect(consolidated.runs?.[0]?.planContentHash).toBe(
          consolidated.runs?.[1]?.planContentHash ?? 'missing'
        );
        expect(consolidated.runs?.[0]?.lockHashAtRun).not.toBe(
          consolidated.runs?.[1]?.lockHashAtRun
        );

        // A third identical plan+apply over the unchanged tree is a replay: no
        // duplicate run is appended and the earlier stamps stay untouched.
        const thirdPlanResult = runRawCli([
          'regrade',
          'plan',
          'facet',
          'trailhead',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(thirdPlanResult.exitCode).toBe(0);
        const thirdApplyResult = runRawCli([
          'regrade',
          'apply',
          '--root-dir',
          dir,
          '--json',
        ]);
        expect(thirdApplyResult.exitCode).toBe(0);
        const thirdApplied = parseCliJson<{
          readonly history?: { readonly status?: string };
        }>(thirdApplyResult);
        expect(thirdApplied.history?.status).toBe('replay');

        const afterReplay = JSON.parse(
          readFileSync(historyFile, 'utf8')
        ) as HistoryFile;
        expect(afterReplay.runs).toHaveLength(2);
        expect(afterReplay.id).toBe(consolidated.id ?? 'missing');
        expect(afterReplay.runs?.[0]).toEqual(
          consolidated.runs?.[0] ?? { lockHashAtRun: 'missing' }
        );
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
      // Nine sequential CLI subprocesses overflow the default 5s test budget
      // when the whole workspace suite runs in parallel.
    },
    cliTimeoutMs
  );

  test('CLI adjust pulls a graduated transition back and the re-run appends to the same spine', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const planResult = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(planResult.exitCode).toBe(0);
      const activePlanPath = join(
        dir,
        '.trails',
        'regrade',
        'facet-to-trailhead.json'
      );
      expect(existsSync(activePlanPath)).toBe(true);

      const applyResult = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(applyResult.exitCode).toBe(0);
      const historyFile = join(
        dir,
        '.trails',
        'regrade',
        'history',
        'facet-to-trailhead.json'
      );
      expect(existsSync(historyFile)).toBe(true);
      // Apply graduates the plan out of the active directory.
      expect(existsSync(activePlanPath)).toBe(false);

      interface HistoryFile {
        readonly id?: string;
        readonly runs?: readonly {
          readonly lockHashAtRun?: string;
          readonly plan?: { readonly plan?: Record<string, unknown> };
          readonly planContentHash?: string;
        }[];
      }
      const historyBytesBeforeAdjust = readFileSync(historyFile, 'utf8');
      const graduated = JSON.parse(historyBytesBeforeAdjust) as HistoryFile;
      expect(graduated.id).toMatch(/^[0-9a-f]{12}$/);
      expect(graduated.runs).toHaveLength(1);

      const adjustResult = runRawCli([
        'regrade',
        'adjust',
        'facet-to-trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(adjustResult.exitCode).toBe(0);
      const adjusted = parseCliJson<{
        readonly kind?: string;
        readonly transitionId?: string;
      }>(adjustResult);
      expect(adjusted.kind).toBe('regrade-plan');
      expect(adjusted.transitionId).toBe(graduated.id ?? 'missing');
      expect(existsSync(activePlanPath)).toBe(true);

      // The pulled-back active plan is authored intent only: the plan body
      // matches the graduated last run's body and no run-ledger keys leak
      // into the active clone.
      const activeArtifact = JSON.parse(
        readFileSync(activePlanPath, 'utf8')
      ) as Record<string, unknown>;
      expect(activeArtifact['plan']).toEqual(
        graduated.runs?.[0]?.plan?.plan ?? { missing: true }
      );
      expect(Object.keys(activeArtifact)).not.toContain('runs');
      expect(Object.keys(activeArtifact)).not.toContain('report');
      // Adjust leaves the graduated history file untouched.
      expect(readFileSync(historyFile, 'utf8')).toBe(historyBytesBeforeAdjust);

      // Edit the tree and the plan; the spine survives plan re-derivation.
      writeFile(dir, 'docs/more.md', 'facet again\n');
      const replanResult = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--intent',
        'second pass',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(replanResult.exitCode).toBe(0);
      const replanned = parseCliJson<{ readonly transitionId?: string }>(
        replanResult
      );
      expect(replanned.transitionId).toBe(graduated.id ?? 'missing');

      const reapplyResult = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(reapplyResult.exitCode).toBe(0);

      // Same spine, not a fork: the consolidated file keeps its id, appends
      // the adjusted run, and leaves the original run's stamps untouched.
      const after = JSON.parse(
        readFileSync(historyFile, 'utf8')
      ) as HistoryFile;
      expect(after.id).toBe(graduated.id ?? 'missing');
      expect(after.runs).toHaveLength(2);
      expect(after.runs?.[1]?.planContentHash).not.toBe(
        after.runs?.[0]?.planContentHash ?? 'missing'
      );
      expect(after.runs?.[0]).toEqual(
        graduated.runs?.[0] ?? { lockHashAtRun: 'missing' }
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI adjust refuses when an active plan for the transition already exists', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');
      const planResult = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(planResult.exitCode).toBe(0);
      const applyResult = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(applyResult.exitCode).toBe(0);

      const firstAdjust = runRawCli([
        'regrade',
        'adjust',
        'facet-to-trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(firstAdjust.exitCode).toBe(0);

      const secondAdjust = runRawCli([
        'regrade',
        'adjust',
        'facet-to-trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(secondAdjust.exitCode).not.toBe(0);
      expect(secondAdjust.stderr).toContain('already exists');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI runs the class-mode plan lifecycle: plan, check, apply, history', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/app.ts',
        [
          "import { topo } from '@ontrails/core';",
          '',
          'export const trailsCliAliases = {',
          "  'survey.diff': [['diff']],",
          '} as const;',
          '',
          "export const app = topo('example');",
          '',
        ].join('\n')
      );

      const planResult = runRawCli([
        'regrade',
        'plan',
        '--type',
        'class',
        '--class-ids',
        'export-restructure:cli-aliases',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(planResult.exitCode).toBe(0);
      const plan = parseCliJson<{
        readonly path?: string;
        readonly plan?: {
          readonly classIds?: readonly string[];
          readonly kind?: string;
        };
        readonly sourceHash?: string;
      }>(planResult);
      expect(plan).toMatchObject({
        kind: 'regrade-plan',
        path: '.trails/regrade/export-restructure-cli-aliases.json',
        plan: {
          classIds: ['export-restructure:cli-aliases'],
          kind: 'class',
        },
      });
      if (plan.path === undefined) {
        throw new Error('Expected Regrade plan path.');
      }
      expect(existsSync(join(dir, plan.path))).toBe(true);

      const plansResult = runRawCli([
        'regrade',
        'plans',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(plansResult.exitCode).toBe(0);
      expect(parseCliJson(plansResult)).toMatchObject({
        plans: [
          {
            classIds: ['export-restructure:cli-aliases'],
            kind: 'class',
            path: plan.path,
            status: 'active',
          },
        ],
      });

      // The gate stays open while the safe rewrite is pending.
      const checkResult = runRawCli([
        'regrade',
        'check',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(checkResult.exitCode).not.toBe(0);
      expect(checkResult.stderr).toContain('Regrade plan gate is open');

      const applyResult = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(applyResult.exitCode).toBe(0);
      const applied = parseCliJson<{
        readonly apply?: { readonly applied?: number };
        readonly history?: { readonly path?: string };
        readonly plan?: { readonly status?: string };
      }>(applyResult);
      expect(applied.apply).toMatchObject({ applied: 1 });
      expect(applied.plan).toMatchObject({ status: 'active' });
      const historyPath = applied.history?.path;
      if (historyPath === undefined) {
        throw new Error('Expected Regrade history path.');
      }
      expect(historyPath).toBe(
        '.trails/regrade/history/export-restructure-cli-aliases.json'
      );
      expect(existsSync(join(dir, historyPath))).toBe(true);
      // Apply graduates the plan out of the active directory.
      expect(existsSync(join(dir, plan.path))).toBe(false);

      const rewritten = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(rewritten).toContain(
        "import { surfaceOverlay, topo } from '@ontrails/core';"
      );
      expect(rewritten).toContain('export const trailsOverlays = [');
      expect(rewritten).toContain("diff: 'survey.diff',");
      expect(rewritten).not.toContain('trailsCliAliases');

      // A fresh plan over the migrated tree is clean and checks green.
      const replanResult = runRawCli([
        'regrade',
        'plan',
        '--type',
        'class',
        '--class-ids',
        'export-restructure:cli-aliases',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(replanResult.exitCode).toBe(0);
      const recheckResult = runRawCli([
        'regrade',
        'check',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(recheckResult.exitCode).toBe(0);
      expect(parseCliJson(recheckResult)).toMatchObject({
        check: { status: 'passed' },
        rewritten: 0,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI rejects class-mode plans with unknown class ids', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/app.ts', 'export const app = 1;\n');
      const result = runRawCli([
        'regrade',
        'plan',
        '--type',
        'class',
        '--class-ids',
        'export-restructure:not-a-class',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Unknown Regrade class ids');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI consolidates history per transition across repeated applies', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/one.ts', 'export const facet = 1;\n');

      const firstPlan = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--extensions',
        '.ts',
        '--json',
      ]);
      expect(firstPlan.exitCode).toBe(0);
      const firstApply = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(firstApply.exitCode).toBe(0);
      const firstApplied = parseCliJson<{
        readonly history?: { readonly path?: string };
      }>(firstApply);
      expect(firstApplied.history?.path).toBeDefined();

      interface HistoryFile {
        readonly runs?: readonly {
          readonly lockHashAtRun?: string;
          readonly planContentHash?: string;
        }[];
      }
      const historyFile = join(
        dir,
        firstApplied.history?.path ?? 'missing-history.json'
      );
      const firstRun = (
        JSON.parse(readFileSync(historyFile, 'utf8')) as HistoryFile
      ).runs?.[0];
      expect(firstRun).toBeDefined();

      writeFile(dir, 'src/two.ts', 'export const facet = 2;\n');
      const secondPlan = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--extensions',
        '.ts',
        '--json',
      ]);
      expect(secondPlan.exitCode).toBe(0);
      const secondApply = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(secondApply.exitCode).toBe(0);
      const secondApplied = parseCliJson<{
        readonly history?: { readonly path?: string };
      }>(secondApply);

      expect(secondApplied.history?.path).toBe(
        firstApplied.history?.path ?? 'missing'
      );
      expect(
        readdirSync(join(dir, '.trails', 'regrade', 'history'))
      ).toHaveLength(1);
      const consolidated = JSON.parse(
        readFileSync(historyFile, 'utf8')
      ) as HistoryFile;
      expect(consolidated.runs).toHaveLength(2);
      expect(consolidated.runs?.[0]).toEqual(
        firstRun ?? { lockHashAtRun: 'missing' }
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('regrade check verifies each recorded run at its own stamped lock', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const planResult = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(planResult.exitCode).toBe(0);
      const applyResult = runRawCli([
        'regrade',
        'apply',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(applyResult.exitCode).toBe(0);

      const checkResult = runRawCli([
        'regrade',
        'check',
        '--plan',
        'facet-to-trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(checkResult.exitCode).toBe(0);
      expect(parseCliJson(checkResult)).toMatchObject({
        check: { status: 'passed' },
        history: {
          path: '.trails/regrade/history/facet-to-trailhead.json',
          status: 'checked',
        },
      });

      const historyFile = join(
        dir,
        '.trails/regrade/history/facet-to-trailhead.json'
      );
      interface HistoryFile {
        readonly runs?: { lockHashAtRun?: string }[];
      }
      const tampered = JSON.parse(
        readFileSync(historyFile, 'utf8')
      ) as HistoryFile;
      if (tampered.runs?.[0] === undefined) {
        throw new Error('Expected a recorded history run to tamper.');
      }
      tampered.runs[0].lockHashAtRun = 'deadbeef'.repeat(8);
      writeFileSync(historyFile, `${JSON.stringify(tampered, null, 2)}\n`);

      const tamperedCheck = runRawCli([
        'regrade',
        'check',
        '--plan',
        'facet-to-trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(tamperedCheck.exitCode).not.toBe(0);
      expect(tamperedCheck.stderr).toContain('stamp mismatch');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan dry-run derives a plan without writing it', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const result = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--dry-run',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const plan = parseCliJson<{ readonly path?: string }>(result);
      expect(plan.path).toBe('.trails/regrade/facet-to-trailhead.json');
      expect(existsSync(join(dir, plan.path ?? 'missing'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan expansion stages structured candidates without writing on dry-run', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/alpha.md',
        'The alpha path is safe.\nThe alphaing path needs review.\n'
      );

      const result = runRawCli([
        'regrade',
        'plan',
        'alpha',
        'omega',
        '--expand',
        '--dry-run',
        '--root-dir',
        dir,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const plan = parseCliJson<{
        readonly expansion?: {
          readonly candidates?: readonly {
            readonly evidence?: readonly {
              readonly detail?: string;
              readonly line?: number;
              readonly path?: string;
            }[];
            readonly kind?: string;
            readonly status?: string;
            readonly suggestedClassification?: string;
            readonly value?: string;
          }[];
        };
        readonly path?: string;
      }>(result);

      expect(plan.expansion?.candidates).toEqual([
        expect.objectContaining({
          evidence: [
            expect.objectContaining({
              detail: 'deferred-form',
              line: 2,
              path: 'docs/alpha.md',
            }),
          ],
          kind: 'form',
          status: 'pending',
          suggestedClassification: 'in-family-unresolved',
          value: 'alphaing',
        }),
      ]);
      expect(existsSync(join(dir, plan.path ?? 'missing'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan expansion preserves judged candidates and suppresses adopted candidates', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/alpha.md',
        'The alpha path is safe.\nThe alphaing path needs review.\n'
      );

      const initial = runRawCli([
        'regrade',
        'plan',
        'alpha',
        'omega',
        '--expand',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(initial.exitCode).toBe(0);
      const initialPlan = parseCliJson<{ readonly path?: string }>(initial);
      if (initialPlan.path === undefined) {
        throw new Error('Expected expanded Regrade plan path.');
      }

      const planPath = join(dir, initialPlan.path);
      const rejected = JSON.parse(readFileSync(planPath, 'utf8')) as {
        expansion?: {
          candidates?: {
            reason?: string;
            status?: string;
            value?: string;
          }[];
        };
      };
      if (rejected.expansion?.candidates?.[0] === undefined) {
        throw new Error('Expected staged expansion candidate.');
      }
      rejected.expansion.candidates[0] = {
        ...rejected.expansion.candidates[0],
        reason: 'Intentional idiom preserve.',
        status: 'rejected',
      };
      writeFileSync(planPath, `${JSON.stringify(rejected, null, 2)}\n`);

      const rerunRejected = runRawCli([
        'regrade',
        'plan',
        'alpha',
        'omega',
        '--expand',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(rerunRejected.exitCode).toBe(0);
      const rejectedSaved = JSON.parse(readFileSync(planPath, 'utf8')) as {
        expansion?: {
          candidates?: readonly {
            readonly reason?: string;
            readonly status?: string;
            readonly value?: string;
          }[];
        };
      };
      expect(rejectedSaved.expansion?.candidates).toEqual([
        expect.objectContaining({
          reason: 'Intentional idiom preserve.',
          status: 'rejected',
          value: 'alphaing',
        }),
      ]);

      const adopted = JSON.parse(readFileSync(planPath, 'utf8')) as {
        expansion?: unknown;
        plan?: { deferForms?: string[] };
        provenance?: { fields?: { deferForms?: string } };
      };
      adopted.plan = { ...adopted.plan, deferForms: ['alphaing'] };
      adopted.provenance = {
        fields: {
          ...adopted.provenance?.fields,
          deferForms: 'authored',
        },
      };
      writeFileSync(planPath, `${JSON.stringify(adopted, null, 2)}\n`);

      const rerunAdopted = runRawCli([
        'regrade',
        'plan',
        'alpha',
        'omega',
        '--expand',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(rerunAdopted.exitCode).toBe(0);
      const adoptedSaved = JSON.parse(readFileSync(planPath, 'utf8')) as {
        expansion?: { candidates?: readonly unknown[] };
        plan?: { deferForms?: readonly string[] };
        provenance?: { fields?: { deferForms?: string } };
      };
      expect(adoptedSaved.plan?.deferForms).toEqual(['alphaing']);
      expect(adoptedSaved.provenance?.fields?.deferForms).toBe('authored');
      expect(adoptedSaved.expansion).toBeUndefined();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan expansion keeps candidates outside path-scoped preserve rules', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facetId = "preserved";\n');
      writeFile(dir, 'docs/surface.md', 'The facetId field needs review.\n');

      const result = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--expand',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          include: ['src/**', 'docs/**'],
          preserve: [
            {
              disposition: 'preserve-current-live-api',
              paths: ['src/**'],
              pattern: '^facetId$',
              reason: 'live-api-identifier',
            },
          ],
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const plan = parseCliJson<{
        readonly expansion?: {
          readonly candidates?: readonly {
            readonly evidence?: readonly {
              readonly path?: string;
            }[];
            readonly kind?: string;
            readonly value?: string;
          }[];
        };
      }>(result);

      expect(plan.expansion?.candidates).toEqual([
        expect.objectContaining({
          evidence: [expect.objectContaining({ path: 'docs/surface.md' })],
          kind: 'form',
          value: 'facetId',
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan expansion requires preserve patterns to match form candidates', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'The active facetId needs review.\n');

      const result = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--expand',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          include: ['docs/**'],
          preserve: [
            {
              forms: ['facetId'],
              pattern: 'legacy facetId',
              reason: 'legacy-only-context',
            },
          ],
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const plan = parseCliJson<{
        readonly expansion?: {
          readonly candidates?: readonly {
            readonly kind?: string;
            readonly value?: string;
          }[];
        };
      }>(result);

      expect(plan.expansion?.candidates).toEqual([
        expect.objectContaining({
          kind: 'form',
          value: 'facetId',
        }),
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI reads legacy lightweight expansion candidates from v1 plans', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/alpha.md',
        'The alpha path is safe.\nThe alphaing path needs review.\n'
      );

      const initial = runRawCli([
        'regrade',
        'plan',
        'alpha',
        'omega',
        '--expand',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(initial.exitCode).toBe(0);
      const initialPlan = parseCliJson<{ readonly path?: string }>(initial);
      if (initialPlan.path === undefined) {
        throw new Error('Expected expanded Regrade plan path.');
      }

      const planPath = join(dir, initialPlan.path);
      const legacy = JSON.parse(readFileSync(planPath, 'utf8')) as {
        expansion?: {
          candidates?: unknown[];
        };
      };
      legacy.expansion = {
        candidates: [
          {
            detail: 'legacy-review-entry',
            path: 'docs/alpha.md',
            status: 'pending',
          },
        ],
      };
      writeFileSync(planPath, `${JSON.stringify(legacy, null, 2)}\n`);

      const plans = runRawCli([
        'regrade',
        'plans',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(plans.exitCode).toBe(0);
      expect(parseCliJson(plans)).toMatchObject({
        plans: [
          {
            expansionPending: 1,
            path: '.trails/regrade/alpha-to-omega.json',
            status: 'active',
          },
        ],
      });

      const preview = runRawCli([
        'regrade',
        'preview',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(preview.exitCode).toBe(0);
      expect(parseCliJson(preview)).toMatchObject({
        plan: {
          expansionPending: 1,
          path: '.trails/regrade/alpha-to-omega.json',
          status: 'active',
        },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan regeneration preserves authored plan fields', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const initial = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--intent',
        'Rename the public surface grouping vocabulary.',
        '--json',
      ]);
      expect(initial.exitCode).toBe(0);
      const initialPlan = parseCliJson<{ readonly path?: string }>(initial);
      if (initialPlan.path === undefined) {
        throw new Error('Expected initial Regrade plan path.');
      }

      const regenerated = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(regenerated.exitCode).toBe(0);
      const saved = JSON.parse(
        readFileSync(join(dir, initialPlan.path), 'utf8')
      ) as {
        readonly plan?: { readonly intent?: string };
        readonly provenance?: {
          readonly fields?: { readonly intent?: string };
        };
      };

      expect(saved.plan?.intent).toBe(
        'Rename the public surface grouping vocabulary.'
      );
      expect(saved.provenance?.fields?.intent).toBe('authored');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan regeneration preserves authored scope fields', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');
      writeFile(dir, '.scratch/history.md', 'facet\n');

      const initial = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--include',
        'docs/**',
        '--exclude',
        '.scratch/**',
        '--extensions',
        '.md',
        '--json',
      ]);
      expect(initial.exitCode).toBe(0);
      const initialPlan = parseCliJson<{ readonly path?: string }>(initial);
      if (initialPlan.path === undefined) {
        throw new Error('Expected initial Regrade plan path.');
      }

      const regenerated = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(regenerated.exitCode).toBe(0);
      const saved = JSON.parse(
        readFileSync(join(dir, initialPlan.path), 'utf8')
      ) as {
        readonly plan?: {
          readonly scope?: {
            readonly exclude?: readonly string[];
            readonly extensions?: readonly string[];
            readonly include?: readonly string[];
          };
        };
        readonly provenance?: {
          readonly fields?: { readonly scope?: string };
        };
      };

      expect(saved.plan?.scope).toMatchObject({
        exclude: expect.arrayContaining(['.scratch/**']),
        extensions: ['.md'],
        include: ['docs/**'],
      });
      expect(saved.provenance?.fields?.scope).toBe('authored');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI preview keeps plans active across report entry detail levels', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const plan = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(plan.exitCode).toBe(0);

      const preview = runRawCli([
        'regrade',
        'preview',
        '--include-entries',
        'all',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(preview.exitCode).toBe(0);
      const parsed = parseCliJson<{
        readonly plan?: { readonly status?: string };
      }>(preview);
      expect(parsed.plan?.status).toBe('active');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI check fails when a saved plan has symbol review entries', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export function render(facet: string) { return facet; }\n'
      );

      const plan = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--extensions',
        '.ts',
        '--json',
      ]);
      expect(plan.exitCode).toBe(0);

      const check = runRawCli([
        'regrade',
        'check',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(check.exitCode).toBe(1);
      const parsed = JSON.parse(check.stderr) as {
        readonly context?: { readonly review?: number };
        readonly error?: {
          readonly category?: string;
          readonly message?: string;
        };
      };
      expect(parsed.error).toMatchObject({
        category: 'validation',
      });
      expect(parsed.error?.message).toContain('gate is open');
      expect(parsed.context?.review).toBe(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan recomputes the run gate after merging symbol findings', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Inline `facet` remains.\n');
      writeFile(
        dir,
        'src/surface.ts',
        'export function render(facet: string) { return facet; }\n'
      );

      const plan = runRawCli([
        'regrade',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(plan.exitCode).toBe(0);
      const parsed = parseCliJson<{
        readonly review?: number;
        readonly run?: {
          readonly report?: {
            readonly dispositions?: Record<string, number>;
            readonly gate?: {
              readonly remainingByDisposition?: Record<string, number>;
              readonly status?: string;
            };
            readonly open?: number;
            readonly review?: number;
          };
        };
      }>(plan);
      expect(parsed.review).toBe(2);
      expect(parsed.run?.report?.gate?.status).toBe('open');
      expect(parsed.run?.report?.open).toBe(2);
      expect(parsed.run?.report?.dispositions).toMatchObject({
        'code-context-out-of-engine': 2,
      });
      expect(parsed.run?.report?.gate?.remainingByDisposition).toMatchObject({
        'code-context-out-of-engine': 2,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI preview marks saved plans stale after governed symbol findings change', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facet = "facet";\nexport const trail = facet;\n'
      );

      const plan = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--extensions',
        '.ts',
        '--json',
      ]);
      expect(plan.exitCode).toBe(0);

      writeFile(
        dir,
        'src/surface.ts',
        [
          'export const facet = "facet";',
          'export const trail = facet;',
          'export const later = facet;',
          '',
        ].join('\n')
      );

      const preview = runRawCli([
        'regrade',
        'preview',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(preview.exitCode).toBe(0);
      const parsed = parseCliJson<{
        readonly plan?: { readonly status?: string };
      }>(preview);
      expect(parsed.plan?.status).toBe('stale');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI rejects stale legacy transition records after symbol findings change', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facet = "facet";\nexport const trail = facet;\n'
      );

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--extensions',
        '.ts',
      ]);
      writeFile(
        dir,
        'src/surface.ts',
        [
          'export const facet = "facet";',
          'export const trail = facet;',
          'export const later = facet;',
          '',
        ].join('\n')
      );

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--plan-record',
        recordPath,
        '--check',
        '--json',
      ]);
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr) as {
        readonly error?: {
          readonly category?: string;
          readonly message?: string;
        };
      };
      expect(parsed.error).toMatchObject({
        category: 'validation',
      });
      expect(parsed.error?.message).toContain('stale');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI apply removes the loaded plan path after a renamed plan is applied', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'The facet docs mention facet.\n');

      const plan = runRawCli([
        'regrade',
        'plan',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(plan.exitCode).toBe(0);
      const planned = parseCliJson<{ readonly path?: string }>(plan);
      if (planned.path === undefined) {
        throw new Error('Expected Regrade plan path.');
      }
      const renamedPath = join(dir, '.trails', 'regrade', 'renamed-plan.json');
      renameSync(join(dir, planned.path), renamedPath);

      const applied = runRawCli([
        'regrade',
        'apply',
        '--plan',
        '.trails/regrade/renamed-plan.json',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(applied.exitCode).toBe(0);
      expect(existsSync(renamedPath)).toBe(false);
      expect(existsSync(join(dir, planned.path))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI plan name references match active plan slugs exactly', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Foo docs mention foo.\n');

      const plan = runRawCli([
        'regrade',
        'plan',
        'foo',
        'bar',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(plan.exitCode).toBe(0);

      const rejected = runRawCli([
        'regrade',
        'preview',
        '--plan',
        'bar',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(rejected.exitCode).toBe(1);
      const rejection = JSON.parse(rejected.stderr) as {
        readonly error?: { readonly message?: string };
      };
      expect(rejection.error?.message).toBe(
        'No active Regrade plan named "bar" found.'
      );

      const accepted = runRawCli([
        'regrade',
        'preview',
        '--plan',
        'foo-to-bar',
        '--root-dir',
        dir,
        '--json',
      ]);
      expect(accepted.exitCode).toBe(0);
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

      const recordResult = await regradeTrail.blaze(
        {
          extensions: ['.md', '.ts'],
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
          writeRecord: true,
        },
        { cwd: dir, env: {} } as never
      );
      expect(recordResult.isOk()).toBe(true);
      if (recordResult.isErr()) {
        throw recordResult.error;
      }
      expect(recordResult.value.record).toMatchObject({
        status: 'candidate',
      });
      const recordPath = recordResult.value.record?.path;
      expect(recordPath).toBeDefined();
      if (recordPath === undefined) {
        throw new Error('Expected transition record path.');
      }

      const result = await regradeTrail.blaze(
        {
          apply: true,
          planRecord: recordPath,
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 3,
        filesChanged: 2,
        review: 1,
        skipped: 2,
      });
      expect(result.value.run?.report).toMatchObject({
        applied: 3,
        deferred: 1,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 1,
          remainingByDisposition: {
            'in-family-unresolved': 1,
          },
          status: 'open',
        },
        modified: 0,
        open: 1,
        skipped: 2,
      });
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'Facet docs mention trailhead and trailheads.\n'
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'trailheadId'
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'export const trailhead = "facet";'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects vocabulary apply without a transition record', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const result = await regradeTrail.blaze(
        {
          apply: true,
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toContain('requires `planRecord`');
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI checks transition records before apply', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--root-dir',
        dir,
      ]);
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--plan-record',
        recordPath,
        '--check',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr) as {
        readonly error?: {
          readonly category?: string;
          readonly message?: string;
        };
      };
      expect(parsed.error).toMatchObject({
        category: 'validation',
      });
      expect(parsed.error?.message).toContain('gate is open');
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI requires explicit apply for legacy transition records', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--root-dir',
        dir,
      ]);
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--plan-record',
        recordPath,
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr) as {
        readonly error?: {
          readonly category?: string;
          readonly message?: string;
        };
      };
      expect(parsed.error).toMatchObject({
        category: 'validation',
      });
      expect(parsed.error?.message).toContain('requires `apply: true`');
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI rejects stale transition records during check', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Trailhead docs are already clean.\n');

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--root-dir',
        dir,
      ]);
      writeFile(
        dir,
        'docs/surface.md',
        'Trailhead docs gained a stale facet term.\n'
      );
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--plan-record',
        recordPath,
        '--check',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr) as {
        readonly error?: {
          readonly category?: string;
          readonly message?: string;
        };
      };
      expect(parsed.error).toMatchObject({
        category: 'validation',
      });
      expect(parsed.error?.message).toContain('record is stale');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI accepts regrade source and target as positional arguments', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'The facet docs mention facet.\n');

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
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toContain(
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
      expect(parsed.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facetId->trailheadId'
      );
      expect(parsed.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: expect.stringContaining(
              'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
            ),
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

  test('CLI dogfoods facet to trailhead through plan, ledger, and report', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        'The facet docs mention facets. facetId stays review. Facet heading.\n'
      );
      writeFile(
        dir,
        'src/surface.ts',
        [
          'export const facet = "facet";',
          'export const facetId = facet;',
          'export const facets = [facet];',
          '',
        ].join('\n')
      );
      writeFile(dir, '.agents/notes/history.md', 'facet\n');
      writeFile(dir, '.agents/skills/trails/SKILL.md', 'facet\n');
      writeFile(dir, '.scratch/history.md', 'facet\n');
      writeFile(dir, 'plugin/skills/trails/SKILL.md', 'facet\n');

      const result = runRawCli([
        'regrade',
        'facet',
        'trailhead',
        '--root-dir',
        dir,
        '--exclude',
        '.agents/notes/**',
        '--exclude',
        '.scratch/**',
        '--include-entries',
        'all',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly entries?: readonly {
          readonly classId?: string;
          readonly outcome?: string;
          readonly path?: string;
          readonly reason?: string;
        }[];
        readonly run?: {
          readonly ledger?: {
            readonly forms?: Record<string, string>;
            readonly occurrences?: readonly {
              readonly disposition?: string;
              readonly form?: string;
              readonly path?: string;
              readonly replacement?: string;
              readonly verdict?: string;
            }[];
          };
          readonly plan?: {
            readonly from?: string;
            readonly id?: string;
            readonly scope?: { readonly exclude?: readonly string[] };
            readonly to?: string;
          };
          readonly report?: {
            readonly gate?: {
              readonly reasons?: readonly string[];
              readonly status?: string;
            };
            readonly modified?: number;
            readonly open?: number;
          };
        };
        readonly selectedClassIds?: readonly string[];
        readonly skipsByReason?: Record<string, number>;
      };

      expect(parsed.selectedClassIds).toEqual(
        expect.arrayContaining([
          'ast-symbol-rename:v1-facet-trailhead:facet->trailhead',
          'ast-symbol-rename:v1-facet-trailhead:facetId->trailheadId',
          'ast-symbol-rename:v1-facet-trailhead:facets->trailheads',
          'ast-symbol-rename:v1-facet-trailhead:McpSurfaceFacetMap->McpSurfaceTrailheadMap',
          'v1-facet-trailhead',
        ])
      );
      expect(parsed.run?.plan).toMatchObject({
        from: 'facet',
        id: 'v1-facet-trailhead',
        scope: {
          exclude: [
            ...facetTrailheadRegistryExcludes,
            '.agents/notes/**',
            '.scratch/**',
          ],
        },
        to: 'trailhead',
      });
      expect(parsed.run?.ledger?.forms).toMatchObject({
        Facet: 'deferred',
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
      expect(parsed.run?.ledger?.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            form: 'facet',
            path: '.agents/skills/trails/SKILL.md',
            replacement: 'trailhead',
            verdict: 'modified',
          }),
          expect.objectContaining({
            form: 'facet',
            path: 'plugin/skills/trails/SKILL.md',
            replacement: 'trailhead',
            verdict: 'modified',
          }),
          expect.objectContaining({
            disposition: 'in-family-unresolved',
            form: 'facetId',
            path: 'docs/surface.md',
            verdict: 'deferred',
          }),
        ])
      );
      expect(
        parsed.run?.ledger?.occurrences?.map((entry) => entry.path)
      ).not.toContain('.agents/notes/history.md');
      expect(
        parsed.run?.ledger?.occurrences?.map((entry) => entry.path)
      ).not.toContain('.scratch/history.md');
      expect(parsed.run?.report).toMatchObject({
        gate: {
          reasons: [
            'deferred-forms-or-occurrences',
            'safe-modifications-not-yet-applied',
          ],
          status: 'open',
        },
        modified: 5,
        open: 7,
      });
      expect(parsed.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: expect.stringContaining(
              'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
            ),
            outcome: 'rewrite',
            path: 'src/surface.ts',
          }),
          expect.objectContaining({
            outcome: 'needs-review',
            path: 'docs/surface.md',
            reason: 'vocabulary-judgment-deferred',
          }),
        ])
      );
      expect(parsed.skipsByReason).toMatchObject({ 'ignored-glob': 2 });
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'The facet docs mention facets. facetId stays review. Facet heading.\n'
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        [
          'export const facet = "facet";',
          'export const facetId = facet;',
          'export const facets = [facet];',
          '',
        ].join('\n')
      );
      expect(
        readFileSync(join(dir, '.agents', 'notes', 'history.md'), 'utf8')
      ).toBe('facet\n');
      expect(
        readFileSync(
          join(dir, '.agents', 'skills', 'trails', 'SKILL.md'),
          'utf8'
        )
      ).toBe('facet\n');
      expect(readFileSync(join(dir, '.scratch', 'history.md'), 'utf8')).toBe(
        'facet\n'
      );
      expect(
        readFileSync(
          join(dir, 'plugin', 'skills', 'trails', 'SKILL.md'),
          'utf8'
        )
      ).toBe('facet\n');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI applies governed symbol include scope before rewriting', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'other/surface.ts', 'export const facet = 1;\n');
      writeFile(dir, 'src/surface.ts', 'export const facet = 1;\n');

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--include',
        'src/**',
        '--include-entries',
        'all',
        '--root-dir',
        dir,
      ]);
      const result = runRawCli([
        'regrade',
        '--plan-record',
        recordPath,
        '--include-entries',
        'all',
        '--root-dir',
        dir,
        '--apply',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly entries?: readonly {
          readonly outcome?: string;
          readonly path?: string;
          readonly reason?: string;
        }[];
      };
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'trailhead'
      );
      expect(readFileSync(join(dir, 'other', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
      expect(parsed.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcome: 'skip',
            path: 'other/surface.ts',
            reason: 'not-included-glob',
          }),
        ])
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
        'docs/blaze.md',
        'The blaze path is safe.\nThe blazing path needs review.\n'
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

  test('CLI keeps path-scoped symbol preserves local to matching occurrences', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/internal.ts', 'export const blaze = 1;\n');
      writeFile(dir, 'src/public-api.ts', 'export const blaze = 1;\n');

      const recordPath = writeVocabularyTransitionRecord([
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          extensions: ['.ts'],
          from: 'blaze',
          preserve: [
            {
              forms: ['blaze'],
              paths: ['src/public-api.ts'],
              pattern: String.raw`\bblaze\b\s*=`,
              reason: 'public-api-field',
            },
          ],
          to: 'implementation',
        }),
      ]);
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          apply: true,
          planRecord: recordPath,
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(dir, 'src', 'internal.ts'), 'utf8')).toContain(
        'implementation'
      );
      expect(readFileSync(join(dir, 'src', 'public-api.ts'), 'utf8')).toContain(
        'blaze'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI merged vocabulary reports count prose and code scanned files', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/blaze.md', 'The blaze docs are ready.\n');
      writeFile(dir, 'src/blaze.ts', 'export const blaze = 1;\n');

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
        readonly scan?: {
          readonly files?: {
            readonly matched?: number;
            readonly scanned?: number;
          };
        };
        readonly scanned?: number;
      };
      expect(parsed.scanned).toBe(2);
      expect(parsed.scan?.files).toMatchObject({
        matched: 2,
        scanned: 2,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI accepts path-scope exclude globs for vocabulary regrades', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, '.agents/notes/history.md', 'facet\n');
      writeFile(dir, '.agents/skills/trails/SKILL.md', 'facet\n');
      writeFile(dir, '.scratch/history.md', 'facet\n');
      writeFile(dir, 'plugin/skills/trails/SKILL.md', 'facet\n');

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
        ...facetTrailheadRegistryExcludes,
        '.scratch/**',
        '.agents/notes/**',
      ]);
      expect(parsed.run?.ledger?.occurrences?.map((o) => o.path)).toEqual([
        '.agents/skills/trails/SKILL.md',
        'plugin/skills/trails/SKILL.md',
      ]);
      expect(parsed.scan?.files).toEqual({
        matched: 2,
        scanned: 2,
        skipped: 4,
      });
      expect(parsed.scan?.byDirectory).toEqual([
        { files: 1, occurrences: 1, path: '.agents' },
        { files: 1, occurrences: 1, path: 'plugin' },
      ]);
      expect(parsed.scan?.byExtension).toEqual([
        { extension: '.md', files: 2, occurrences: 2 },
      ]);
      expect(parsed.skipsByReason).toMatchObject({ 'ignored-glob': 2 });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI applies registry path-scope defaults for governed vocabulary regrades', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, '.changeset/historical.md', 'facet\n');
      writeFile(dir, 'packages/core/CHANGELOG.md', 'facet\n');
      writeFile(dir, '.agents/memory/decisions.md', 'facet\n');
      writeFile(dir, '.agents/plans/archive/old/PLAN.md', 'facet\n');
      writeFile(dir, 'docs/current.md', 'facet\n');
      writeFile(dir, 'plugin/skills/trails/SKILL.md', 'facet\n');

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
      expect(parsed.run?.plan?.scope?.exclude).toEqual(
        facetTrailheadRegistryExcludes
      );
      expect(parsed.run?.ledger?.occurrences?.map((o) => o.path)).toEqual([
        'docs/current.md',
        'plugin/skills/trails/SKILL.md',
      ]);
      expect(parsed.skipsByReason).toMatchObject({ 'ignored-glob': 4 });
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
      expect(parsed.run?.preserveInventory).toBeUndefined();
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
      ]);
      expect(parsed.run?.report).toMatchObject({
        deferred: 1,
        dispositions: {
          'in-family-unresolved': 1,
        },
        gate: {
          remaining: 1,
          remainingByDisposition: {
            'in-family-unresolved': 1,
          },
          status: 'open',
        },
        modified: 0,
        open: 1,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('facet API identifiers migrate after the live API cutover', () => {
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

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--root-dir',
        dir,
      ]);
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--plan-record',
        recordPath,
        '--apply',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const source = readFileSync(join(dir, 'src', 'surface.ts'), 'utf8');
      expect(source).toContain(
        "ctx.compose('wayfind.trailheads', { trailheads });"
      );
      expect(source).toContain(
        'readonly trailheads?: McpSurfaceTrailheadMap | undefined;'
      );

      const parsed = JSON.parse(result.stdout) as {
        readonly run?: {
          readonly preserveInventory?: readonly {
            readonly forms?: readonly string[];
            readonly reason?: string;
          }[];
        };
      };
      expect(parsed.run?.preserveInventory).toBeUndefined();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI apply keeps prose rewrites out of code strings and comments', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        [
          'const label = "the facets string must not change";',
          '// the facets comment must not change',
          'export const facets = 1;',
          'export const useFacets = facets;',
          'export const facet = 1;',
          'export const useFacet = facet;',
          '',
        ].join('\n')
      );

      const recordPath = writeVocabularyTransitionRecord([
        'facet',
        'trailhead',
        '--root-dir',
        dir,
      ]);
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--plan-record',
        recordPath,
        '--apply',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const source = readFileSync(join(dir, 'src', 'surface.ts'), 'utf8');
      expect(source).toContain('"the facets string must not change"');
      expect(source).toContain('// the facets comment must not change');
      expect(source).toContain('export const trailheads = 1;');
      expect(source).toContain('export const useFacets = trailheads;');
      expect(source).toContain('export const trailhead = 1;');
      expect(source).toContain('export const useFacet = trailhead;');
      expect(source).not.toContain('the trailheads string must not change');
      expect(source).not.toContain('// the trailheads comment must not change');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI forwards form-scoped preserve rules from input json', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/api.md', 'legacyId = legacy\n');

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          from: 'legacy',
          include: ['docs/**'],
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

      const recordPath = writeVocabularyTransitionRecord([
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          from: 'facet',
          include: ['docs/**'],
          to: 'trailhead',
        }),
      ]);
      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          apply: true,
          planRecord: recordPath,
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
      writeFile(dir, '.agents/notes/history.md', 'facet\n');
      writeFile(dir, '.agents/skills/trails/SKILL.md', 'facet\n');
      writeFile(dir, '.scratch/history.md', 'facet\n');
      writeFile(dir, 'plugin/skills/trails/SKILL.md', 'facet\n');

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
        ...facetTrailheadRegistryExcludes,
        '.scratch/**',
        '.agents/notes/**',
      ]);
      expect(parsed.run?.ledger?.occurrences?.map((o) => o.path)).toEqual([
        '.agents/skills/trails/SKILL.md',
        'plugin/skills/trails/SKILL.md',
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
      writeFile(dir, '.agents/notes/history.md', 'facet\n');
      writeFile(dir, '.scratch/history.md', 'facet\n');
      writeFile(dir, 'docs/keep.md', 'facet\n');

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
      expect(result.value.run?.plan.scope?.exclude).toEqual([
        ...facetTrailheadRegistryExcludes,
        '.scratch/**',
      ]);
      expect(result.value.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        '.agents/notes/history.md',
        'docs/keep.md',
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
      readonly namespace?: {
        readonly commandPath?: readonly string[];
        readonly commands?: readonly RegradeSchemaCommand[];
      };
    };
    expect(parsed.namespace?.commandPath).toEqual(['regrade']);
    expect(
      parsed.namespace?.commands?.map((command) => command.commandPath)
    ).toEqual([
      ['regrade', 'adjust'],
      ['regrade', 'apply'],
      ['regrade', 'check'],
      ['regrade', 'plan'],
      ['regrade', 'plans'],
      ['regrade', 'preview'],
    ]);
    const planCommand = parsed.namespace?.commands?.find(
      (command) => command.commandPath?.join(' ') === 'regrade plan'
    );
    const applyCommand = parsed.namespace?.commands?.find(
      (command) => command.commandPath?.join(' ') === 'regrade apply'
    );
    expectRegradeSchemaFields(planCommand);
    expectRegradeSchemaFlags(planCommand);
    expect(applyCommand?.input?.properties).toHaveProperty('plan');
    expect(applyCommand?.input?.properties).not.toHaveProperty('dryRun');
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

  test('CLI reports no applicable regrade engine for unsupported vocabulary extensions', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'data/surface.json', '{"facet": true}\n');

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          extensions: ['.json'],
          from: 'facet',
          to: 'trailhead',
        }),
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
      expect(parsed.error?.message).toContain(
        'no prose or governed symbol engine'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI preserves missing-root diagnostics for unsupported vocabulary extensions', () => {
    const dir = makeTempDir();
    const missingRoot = join(dir, 'missing');
    try {
      const result = runRawCli([
        'regrade',
        '--root-dir',
        missingRoot,
        '--input-json',
        JSON.stringify({
          extensions: ['.json'],
          from: 'facet',
          to: 'trailhead',
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(2);
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
        category: 'not_found',
        name: 'NotFoundError',
      });
      expect(parsed.error?.message).toContain('could not be read');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI treats fully preserved governed symbol transitions as successful no-ops', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facet = 1;\n');

      const result = runRawCli([
        'regrade',
        '--root-dir',
        dir,
        '--input-json',
        JSON.stringify({
          extensions: ['.ts'],
          from: 'facet',
          preserve: [
            {
              forms: ['facet'],
              pattern: 'facet',
              reason: 'operator-preserved-symbol',
            },
          ],
          to: 'trailhead',
        }),
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        readonly matched?: number;
        readonly rewritten?: number;
        readonly selectedClassIds?: readonly string[];
      };
      expect(parsed).toMatchObject({ matched: 0, rewritten: 0 });
      expect(parsed.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'export const facet = 1;\n'
      );
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
