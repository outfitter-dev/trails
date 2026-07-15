import { describe, expect, test } from 'bun:test';

import { createTrailContext } from '@ontrails/core';

import { governedVocabularyPermutationWatch } from '../rules/governed-vocabulary-permutation-watch.js';
import { governedVocabularyPermutationWatchTrail } from '../trails/governed-vocabulary-permutation-watch.trail.js';
import { runProjectWardenRules, runWardenTrails } from '../trails/run.js';
import type {
  GovernedVocabularyHistoryEvidence,
  GovernedVocabularyHistoryFormObservation,
  ProjectContext,
} from '../rules/types.js';

const observation = (
  form: string,
  overrides: Partial<GovernedVocabularyHistoryFormObservation> = {}
): GovernedVocabularyHistoryFormObservation => ({
  disposition: 'in-family-unresolved',
  form,
  line: 4,
  path: 'src/example.ts',
  reason: 'unclassified-neighbor',
  scopeTier: 'in-scope',
  verdict: 'deferred',
  ...overrides,
});

const evidence = (
  latestFormObservations: readonly GovernedVocabularyHistoryFormObservation[],
  overrides: Partial<GovernedVocabularyHistoryEvidence> = {}
): GovernedVocabularyHistoryEvidence => ({
  caseSensitive: false,
  id: 'history-id',
  latestFormObservations,
  path: '.trails/regrade/history/contour-to-entity.json',
  runCount: 2,
  transitionId: 'v1-contour-entity',
  ...overrides,
});

const context = (
  histories: readonly GovernedVocabularyHistoryEvidence[] = []
): ProjectContext => ({
  governedVocabularyHistoryByTransitionId: new Map(
    histories.map((history) => [history.transitionId, history])
  ),
  knownTrailIds: new Set(),
});

describe('governed-vocabulary-permutation-watch', () => {
  test('advises once per governed transition and normalized form', () => {
    const diagnostics = governedVocabularyPermutationWatch.checkProject?.(
      context([
        evidence([
          observation('Discontour', { path: 'src/z.ts' }),
          observation('discontour', { line: 2, path: 'src/a.ts' }),
        ]),
      ])
    );

    expect(diagnostics).toEqual([
      {
        filePath: 'src/a.ts',
        line: 2,
        message:
          "Governed transition 'v1-contour-entity' recorded unknown vocabulary form 'discontour' in committed Regrade history '.trails/regrade/history/contour-to-entity.json' (history-id). Add the form and run an incremental plan, or classify it as out-of-family or preserved.",
        rule: 'governed-vocabulary-permutation-watch',
        severity: 'warn',
      },
    ]);
  });

  test('keeps case-sensitive forms distinct and orders output', () => {
    const diagnostics = governedVocabularyPermutationWatch.checkProject?.(
      context([
        evidence([observation('Zcontour'), observation('acontour')], {
          caseSensitive: true,
        }),
      ])
    );

    expect(diagnostics?.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("'acontour'"),
      expect.stringContaining("'Zcontour'"),
    ]);
  });

  test('persisted preserve and policy classifications suppress repeats', () => {
    const diagnostics = governedVocabularyPermutationWatch.checkProject?.(
      context([
        evidence([
          observation('DISCONTOUR', {
            disposition: 'out-of-family',
            reason: 'explicit preserve',
            verdict: 'skipped',
          }),
          observation('PRECONTOUR', {
            disposition: 'historical-by-policy',
            reason: 'protected history',
            scopeTier: 'policy-classified',
            verdict: 'skipped',
          }),
        ]),
      ])
    );

    expect(diagnostics).toEqual([]);
  });

  test('a path-scoped classification does not hide an unresolved occurrence', () => {
    const diagnostics = governedVocabularyPermutationWatch.checkProject?.(
      context([
        evidence([
          observation('discontour', {
            line: 8,
            path: 'src/live.ts',
          }),
          observation('DISCONTOUR', {
            disposition: 'explicit-preserve',
            line: 2,
            path: 'docs/history.md',
            reason: 'historical evidence',
            verdict: 'skipped',
          }),
        ]),
      ])
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        filePath: 'src/live.ts',
        line: 8,
        message: expect.stringContaining("'discontour'"),
      }),
    ]);
  });

  test('ignores missing history and file-scoped entrypoints', () => {
    expect(
      governedVocabularyPermutationWatch.checkProject?.(context())
    ).toEqual([]);
    expect(
      governedVocabularyPermutationWatch.check(
        'const discontour = true;',
        'x.ts'
      )
    ).toEqual([]);
    expect(
      governedVocabularyPermutationWatch.checkWithContext(
        'const discontour = true;',
        'x.ts',
        context()
      )
    ).toEqual([]);
  });

  test('keeps the exported rule trail file-scoped', async () => {
    const result = await governedVocabularyPermutationWatchTrail.implementation(
      {
        filePath: 'project.ts',
        governedVocabularyHistories: [evidence([observation('discontour')])],
        sourceCode: '',
      },
      createTrailContext()
    );

    expect(result.unwrap().diagnostics).toEqual([]);
  });

  test('runs committed-history diagnostics once through the project runner', () => {
    const diagnostics = runProjectWardenRules({
      governedVocabularyHistories: [evidence([observation('discontour')])],
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/example.ts',
          message: expect.stringContaining(
            "unknown vocabulary form 'discontour'"
          ),
        }),
      ])
    );
  });

  test('forwards invalid governed history context through the project runner', () => {
    const diagnostics = runProjectWardenRules({
      governedVocabularyHistoryIssues: [
        {
          message: 'Committed history evidence is invalid.',
          path: '.trails/regrade/history/invalid.json',
          transitionId: 'v1-projection-derive-render',
        },
      ],
      governedVocabularyHistoryRequired: true,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        {
          filePath: '.trails/regrade/history/invalid.json',
          line: 1,
          message: 'Committed history evidence is invalid.',
          rule: 'governed-symbol-residue',
          severity: 'error',
        },
      ])
    );
  });

  test('does not duplicate project diagnostics through file-scoped runs', async () => {
    const options = {
      governedVocabularyHistories: [evidence([observation('discontour')])],
    };

    const first = await runWardenTrails('src/a.ts', '', options);
    const second = await runWardenTrails('src/b.ts', '', options);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  test('handles representative history volume in one bounded project pass', () => {
    const observations = Array.from({ length: 10_000 }, (_, index) =>
      observation(`neighborContour${index % 100}`, {
        line: index + 1,
        path: `src/fixture-${index % 250}.ts`,
      })
    );
    const startedAt = performance.now();

    const diagnostics = governedVocabularyPermutationWatch.checkProject?.(
      context([evidence(observations)])
    );

    expect(diagnostics).toHaveLength(100);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
