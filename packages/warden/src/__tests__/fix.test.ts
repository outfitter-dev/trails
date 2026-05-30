import { describe, expect, test } from 'bun:test';

import { applySafeFixesToSource } from '../fix.js';
import type { WardenDiagnostic } from '../rules/index.js';

const baseDiagnostic = (
  overrides: Partial<WardenDiagnostic>
): WardenDiagnostic => ({
  filePath: 'entity.ts',
  line: 1,
  message: 'test diagnostic',
  rule: 'test-rule',
  severity: 'error',
  ...overrides,
});

describe('applySafeFixesToSource', () => {
  test('applies a safe source edit and reports it as applied', () => {
    const source = 'const signal = 1;';
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        edits: [{ end: 12, replacement: 'ping', start: 6 }],
        reason: 'rename signal to ping',
        safety: 'safe',
      },
    });

    const result = applySafeFixesToSource(source, [diagnostic]);

    expect(result.changed).toBe(true);
    expect(result.patched).toBe('const ping = 1;');
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  test('leaves a review-required fix untouched and still reported', () => {
    const source = `import { authLayer } from '@ontrails/core';`;
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        reason: 'legacy layer removed; needs human migration',
        safety: 'review',
      },
    });

    const result = applySafeFixesToSource(source, [diagnostic]);

    expect(result.changed).toBe(false);
    expect(result.patched).toBe(source);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.fix?.safety).toBe('review');
  });

  test('treats a diagnostic with no fix as skipped', () => {
    const source = 'const x = 1;';
    const result = applySafeFixesToSource(source, [baseDiagnostic({})]);
    expect(result.changed).toBe(false);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  test('applies multiple safe edits last-to-first across one source', () => {
    const source = 'aaa bbb ccc';
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        edits: [
          { end: 3, replacement: 'XXXX', start: 0 },
          { end: 11, replacement: 'Z', start: 8 },
        ],
        reason: 'two independent rewrites',
        safety: 'safe',
      },
    });

    const result = applySafeFixesToSource(source, [diagnostic]);

    // Both spans applied; the earlier offset stays valid because edits run
    // right-to-left.
    expect(result.patched).toBe('XXXX bbb Z');
    expect(result.changed).toBe(true);
  });

  test('applies offsets as JavaScript string indices after multibyte text', () => {
    const source = 'const label = "café"; const signal = 1;';
    const start = source.indexOf('signal');
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        edits: [{ end: start + 'signal'.length, replacement: 'ping', start }],
        reason: 'rename signal to ping',
        safety: 'safe',
      },
    });

    const result = applySafeFixesToSource(source, [diagnostic]);

    expect(result.patched).toBe('const label = "café"; const ping = 1;');
    expect(result.changed).toBe(true);
  });

  test('applies safe edits while skipping review fixes in the same file', () => {
    const source = 'const signal = 1;';
    const safe = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        edits: [{ end: 12, replacement: 'ping', start: 6 }],
        reason: 'safe rename',
        safety: 'safe',
      },
    });
    const review = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        reason: 'needs review',
        safety: 'review',
      },
    });

    const result = applySafeFixesToSource(source, [safe, review]);

    expect(result.patched).toBe('const ping = 1;');
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  test('throws on out-of-bounds edits rather than corrupting source', () => {
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        edits: [{ end: 999, replacement: 'x', start: 0 }],
        reason: 'bad span',
        safety: 'safe',
      },
    });
    expect(() => applySafeFixesToSource('short', [diagnostic])).toThrow();
  });

  test.each([
    {
      edit: { end: 1, replacement: 'x', start: Number.NaN },
      name: 'NaN start',
    },
    {
      edit: { end: Number.POSITIVE_INFINITY, replacement: 'x', start: 0 },
      name: 'infinite end',
    },
    {
      edit: { end: 2, replacement: 'x', start: 0.5 },
      name: 'fractional start',
    },
  ])('throws on $name offsets rather than corrupting source', ({ edit }) => {
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        edits: [edit],
        reason: 'bad span',
        safety: 'safe',
      },
    });

    expect(() => applySafeFixesToSource('abc', [diagnostic])).toThrow(
      /safe integer offsets/
    );
  });

  test('throws on overlapping safe edits rather than corrupting source', () => {
    const diagnostic = baseDiagnostic({
      fix: {
        class: 'term-rewrite',
        // [0, 5) and [3, 8) overlap; applied last-to-first, the later edit's
        // end (8) crosses the earlier edit's start, which must throw.
        edits: [
          { end: 5, replacement: 'A', start: 0 },
          { end: 8, replacement: 'B', start: 3 },
        ],
        reason: 'overlapping spans',
        safety: 'safe',
      },
    });
    expect(() => applySafeFixesToSource('0123456789', [diagnostic])).toThrow(
      /overlaps/
    );
  });
});
