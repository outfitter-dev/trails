import { describe, expect, test } from 'bun:test';
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
    expect(result?.reviewDetails).toEqual([
      {
        reason: 'warden-review-required',
        span: { column: 10, end: 18, line: 1, start: 9 },
        symbol: 'authLayer',
      },
    ]);
  });

  test('anchors Warden review spans to the diagnostic line', () => {
    const crossClass = wardenTermRewriteClasses.find(
      (cls) => cls.id === 'term-rewrite:no-retired-cross-vocabulary'
    );
    expect(crossClass).toBeDefined();

    const result = crossClass?.apply(
      'const crossOne = 1;\nconst crossTwo = 2;\n',
      { absolutePath: '/repo/src/cross.ts', path: 'src/cross.ts' }
    );

    expect(result?.kind).toBe('needs-review');
    expect(result?.reviewDetails).toEqual([
      {
        reason: 'warden-review-required',
        span: { column: 7, end: 11, line: 1, start: 6 },
        symbol: 'cross',
      },
      {
        reason: 'warden-review-required',
        span: { column: 7, end: 31, line: 2, start: 26 },
        symbol: 'cross',
      },
    ]);
  });

  test('omits ambiguous same-line Warden review spans', () => {
    const crossClass = wardenTermRewriteClasses.find(
      (cls) => cls.id === 'term-rewrite:no-retired-cross-vocabulary'
    );
    expect(crossClass).toBeDefined();

    const result = crossClass?.apply('const crossOne = crossTwo;\n', {
      absolutePath: '/repo/src/cross.ts',
      path: 'src/cross.ts',
    });

    expect(result?.kind).toBe('needs-review');
    expect(result?.reviewDetails).toEqual([
      {
        reason: 'warden-review-required',
        symbol: 'cross',
      },
      {
        reason: 'warden-review-required',
        symbol: 'cross',
      },
    ]);
  });

  test('carries Warden review details into report entries', () => {
    const legacyLayerClass = wardenTermRewriteClasses.find(
      (cls) => cls.id === 'term-rewrite:no-legacy-layer-imports'
    );
    expect(legacyLayerClass).toBeDefined();

    const report = buildRegradeReport({
      classes: legacyLayerClass ? [legacyLayerClass] : [],
      files: [
        {
          path: 'src/auth.ts',
          source: "import { authLayer } from '@ontrails/permits';\n",
        },
      ],
      root: '/repo',
      skipped: [],
    });

    expect(report.entries[0]?.reviewDetails).toEqual([
      {
        classId: 'term-rewrite:no-legacy-layer-imports',
        reason: 'warden-review-required',
        span: { column: 10, end: 18, line: 1, start: 9 },
        symbol: 'authLayer',
      },
    ]);
  });

  test('reports no-op when Warden finds no term-rewrite diagnostics', () => {
    const report = buildRegradeReport({
      classes: wardenTermRewriteClasses,
      files: [{ path: 'src/a.ts', source: 'export const ok = true;' }],
      includeEntries: 'all',
      root: '/repo',
      skipped: [],
    });

    expect(report.selectedClassIds).toEqual([
      'term-rewrite:governed-symbol-residue',
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

  test('projects rule-local term-rewrite metadata for project rules', () => {
    const rule = {
      check: () => [],
      description: 'Project-local term rewrite.',
      metadata: {
        concern: 'meta',
        depth: 'source',
        fix: {
          class: 'term-rewrite',
          safety: 'safe',
          scanTargets: { extensions: ['.md'], ignoredDirectories: [] },
        },
        invariant: 'Project-local Warden term rewrites can feed Regrade.',
        lifecycle: { retireWhen: 'migration completes', state: 'temporary' },
        scope: 'repo-local',
        tier: 'source-static',
      },
      name: 'project-local-term-rewrite',
      severity: 'error',
    } satisfies WardenRule;

    const cls = createWardenTermRewriteClass(rule);

    expect(cls?.id).toBe('term-rewrite:project-local-term-rewrite');
    expect(cls?.scanTargets).toEqual({
      extensions: ['.md'],
      ignoredDirectories: [],
    });
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
      includeEntries: 'all',
      root: '/repo',
      skipped: [{ path: 'dist', reason: 'ignored-directory' }],
    });

    expect(report.scanned).toBe(3);
    expect(report.rewritten).toBe(1);
    expect(report.review).toBe(1);
    expect(report.matched).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.scan).toEqual({
      byDirectory: [{ files: 2, path: 'src' }],
      byExtension: [{ extension: '.ts', files: 2 }],
      files: { matched: 2, scanned: 3, skipped: 1 },
      skippedByReason: { 'ignored-directory': 1 },
    });
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
    expect(report.skipsByReason).toEqual({ 'ignored-directory': 1 });
  });

  test('defaults report entries to actionable outcomes', () => {
    const report = buildRegradeReport({
      classes: [signalToPing],
      files: [
        { path: 'src/a.ts', source: 'const signal = 1;' },
        { path: 'src/b.ts', source: 'const signalHandler = 1;' },
        { path: 'src/c.ts', source: 'const x = 1;' },
      ],
      root: '/repo',
      skipped: [{ path: 'dist', reason: 'ignored-directory' }],
    });

    expect(report.scanned).toBe(3);
    expect(report.skipped).toBe(1);
    expect(report.skipsByReason).toEqual({ 'ignored-directory': 1 });
    expect(report.entries.map((entry) => entry.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(report.entries.map((entry) => entry.outcome)).toEqual([
      'rewrite',
      'needs-review',
    ]);
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
      includeEntries: 'all',
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

describe('runRegrade', () => {
  test('runRegrade reports coverage over a real root', () => {
    const root = writeReportFixture();
    try {
      const report = expectRunRegradeOk({
        classes: [signalToPing],
        includeEntries: 'all',
        root,
      });
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
        includeEntries: 'all',
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

  test('all-extension classes widen multi-class collection', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-all-extension-class-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'README.md'), 'sourceTerm\n');
      writeFileSync(
        join(root, 'src', 'sourceTerm.ts'),
        'export const sourceTerm = 1;\n'
      );

      const allExtensionTerm = {
        ...createTermRewriteClass({
          from: 'sourceTerm',
          id: 'all-extension-term',
          to: 'targetTerm',
        }),
        scanTargets: { extensions: [] },
      } satisfies RegradeClass;

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
          allExtensionTerm,
        ],
        includeEntries: 'all',
        root,
        selection: { classIds: ['docs-term', 'all-extension-term'] },
      });

      expect(report?.entries.map((entry) => entry.path)).toEqual([
        'README.md',
        'src/sourceTerm.ts',
      ]);
      expect(
        report?.entries.find((entry) => entry.path === 'src/sourceTerm.ts')
      ).toMatchObject({
        classId: 'all-extension-term',
        outcome: 'rewrite',
      });
      expect(report?.rewritten).toBe(2);
      expect(report?.scanned).toBe(2);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('all-extension classes do not widen default class targets', () => {
    const root = mkdtempSync(
      join(tmpdir(), 'regrade-default-extension-class-')
    );
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'README.md'), 'defaultTerm\n');
      writeFileSync(
        join(root, 'src', 'defaultTerm.ts'),
        'export const defaultTerm = 1;\n'
      );

      const defaultTerm = createTermRewriteClass({
        from: 'defaultTerm',
        id: 'default-term',
        to: 'targetTerm',
      });
      const allExtensionNoop = {
        apply: () => ({ kind: 'no-op', notes: [] }),
        describe: 'Inspect every extension without rewriting.',
        id: 'all-extension-noop',
        scanTargets: { extensions: [] },
      } satisfies RegradeClass;

      const report = expectRunRegradeOk({
        classes: [defaultTerm, allExtensionNoop],
        includeEntries: 'all',
        root,
        selection: { classIds: ['default-term', 'all-extension-noop'] },
      });

      expect(
        report?.entries.find((entry) => entry.path === 'README.md')
      ).toMatchObject({
        outcome: 'no-op',
      });
      expect(
        report?.entries.find((entry) => entry.path === 'src/defaultTerm.ts')
      ).toMatchObject({
        classId: 'default-term',
        outcome: 'rewrite',
      });
      expect(report?.rewritten).toBe(1);
      expect(report?.scanned).toBe(2);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('class scan excludes do not hide files from other selected classes', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-class-exclude-'));
    try {
      mkdirSync(join(root, 'src', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'generated', 'a.ts'),
        'export const signal = 1;\n'
      );

      const excludingClass = {
        ...createTermRewriteClass({
          from: 'signal',
          id: 'class-a',
          to: 'blocked',
        }),
        scanTargets: { exclude: ['src/generated/**'] },
      } satisfies RegradeClass;
      const rewriteClass = createTermRewriteClass({
        from: 'signal',
        id: 'class-b',
        to: 'ping',
      });

      const report = expectRunRegradeOk({
        classes: [excludingClass, rewriteClass],
        includeEntries: 'all',
        root,
      });

      expect(report?.scanned).toBe(1);
      expect(report?.skipped).toBe(0);
      expect(report?.rewritten).toBe(1);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          classId: 'class-b',
          outcome: 'rewrite',
          path: 'src/generated/a.ts',
        })
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('later class no-ops still count as scanned after an earlier class skip', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-class-skip-noop-'));
    try {
      mkdirSync(join(root, 'src', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'generated', 'a.ts'),
        'export const value = 1;\n'
      );

      const excludingClass = {
        ...createTermRewriteClass({
          from: 'signal',
          id: 'class-a',
          to: 'blocked',
        }),
        scanTargets: { exclude: ['src/generated/**'] },
      } satisfies RegradeClass;
      const noOpClass = createTermRewriteClass({
        from: 'missingTerm',
        id: 'class-b',
        to: 'replacement',
      });

      const report = expectRunRegradeOk({
        classes: [excludingClass, noOpClass],
        includeEntries: 'all',
        root,
      });

      expect(report?.scanned).toBe(1);
      expect(report?.skipped).toBe(0);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          outcome: 'no-op',
          path: 'src/generated/a.ts',
        })
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('legacy class ignored-directory overrides can scan default-pruned directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-class-ignored-dirs-'));
    try {
      mkdirSync(join(root, 'dist', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'dist', 'generated', 'a.ts'),
        'export const signal = 1;\n'
      );

      const report = expectRunRegradeOk({
        classes: [
          {
            ...signalToPing,
            scanTargets: { ignoredDirectories: [] },
          },
        ],
        includeEntries: 'all',
        root,
      });

      expect(report?.scanned).toBe(1);
      expect(report?.skipped).toBe(0);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          classId: 'term-rewrite:signal->ping',
          outcome: 'rewrite',
          path: 'dist/generated/a.ts',
        })
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('legacy ignored-directory opt-outs stay scoped to the owning class', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-class-ignored-scope-'));
    try {
      mkdirSync(join(root, 'dist', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'dist', 'generated', 'a.ts'),
        'export const signal = 1;\n'
      );

      const optInNoOpClass = {
        ...createTermRewriteClass({
          from: 'missingTerm',
          id: 'class-a',
          to: 'replacement',
        }),
        scanTargets: { ignoredDirectories: [] },
      } satisfies RegradeClass;
      const defaultScopedClass = createTermRewriteClass({
        from: 'signal',
        id: 'class-b',
        to: 'ping',
      });

      const report = expectRunRegradeOk({
        classes: [optInNoOpClass, defaultScopedClass],
        includeEntries: 'all',
        root,
      });

      expect(report?.rewritten).toBe(0);
      expect(report?.scanned).toBe(1);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          outcome: 'no-op',
          path: 'dist/generated/a.ts',
        })
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('run-level ignored-directory overrides apply to every selected class', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-run-ignored-dirs-'));
    try {
      mkdirSync(join(root, 'dist', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'dist', 'generated', 'a.ts'),
        'export const signal = 1;\n'
      );

      const defaultScopedClass = createTermRewriteClass({
        from: 'signal',
        id: 'class-b',
        to: 'ping',
      });

      const report = expectRunRegradeOk({
        classes: [defaultScopedClass],
        collection: { ignoredDirectories: [] },
        includeEntries: 'all',
        root,
      });

      expect(report?.rewritten).toBe(1);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          classId: 'class-b',
          outcome: 'rewrite',
          path: 'dist/generated/a.ts',
        })
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('run-level ignored-directory overrides beat legacy class targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-run-ignored-wins-'));
    try {
      mkdirSync(join(root, 'dist', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'dist', 'generated', 'a.ts'),
        'export const signal = 1;\n'
      );

      const legacyScopedClass = {
        ...createTermRewriteClass({
          from: 'signal',
          id: 'class-b',
          to: 'ping',
        }),
        scanTargets: { ignoredDirectories: ['dist'] },
      } satisfies RegradeClass;

      const report = expectRunRegradeOk({
        classes: [legacyScopedClass],
        collection: { ignoredDirectories: [] },
        includeEntries: 'all',
        root,
      });

      expect(report?.rewritten).toBe(1);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          classId: 'class-b',
          outcome: 'rewrite',
          path: 'dist/generated/a.ts',
        })
      );
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

  test('class-mode collection exclude keeps apply mode away from ignored paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-apply-exclude-'));
    mkdirSync(join(root, '.scratch'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, '.scratch', 'old.ts'),
      'export const signal = 1;\n'
    );
    writeFileSync(join(root, 'src', 'a.ts'), 'export const signal = 2;\n');
    try {
      const report = expectRunRegradeOk({
        apply: true,
        classes: [signalToPing],
        collection: {
          exclude: ['.scratch/**'],
        },
        includeEntries: 'all',
        root,
      });

      expect(report?.scanned).toBe(1);
      expect(report?.rewritten).toBe(1);
      expect(report?.skipsByReason).toMatchObject({ 'ignored-glob': 1 });
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          outcome: 'skip',
          path: '.scratch',
          reason: 'ignored-glob',
        })
      );
      expect(readFileSync(join(root, '.scratch', 'old.ts'), 'utf8')).toBe(
        'export const signal = 1;\n'
      );
      expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe(
        'export const ping = 2;\n'
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('single class scan excludes are reported as class skips', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-single-class-exclude-'));
    try {
      mkdirSync(join(root, 'src', 'generated'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'generated', 'a.ts'),
        'export const signal = 1;\n'
      );

      const report = expectRunRegradeOk({
        classes: [
          {
            ...signalToPing,
            scanTargets: { exclude: ['src/generated/**'] },
          },
        ],
        includeEntries: 'all',
        root,
      });

      expect(report?.scanned).toBe(0);
      expect(report?.skipped).toBe(1);
      expect(report?.entries).toContainEqual(
        expect.objectContaining({
          classId: 'term-rewrite:signal->ping',
          outcome: 'skip',
          path: 'src/generated/a.ts',
          reason: 'regrade-scan-target-filtered',
        })
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

  test('apply input writes through explicit apply mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-trail-apply-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'play.ts'),
      'export const play = trail("play", { crosses: [] });\n'
    );
    try {
      const result = runRegrade({
        apply: true,
        classes: wardenTermRewriteClasses,
        root,
        selection: { classIds: ['term-rewrite:no-retired-cross-vocabulary'] },
      });

      expect(result.isOk()).toBe(true);
      expect(readFileSync(join(root, 'src', 'play.ts'), 'utf8')).toBe(
        'export const play = trail("play", { composes: [] });\n'
      );
      if (result.isOk()) {
        expect(result.value?.apply?.applied).toBe(1);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('apply input returns InternalError when writing fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'regrade-trail-apply-error-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    const target = join(root, 'src', 'play.ts');
    writeFileSync(
      target,
      'export const play = trail("play", { crosses: [] });\n'
    );
    chmodSync(target, 0o444);
    try {
      const result = runRegrade({
        apply: true,
        classes: wardenTermRewriteClasses,
        root,
        selection: { classIds: ['term-rewrite:no-retired-cross-vocabulary'] },
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
