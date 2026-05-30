import { describe, expect, test } from 'bun:test';
import { executeTrail } from '@ontrails/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildRegradeReport,
  createTermRewriteClass,
  regradeReportTrail,
  runRegrade,
  selectRegradeClasses,
} from '../report.js';

const signalToPing = createTermRewriteClass({ from: 'signal', to: 'ping' });

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
});

const writeReportFixture = (): string => {
  // Scratch under the OS temp root, not the package tree, so a concurrent
  // collector run never walks another test's scratch dir and an interrupted
  // run leaves nothing under `src/`.
  const root = mkdtempSync(join(tmpdir(), 'regrade-report-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const signal = 1;\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'export const signalHandler = 2;\n');
  writeFileSync(join(root, 'dist', 'out.ts'), 'export const signal = 9;\n');
  return root;
};

describe('runRegrade + regradeReportTrail', () => {
  test('runRegrade reports coverage over a real root', () => {
    const root = writeReportFixture();
    try {
      const report = runRegrade({ classes: [signalToPing], root });
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

  test('returns null for an unreadable root', () => {
    expect(
      runRegrade({
        classes: [signalToPing],
        root: join(import.meta.dir, 'does-not-exist-xyz'),
      })
    ).toBeNull();
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
          selectedClassIds: string[];
          rewritten: number;
        };
        expect(value.scanned).toBe(2);
        expect(value.rewritten).toBe(1);
        expect(value.selectedClassIds).toEqual([
          'preview.term-rewrite:signal->ping',
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
});
