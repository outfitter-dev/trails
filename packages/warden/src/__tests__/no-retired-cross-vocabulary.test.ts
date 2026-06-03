import { describe, expect, test } from 'bun:test';

import { noRetiredCrossVocabulary } from '../rules/no-retired-cross-vocabulary.js';

const RULE_NAME = 'no-retired-cross-vocabulary';

const check = (sourceCode: string) =>
  noRetiredCrossVocabulary.check(
    sourceCode,
    '/repo/apps/radio/src/trails/play.ts'
  );

describe('no-retired-cross-vocabulary', () => {
  test('carries safe term-rewrite metadata for exact beta.19 replacements', () => {
    const source = [
      'export const play = trail("play", {',
      '  crosses: [loadTrack],',
      '  input: crossInput,',
      '  blaze: (input, ctx) => ctx.cross(loadTrack, input),',
      '});',
    ].join('\n');

    const diagnostics = check(source);

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([2, 3, 4]);
    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      RULE_NAME,
      RULE_NAME,
      RULE_NAME,
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.safety)).toEqual([
      'safe',
      'safe',
      'safe',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.edits?.[0])).toEqual(
      [
        {
          end: source.indexOf('crosses') + 'crosses'.length,
          replacement: 'composes',
          start: source.indexOf('crosses'),
        },
        {
          end: source.indexOf('crossInput') + 'crossInput'.length,
          replacement: 'composeInput',
          start: source.indexOf('crossInput'),
        },
        {
          end: source.indexOf('ctx.cross') + 'ctx.cross'.length,
          replacement: 'ctx.compose',
          start: source.indexOf('ctx.cross'),
        },
      ]
    );
  });

  test('routes Cross type prefixes and partial identifiers to review', () => {
    const diagnostics = check(
      [
        'type CrossTrailInput = { id: string };',
        'const crossOrigin = "*";',
        'const crossfade = true;',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 2, 3]);
    expect(diagnostics.map((diagnostic) => diagnostic.fix?.safety)).toEqual([
      'review',
      'review',
      'review',
    ]);
    expect(
      diagnostics.every((diagnostic) => diagnostic.fix?.edits === undefined)
    ).toBe(true);
  });

  test('does not flag unrelated prose or non-identifier substrings', () => {
    const diagnostics = check(
      [
        'const message = "searches across packages";',
        'const note = "cross-package imports";',
        'const url = "cross-to-compose";',
        'const crossesPackageBoundary = true;',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not produce safe edits when a file also needs review', () => {
    const diagnostics = check(
      ['const crossOrigin = "*";', 'ctx.cross(loadTrack, input);'].join('\n')
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(1);
    expect(diagnostics[0]?.fix?.safety).toBe('review');
    expect(diagnostics[0]?.fix?.edits).toBeUndefined();
  });

  test('clean compose vocabulary produces no diagnostics', () => {
    const diagnostics = check(
      [
        'export const play = trail("play", {',
        '  composes: [loadTrack],',
        '  input: composeInput,',
        '  blaze: (input, ctx) => ctx.compose(loadTrack, input),',
        '});',
      ].join('\n')
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on migration documentation and rule-owned files', () => {
    for (const filePath of [
      '/repo/docs/migration/cross-to-compose.md',
      '/repo/docs/releases/beta15-to-beta19.md',
      '/repo/docs/adr/0049-composition-is-compose-not-cross.md',
      '/repo/packages/warden/src/rules/no-retired-cross-vocabulary.ts',
      '/repo/packages/warden/src/rules/metadata.ts',
      '/repo/packages/warden/src/trails/no-retired-cross-vocabulary.trail.ts',
    ]) {
      const diagnostics = noRetiredCrossVocabulary.check(
        'cross crosses ctx.cross crossInput CrossTrail crossOrigin crossfade',
        filePath
      );
      expect(diagnostics).toHaveLength(0);
    }
  });
});
