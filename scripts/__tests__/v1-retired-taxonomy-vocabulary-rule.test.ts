import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWarden } from '@ontrails/warden';

import { v1RetiredTaxonomyVocabulary } from '../../.trails/rules/v1-retired-taxonomy-vocabulary.js';

describe('v1 retired taxonomy vocabulary rule', () => {
  test('reports retired dispatch and connector forms', () => {
    const diagnostics = v1RetiredTaxonomyVocabulary.check(
      'dispatch(value);\nconst StripeConnector = true;\nconnectors/example',
      'packages/example/src/current.ts'
    );

    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 2, 3]);
  });

  test('allows documented history and explicit lexicon seams', () => {
    expect(
      v1RetiredTaxonomyVocabulary.check(
        'dispatch(value); connector',
        'docs/adr/0006-shared-execution-pipeline.md'
      )
    ).toEqual([]);
    expect(
      v1RetiredTaxonomyVocabulary.check('connector', 'docs/lexicon.md')
    ).toEqual([]);
  });

  test('runs against current documentation and scripts', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-retired-taxonomy-'));
    try {
      mkdirSync(join(rootDir, 'docs'), { recursive: true });
      mkdirSync(join(rootDir, 'scripts'), { recursive: true });
      writeFileSync(join(rootDir, 'docs/current.md'), 'Use a connector.\n');
      writeFileSync(join(rootDir, 'scripts/current.sh'), 'dispatch(value)\n');

      const report = await runWarden({
        extraSourceRules: [v1RetiredTaxonomyVocabulary],
        lock: 'skip',
        rootDir,
      });

      expect(
        report.diagnostics
          .filter((entry) => entry.rule === 'v1-retired-taxonomy-vocabulary')
          .map((entry) => entry.filePath)
          .toSorted()
      ).toEqual([
        join(rootDir, 'docs/current.md'),
        join(rootDir, 'scripts/current.sh'),
      ]);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
