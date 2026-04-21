import { describe, expect, test } from 'bun:test';

import {
  deriveContourIdentifierName,
  hasIgnoreCommentOnLine,
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
