import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWarden } from '@ontrails/warden';

import { v1RetiredLayerVocabulary } from '../../.trails/rules/v1-retired-layer-vocabulary.js';

describe('v1 retired layer vocabulary rule', () => {
  test('reports every retired layer form', () => {
    const diagnostics = v1RetiredLayerVocabulary.check(
      'Gate\ngates middleware',
      'packages/example/src/current.ts'
    );

    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 2, 2]);
  });

  test('allows numbered gates, documented history, and lexicon seams', () => {
    expect(
      v1RetiredLayerVocabulary.check(
        'Gate 2',
        'packages/example/src/current.ts'
      )
    ).toEqual([]);
    expect(
      v1RetiredLayerVocabulary.check(
        'Gate gates middleware',
        'docs/adr/0043-layer-evolution.md'
      )
    ).toEqual([]);
    expect(
      v1RetiredLayerVocabulary.check('gates middleware', 'AGENTS.md')
    ).toEqual([]);
    expect(
      v1RetiredLayerVocabulary.check('Gate', '/tmp/ontrails-checkout/AGENTS.md')
    ).toHaveLength(1);
    expect(
      v1RetiredLayerVocabulary.check(
        'Gate gates middleware',
        'adapters/vite/src/index.ts'
      )
    ).toEqual([]);
  });

  test('runs against current documentation and text files', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-layer-vocabulary-'));
    try {
      mkdirSync(join(rootDir, 'docs'), { recursive: true });
      mkdirSync(join(rootDir, 'plugin'), { recursive: true });
      mkdirSync(join(rootDir, 'scripts'), { recursive: true });
      writeFileSync(join(rootDir, 'docs/current.md'), 'Use middleware.\n');
      writeFileSync(join(rootDir, 'plugin/plugin.json'), '{"term":"Gate"}\n');
      writeFileSync(join(rootDir, 'scripts/current.sh'), 'Gate\n');
      writeFileSync(join(rootDir, 'scripts/current.toml'), 'term = "Gate"\n');

      const report = await runWarden({
        extraSourceRules: [v1RetiredLayerVocabulary],
        lock: 'skip',
        rootDir,
      });

      expect(
        report.diagnostics
          .filter((entry) => entry.rule === 'v1-retired-layer-vocabulary')
          .map((entry) => entry.filePath)
          .toSorted()
      ).toEqual([
        join(rootDir, 'docs/current.md'),
        join(rootDir, 'plugin/plugin.json'),
        join(rootDir, 'scripts/current.sh'),
        join(rootDir, 'scripts/current.toml'),
      ]);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
