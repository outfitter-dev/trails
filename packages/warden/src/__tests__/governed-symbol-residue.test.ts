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

  test('does not flag prose, strings, or planned v1 symbols before activation', () => {
    const diagnostics = check(
      [
        'const message = "crossInput and ctx.cross in prose";',
        'const facet = "planned but not active yet";',
        'const facets = ["still planned"];',
        '',
      ].join('\n')
    );

    expect(diagnostics).toEqual([]);
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
