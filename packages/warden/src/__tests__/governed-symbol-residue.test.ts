import { describe, expect, test } from 'bun:test';

import { governedSymbolResidue } from '../rules/governed-symbol-residue.js';

const check = (sourceCode: string) =>
  governedSymbolResidue.check(sourceCode, '/repo/src/example.ts');

describe('governed-symbol-residue', () => {
  test('does not duplicate cross-compose fixes owned by the beta.19 rule', () => {
    const diagnostics = check(
      [
        'const crossInput = { id: "track" };',
        'export const run = () => ctx.cross(loadTrack, crossInput);',
        '',
      ].join('\n')
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags completed v1 symbols without flagging prose or strings', () => {
    const diagnostics = check(
      [
        'const message = "crossInput and ctx.cross in prose";',
        'const facet = "retired but string-safe";',
        'const facets = ["retired but string-safe"];',
        '',
      ].join('\n')
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          edits: [{ end: 64, replacement: 'trailhead', start: 59 }],
          safety: 'safe',
        }),
        line: 2,
        message:
          "Retired governed symbol 'facet' should migrate to 'trailhead'.",
        rule: 'governed-symbol-residue',
        severity: 'error',
      }),
      expect.objectContaining({
        fix: expect.objectContaining({
          class: 'term-rewrite',
          edits: [{ end: 106, replacement: 'trailheads', start: 100 }],
          safety: 'safe',
        }),
        line: 3,
        message:
          "Retired governed symbol 'facets' should migrate to 'trailheads'.",
        rule: 'governed-symbol-residue',
        severity: 'error',
      }),
    ]);
  });

  test('allows the governed vocabulary registry to name retired symbols', () => {
    const diagnostics = governedSymbolResidue.check(
      [
        'const safeRewriteForms = [{ from: "crossInput", to: "composeInput" }];',
        'const reviewForms = [{ from: "crosses", to: "composes" }];',
        '',
      ].join('\n'),
      '/repo/packages/warden/src/rules/retired-vocabulary.ts'
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores parse failures because parser diagnostics belong elsewhere', () => {
    expect(check('export const = ;')).toEqual([]);
  });
});
