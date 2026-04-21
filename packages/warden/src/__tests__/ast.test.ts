import { describe, expect, test } from 'bun:test';

import {
  __getTrailCalleeNameForTest,
  deriveContourIdentifierName,
  findTrailDefinitions,
  hasIgnoreCommentOnLine,
  parse,
  splitSourceLines,
} from '../rules/ast.js';

describe('deriveContourIdentifierName', () => {
  test('supports the common *Contour binding suffix when resolving known contours', () => {
    expect(
      deriveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user'])
      )
    ).toBe('user');
  });

  test('prefers exact contour ids over the *Contour fallback', () => {
    expect(
      deriveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user', 'userContour'])
      )
    ).toBe('userContour');
  });
});

describe('hasIgnoreCommentOnLine', () => {
  test('matches the pragma when the preceding line is exact', () => {
    const lines = splitSourceLines(
      "// warden-ignore-next-line\nconst x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 2)).toBe(true);
  });

  test('matches the pragma with leading whitespace', () => {
    const lines = splitSourceLines(
      "  // warden-ignore-next-line\n  const x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 2)).toBe(true);
  });

  test('matches the pragma with trailing whitespace (editor did not auto-trim)', () => {
    const lines = splitSourceLines(
      "// warden-ignore-next-line   \nconst x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 2)).toBe(true);
  });

  test('returns false when there is no preceding line', () => {
    const lines = splitSourceLines("const x = '_draft.foo';\n");
    expect(hasIgnoreCommentOnLine(lines, 1)).toBe(false);
  });

  test('returns false when the preceding line is blank', () => {
    const lines = splitSourceLines(
      "// warden-ignore-next-line\n\nconst x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 3)).toBe(false);
  });

  test('accepts pre-split lines so callers memoize across many matches', () => {
    // Regression guard for the O(N × source length) re-split fix. The caller
    // splits once and threads the same lines array through to every lookup.
    const source = Array.from(
      { length: 100 },
      (_, i) => `const v${i} = '_draft.id${i}';`
    ).join('\n');
    const lines = splitSourceLines(source);
    for (let line = 1; line <= 100; line += 1) {
      expect(hasIgnoreCommentOnLine(lines, line)).toBe(false);
    }
  });
});

const parseOrThrow = (source: string) =>
  parse('test.ts', source) ??
  (() => {
    throw new Error('failed to parse');
  })();

const parseCallee = (source: string) => {
  const ast = parseOrThrow(source);
  // The first statement is an ExpressionStatement wrapping the CallExpression.
  const [stmt] = (ast as unknown as { body: readonly unknown[] }).body;
  const { expression } = stmt as { expression: unknown };
  return expression as Parameters<typeof __getTrailCalleeNameForTest>[0];
};

describe('getTrailCalleeName', () => {
  test('matches bare trail(...) identifier callees', () => {
    expect(__getTrailCalleeNameForTest(parseCallee('trail("foo", {});'))).toBe(
      'trail'
    );
  });

  test('matches namespaced ns.trail(...) callees', () => {
    expect(
      __getTrailCalleeNameForTest(parseCallee('core.trail("foo", {});'))
    ).toBe('trail');
  });

  test('matches bare signal(...) identifier callees', () => {
    expect(__getTrailCalleeNameForTest(parseCallee('signal("evt", {});'))).toBe(
      'signal'
    );
  });

  test('matches namespaced ns.signal(...) callees', () => {
    expect(
      __getTrailCalleeNameForTest(parseCallee('core.signal("evt", {});'))
    ).toBe('signal');
  });

  test('rejects computed member access like ns[trail](...)', () => {
    expect(
      __getTrailCalleeNameForTest(parseCallee('ns[trail]("foo", {});'))
    ).toBeNull();
  });

  test('rejects unrelated bare callees', () => {
    expect(
      __getTrailCalleeNameForTest(parseCallee('other("foo", {});'))
    ).toBeNull();
  });

  test('rejects unrelated namespaced callees', () => {
    expect(
      __getTrailCalleeNameForTest(parseCallee('ns.other("foo", {});'))
    ).toBeNull();
  });
});

describe('findTrailDefinitions with namespaced callees', () => {
  test('discovers core.trail("id", { ... }) definitions', () => {
    const source = `
      import * as core from '@ontrails/core';
      export const t = core.trail('entity.show', {
        input: {},
      });
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.show');
    expect(defs[0]?.kind).toBe('trail');
  });

  test('discovers core.signal("id", { ... }) definitions', () => {
    const source = `
      import * as core from '@ontrails/core';
      export const s = core.signal('entity.created', { payload: {} });
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.created');
    expect(defs[0]?.kind).toBe('signal');
  });

  test('still ignores computed-member access ns[trail]("id", ...)', () => {
    const source = `
      const trail = 'x';
      ns[trail]('entity.show', { input: {} });
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });
});
