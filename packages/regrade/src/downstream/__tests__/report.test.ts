import { describe, expect, test } from 'bun:test';
import { executeTrail } from '@ontrails/core';
import type { WardenRule } from '@ontrails/warden';
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

import {
  buildRegradeReport,
  createTermRewriteClass,
  createWardenTermRewriteClass,
  regradeReportTrail,
  runRegrade,
  selectRegradeClasses,
  wardenTermRewriteClasses,
} from '../report.js';
import type { RegradeClass, RegradeReport } from '../report.js';

const signalToPing = createTermRewriteClass({ from: 'signal', to: 'ping' });

const expectRunRegradeOk = (
  params: Parameters<typeof runRegrade>[0]
): RegradeReport | null => {
  const result = runRegrade(params);
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

describe('createTermRewriteClass', () => {
  test('rewrites whole-word occurrences', () => {
    const result = signalToPing.apply('export const signal = makeSignal();');
    // `makeSignal` is not a whole-word `signal`, so it is left untouched.
    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe('export const ping = makeSignal();');
  });

  test('routes ambiguous partial matches to review', () => {
    const result = signalToPing.apply('export const signalHandler = 1;');
    expect(result.kind).toBe('needs-review');
  });

  test('carries structured review details into report entries', () => {
    const report = buildRegradeReport({
      classes: [
        {
          apply: () => ({
            kind: 'needs-review',
            notes: ['Manual review required.'],
            reason: 'test-review',
            reviewDetails: [
              {
                expectedTarget: 'Use targetTerm for grouped trail entries.',
                nodeKind: 'Identifier',
                reason: 'test-review',
                span: { column: 14, end: 19, line: 1, start: 13 },
                suggestedValidation: 'bun test packages/regrade',
                symbol: 'sourceTerm',
              },
            ],
          }),
          describe: 'Review detail fixture.',
          id: 'test-review-detail',
        },
      ],
      files: [
        { path: 'src/sourceTerm.ts', source: 'export const sourceTerm = 1;' },
      ],
      root: '/repo',
      skipped: [],
    });

    expect(report.entries[0]?.reviewDetails).toEqual([
      {
        classId: 'test-review-detail',
        expectedTarget: 'Use targetTerm for grouped trail entries.',
        nodeKind: 'Identifier',
        reason: 'test-review',
        span: { column: 14, end: 19, line: 1, start: 13 },
        suggestedValidation: 'bun test packages/regrade',
        symbol: 'sourceTerm',
      },
    ]);
  });

  test('routes mixed whole-word and partial matches to review', () => {
    const result = signalToPing.apply(
      'const signal = 1; const signalHandler = 2;'
    );
    expect(result.kind).toBe('needs-review');
    expect(result.nextSource).toBeUndefined();
  });

  test('reports no-op when the term is absent', () => {
    expect(signalToPing.apply('export const x = 1;').kind).toBe('no-op');
  });

  test('matches raw text: a whole-word term in a comment is rewritten', () => {
    // Matching is lexer-unaware, so a whole-word `signal` inside a comment is
    // rewritten exactly like a code reference. This pins the documented
    // raw-text behavior (comment/string exclusion is deferred to TRL-832/836).
    const result = signalToPing.apply('// rename the signal here\n');
    expect(result.kind).toBe('rewrite');
    expect(result.nextSource).toBe('// rename the ping here\n');
  });
});

describe('wardenTermRewriteClasses', () => {
  test('projects Warden term-rewrite metadata into Regrade classes', () => {
    expect(wardenTermRewriteClasses.map((cls) => cls.id)).toContain(
      'term-rewrite:no-legacy-layer-imports'
    );
    expect(wardenTermRewriteClasses.map((cls) => cls.id)).toContain(
      'term-rewrite:no-retired-cross-vocabulary'
    );
  });

  test('rewrites safe Warden term-rewrite diagnostics', () => {
    const crossClass = wardenTermRewriteClasses.find(
      (cls) => cls.id === 'term-rewrite:no-retired-cross-vocabulary'
    );
    expect(crossClass).toBeDefined();

    const result = crossClass?.apply(
      'export const play = trail("play", { crosses: [] });\n',
      { absolutePath: '/repo/src/play.ts', path: 'src/play.ts' }
    );

    expect(result?.kind).toBe('rewrite');
    expect(result?.nextSource).toBe(
      'export const play = trail("play", { composes: [] });\n'
    );
    expect(result?.notes.join('\n')).toContain(
      'Retired composition vocabulary'
    );
  });

  test('routes review-required Warden term rewrites to review', () => {
    const legacyLayerClass = wardenTermRewriteClasses.find(
      (cls) => cls.id === 'term-rewrite:no-legacy-layer-imports'
    );
    expect(legacyLayerClass).toBeDefined();

    const result = legacyLayerClass?.apply(
      "import { authLayer } from '@ontrails/permits';\n",
      { absolutePath: '/repo/src/auth.ts', path: 'src/auth.ts' }
    );

    expect(result?.kind).toBe('needs-review');
    expect(result?.reason).toBe('warden-review-required');
    expect(result?.nextSource).toBeUndefined();
    expect(result?.notes.join('\n')).toContain(
      'Removal has no mechanical replacement'
    );
  });

  test('reports no-op when Warden finds no term-rewrite diagnostics', () => {
    const report = buildRegradeReport({
      classes: wardenTermRewriteClasses,
      files: [{ path: 'src/a.ts', source: 'export const ok = true;' }],
      root: '/repo',
      skipped: [],
    });

    expect(report.selectedClassIds).toEqual([
      'term-rewrite:no-legacy-layer-imports',
      'term-rewrite:no-retired-cross-vocabulary',
    ]);
    expect(report.matched).toBe(0);
    expect(report.entries[0]?.outcome).toBe('no-op');
  });

  test('routes mixed safe diagnostics with missing edits to review', () => {
    const rule = {
      check: () => [
        {
          filePath: '/repo/src/auth.ts',
          fix: {
            class: 'term-rewrite',
            edits: [{ end: 9, replacement: 'permit', start: 0 }],
            reason: 'Rename one safe term.',
            safety: 'safe',
          },
          line: 1,
          message: 'Rename one safe term.',
          rule: 'no-legacy-layer-imports',
          severity: 'error',
        },
        {
          filePath: '/repo/src/auth.ts',
          fix: {
            class: 'term-rewrite',
            reason: 'Safe fix metadata was missing concrete edits.',
            safety: 'safe',
          },
          line: 2,
          message: 'Safe fix metadata was missing concrete edits.',
          rule: 'no-legacy-layer-imports',
          severity: 'error',
        },
      ],
      description: 'Test Warden-backed term rewrites.',
      name: 'no-legacy-layer-imports',
      severity: 'error',
    } satisfies WardenRule;
    const cls = createWardenTermRewriteClass(rule);

    const result = cls?.apply('authLayer();\nauthLayer();\n', {
      absolutePath: '/repo/src/auth.ts',
      path: 'src/auth.ts',
    });

    expect(result?.kind).toBe('needs-review');
    expect(result?.reason).toBe('warden-fix-missing-edits');
    expect(result?.nextSource).toBeUndefined();
    expect(result?.notes.join('\n')).toContain('Rename one safe term.');
    expect(result?.notes.join('\n')).toContain(
      'Safe fix metadata was missing concrete edits.'
    );
  });

  test('preserves Warden scan-target filtering for Warden-backed classes', () => {
    const checkedPaths: string[] = [];
    const rule = {
      check: (_source, filePath) => {
        checkedPaths.push(filePath);
        return [
          {
            filePath,
            fix: {
              class: 'term-rewrite',
              reason: 'Test Warden term-rewrite diagnostic.',
              safety: 'review',
            },
            line: 1,
            message: 'Test Warden term-rewrite diagnostic.',
            rule: 'no-legacy-layer-imports',
            severity: 'error',
          },
        ];
      },
      description: 'Test Warden-backed term rewrites.',
      name: 'no-legacy-layer-imports',
      severity: 'error',
    } satisfies WardenRule;
    const cls = createWardenTermRewriteClass(rule);

    for (const context of [
      {
        absolutePath: '/repo/src/types.d.ts',
        path: 'src/types.d.ts',
      },
      {
        absolutePath: '/repo/src/auth.test.ts',
        path: 'src/auth.test.ts',
      },
      {
        absolutePath: '/repo/src/__tests__/auth.ts',
        path: 'src/__tests__/auth.ts',
      },
    ]) {
      const result = cls?.apply('authLayer();\n', context);
      // Scan-filtered files report `skipped`, not a scanned/clean `no-op`.
      expect(result?.kind).toBe('skipped');
    }
    expect(checkedPaths).toEqual([]);

    const result = cls?.apply('authLayer();\n', {
      absolutePath: '/repo/src/auth.tsx',
      path: 'src/auth.tsx',
    });
    expect(result?.kind).toBe('needs-review');
    expect(checkedPaths).toEqual(['/repo/src/auth.tsx']);
  });
});

describe('selectRegradeClasses', () => {
  const a = createTermRewriteClass({ from: 'a', id: 'cls.a', to: 'A' });
  const b = createTermRewriteClass({ from: 'b', id: 'cls.b', to: 'B' });

  test('returns all classes when no selection is given', () => {
    expect(selectRegradeClasses([a, b]).selected.map((c) => c.id)).toEqual([
      'cls.a',
      'cls.b',
    ]);
  });

  test('runs only the selected class and reports unknown ids', () => {
    const { selected, unknownClassIds } = selectRegradeClasses([a, b], {
      classIds: ['cls.b', 'cls.missing'],
    });
    expect(selected.map((c) => c.id)).toEqual(['cls.b']);
    expect(unknownClassIds).toEqual(['cls.missing']);
  });
});

describe('buildRegradeReport', () => {
  test('tallies scanned/matched/rewritten/review/skipped with sorted entries', () => {
    const report = buildRegradeReport({
      classes: [signalToPing],
      files: [
        // a.ts -> rewrite, b.ts -> review (partial match), c.ts -> no-op
        { path: 'src/a.ts', source: 'const signal = 1;' },
        { path: 'src/b.ts', source: 'const signalHandler = 1;' },
        { path: 'src/c.ts', source: 'const x = 1;' },
      ],
      root: '/repo',
      skipped: [{ path: 'dist', reason: 'ignored-directory' }],
    });

    expect(report.scanned).toBe(3);
    expect(report.rewritten).toBe(1);
    expect(report.review).toBe(1);
    expect(report.matched).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.selectedClassIds).toEqual(['term-rewrite:signal->ping']);
    expect(report.entries.map((e) => e.path)).toEqual([
      'dist',
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
    const byPath = new Map(report.entries.map((e) => [e.path, e]));
    expect(byPath.get('src/a.ts')?.outcome).toBe('rewrite');
    expect(byPath.get('src/b.ts')?.outcome).toBe('needs-review');
    expect(byPath.get('src/c.ts')?.outcome).toBe('no-op');
    expect(byPath.get('dist')?.outcome).toBe('skip');
  });

  test('selection runs one class without executing the others', () => {
    const other = createTermRewriteClass({
      from: 'foo',
      id: 'cls.foo',
      to: 'bar',
    });
    const report = buildRegradeReport({
      classes: [signalToPing, other],
      files: [{ path: 'src/a.ts', source: 'const foo = 1; const signal = 2;' }],
      root: '/repo',
      selection: { classIds: ['cls.foo'] },
      skipped: [],
    });
    expect(report.selectedClassIds).toEqual(['cls.foo']);
    expect(report.entries[0]?.classId).toBe('cls.foo');
    expect(report.entries[0]?.outcome).toBe('rewrite');
  });

  test('counts scan-filtered files as skipped, not scanned', () => {
    const rule = {
      check: () => [],
      description: 'Test Warden-backed term rewrites.',
      name: 'no-legacy-layer-imports',
      severity: 'error',
    } satisfies WardenRule;
    const cls = createWardenTermRewriteClass(rule);
    expect(cls).not.toBeNull();

    const report = buildRegradeReport({
      classes: cls ? [cls] : [],
      files: [
        // Scan-filtered (infrastructure) — must be skipped, not scanned/clean.
        { path: 'src/types.d.ts', source: 'export {};\n' },
        // Real source file with no diagnostics — a genuine no-op scan.
        { path: 'src/auth.ts', source: 'export const x = 1;\n' },
      ],
      root: '/repo',
      skipped: [],
    });

    expect(report.scanned).toBe(1);
    expect(report.skipped).toBe(1);
    const skipEntry = report.entries.find((e) => e.path === 'src/types.d.ts');
    expect(skipEntry?.outcome).toBe('skip');
    expect(skipEntry?.reason).toBe('warden-scan-target-filtered');
  });

  test('routes rewrite outcomes without concrete nextSource to review', () => {
    const brokenRewrite = {
      apply: () => ({
        kind: 'rewrite',
        notes: ['missing source'],
      }),
      describe: 'Broken rewrite for test coverage.',
      id: 'broken-rewrite',
    } satisfies RegradeClass;

    const report = buildRegradeReport({
      classes: [brokenRewrite],
      files: [{ path: 'src/a.ts', source: 'const x = 1;' }],
      root: '/repo',
      skipped: [],
    });

    expect(report.rewritten).toBe(0);
    expect(report.review).toBe(1);
    expect(report.entries[0]?.outcome).toBe('needs-review');
    expect(report.entries[0]?.reason).toBe('regrade-rewrite-missing-source');
  });
});

const writeReportFixture = (): string => {
  // Scratch under the OS temp root, not the package tree, so a concurrent
  // collector run never walks another test's scratch dir and an interrupted
  // run leaves nothing under `src/`.
  const root = mkdtempSync(join(tmpdir(), 'regrade-report-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { authLayer } from '@ontrails/permits';\nexport const signal = 1;\n"
  );
  writeFileSync(join(root, 'src', 'b.ts'), 'export const signalHandler = 2;\n');
  writeFileSync(join(root, 'dist', 'out.ts'), 'export const signal = 9;\n');
  return root;
};

const writeApplyFixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'regrade-apply-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const signal = 1;\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'export const signalHandler = 2;\n');
  writeFileSync(join(root, 'src', 'c.ts'), 'export const x = 3;\n');
  writeFileSync(join(root, 'dist', 'out.ts'), 'export const signal = 4;\n');
  return root;
};

describe('runRegrade + regradeReportTrail', () => {
  test('trail intent reflects apply-mode write capability', () => {
    expect(regradeReportTrail.intent).toBe('write');
  });

  test('runRegrade reports coverage over a real root', () => {
    const root = writeReportFixture();
    try {
      const report = expectRunRegradeOk({ classes: [signalToPing], root });
      expect(report).not.toBeNull();
      const r = report as NonNullable<typeof report>;
      // dist/out.ts is skipped at the directory level, so only 2 files scanned.
      expect(r.scanned).toBe(2);
      expect(r.rewritten).toBe(1);
      expect(r.review).toBe(1);
      expect(
        r.entries.some((e) => e.path === 'dist' && e.outcome === 'skip')
      ).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('runRegrade derives collection extensions from selected classes', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-run-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'README.md'), 'sourceTerm\n');
      writeFileSync(
        join(root, 'src', 'sourceTerm.ts'),
        'export const sourceTerm = 1;\n'
      );

      const report = expectRunRegradeOk({
        classes: [
          {
            apply: (source) =>
              source.includes('sourceTerm')
                ? {
                    kind: 'rewrite',
                    nextSource: source.replaceAll('sourceTerm', 'targetTerm'),
                    notes: ['Rewrote docs term.'],
                  }
                : { kind: 'no-op', notes: [] },
            describe: 'Rewrite docs vocabulary.',
            id: 'docs-term',
            scanTargets: { extensions: ['.md'] },
          },
        ],
        root,
        selection: { classIds: ['docs-term'] },
      });

      expect(report?.entries.map((entry) => entry.path)).toEqual([
        'README.md',
        'src/sourceTerm.ts',
      ]);
      expect(
        report?.entries.find((entry) => entry.path === 'src/sourceTerm.ts')
          ?.outcome
      ).toBe('skip');
      expect(report?.rewritten).toBe(1);
      expect(report?.scanned).toBe(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('unknown-only selection reports ids without collecting sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-run-unknown-only-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(root, 'src', 'a.ts'), 'export const signal = 1;\n');
      writeFileSync(
        join(root, 'node_modules', 'pkg', 'a.ts'),
        'export const signal = 2;\n'
      );

      const report = expectRunRegradeOk({
        classes: [signalToPing],
        root,
        selection: { classIds: ['missing-class'] },
      });

      expect(report?.selectedClassIds).toEqual([]);
      expect(report?.unknownClassIds).toEqual(['missing-class']);
      expect(report?.scanned).toBe(0);
      expect(report?.skipped).toBe(0);
      expect(report?.entries).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('unknown-only selection still validates the root', () => {
    expect(
      expectRunRegradeOk({
        classes: [signalToPing],
        root: join(import.meta.dir, 'does-not-exist-xyz'),
        selection: { classIds: ['missing-class'] },
      })
    ).toBeNull();
  });

  test('returns null for an unreadable root', () => {
    const result = runRegrade({
      classes: [signalToPing],
      root: join(import.meta.dir, 'does-not-exist-xyz'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toBeNull();
  });

  test('dry-run is the default and does not write rewrite outcomes', () => {
    const root = writeApplyFixture();
    try {
      const target = join(root, 'src', 'a.ts');
      const report = expectRunRegradeOk({ classes: [signalToPing], root });

      expect(report?.rewritten).toBe(1);
      expect(report?.apply).toBeUndefined();
      expect(readFileSync(target, 'utf8')).toBe('export const signal = 1;\n');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('apply mode writes only safe rewrite outcomes with nextSource', () => {
    const root = writeApplyFixture();
    try {
      const report = expectRunRegradeOk({
        apply: true,
        classes: [signalToPing],
        root,
      });

      expect(report?.apply).toEqual({
        applied: 1,
        filesChanged: 1,
        review: 1,
        skipped: 1,
        unknown: 0,
      });
      expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe(
        'export const ping = 1;\n'
      );
      expect(readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe(
        'export const signalHandler = 2;\n'
      );
      expect(readFileSync(join(root, 'src', 'c.ts'), 'utf8')).toBe(
        'export const x = 3;\n'
      );
      expect(readFileSync(join(root, 'dist', 'out.ts'), 'utf8')).toBe(
        'export const signal = 4;\n'
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('apply mode writes nothing when selected classes include an unknown id', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-apply-unknown-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const signal = 1;\n');
    try {
      const report = expectRunRegradeOk({
        apply: true,
        classes: [signalToPing],
        root,
        selection: {
          classIds: ['term-rewrite:signal->ping', 'missing-class'],
        },
      });

      expect(report?.unknownClassIds).toEqual(['missing-class']);
      expect(report?.apply).toEqual({
        applied: 0,
        filesChanged: 0,
        review: 0,
        skipped: 1,
        unknown: 1,
      });
      expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe(
        'export const signal = 1;\n'
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('apply mode returns InternalError when a rewrite cannot be written', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-apply-write-error-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const signal = 1;\n');
    try {
      const result = runRegrade({
        apply: true,
        classes: [
          {
            apply: (_source, context) => {
              if (context?.absolutePath !== undefined) {
                rmSync(dirname(context.absolutePath), {
                  force: true,
                  recursive: true,
                });
              }
              return {
                kind: 'rewrite',
                nextSource: 'export const ping = 1;\n',
                notes: ['Simulated a write race.'],
              };
            },
            describe: 'Simulate a file disappearing before write.',
            id: 'test-write-error',
          },
        ],
        root,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.context).toMatchObject({
          applied: 0,
          classId: 'test-write-error',
          filesChanged: 0,
          path: 'src/a.ts',
        });
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('trail returns Ok with a report for a readable root', async () => {
    const root = writeReportFixture();
    try {
      const result = await executeTrail(regradeReportTrail, { root });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // executeTrail returns Result<unknown, Error>; narrow the Ok value to
        // the trail's output shape for property access.
        const value = result.value as {
          scanned: number;
          review: number;
          selectedClassIds: string[];
          rewritten: number;
        };
        expect(value.scanned).toBe(2);
        expect(value.review).toBe(1);
        expect(value.rewritten).toBe(0);
        expect(value.selectedClassIds).toEqual([
          'term-rewrite:no-legacy-layer-imports',
          'term-rewrite:no-retired-cross-vocabulary',
        ]);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('trail returns NotFoundError for an unreadable root', async () => {
    const result = await executeTrail(regradeReportTrail, {
      root: join(import.meta.dir, 'does-not-exist-xyz'),
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('NotFoundError');
    }
  });

  test('trail apply input writes through explicit apply mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-trail-apply-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'play.ts'),
      'export const play = trail("play", { crosses: [] });\n'
    );
    try {
      const result = await executeTrail(regradeReportTrail, {
        apply: true,
        classIds: ['term-rewrite:no-retired-cross-vocabulary'],
        root,
      });

      expect(result.isOk()).toBe(true);
      expect(readFileSync(join(root, 'src', 'play.ts'), 'utf8')).toBe(
        'export const play = trail("play", { composes: [] });\n'
      );
      if (result.isOk()) {
        const value = result.value as { apply?: { applied: number } };
        expect(value.apply?.applied).toBe(1);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('trail apply input returns InternalError when writing fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-trail-apply-error-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    const target = join(root, 'src', 'play.ts');
    writeFileSync(
      target,
      'export const play = trail("play", { crosses: [] });\n'
    );
    chmodSync(target, 0o444);
    try {
      const result = await executeTrail(regradeReportTrail, {
        apply: true,
        classIds: ['term-rewrite:no-retired-cross-vocabulary'],
        root,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('InternalError');
      }
    } finally {
      chmodSync(target, 0o644);
      rmSync(root, { force: true, recursive: true });
    }
  });
});
