import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWarden } from '@ontrails/warden';

import { v1RetiredApiVocabulary } from '../../.trails/rules/v1-retired-api-vocabulary.js';

describe('v1 retired API vocabulary rule', () => {
  test('reports every retired API form', () => {
    const diagnostics = v1RetiredApiVocabulary.check(
      [
        'run: async (input) => input',
        'follow: []',
        'ctx.follow(other)',
        'service({})',
        'services: []',
        'event({})',
        'ctx.emit(changed)',
        'emits: []',
        'trigger(schedule)',
        'readonly signal: AbortSignal',
      ].join('\n'),
      'packages/example/src/current.ts'
    );

    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  test('preserves reviewed history and compatibility seams', () => {
    expect(
      v1RetiredApiVocabulary.check(
        'follow: []\nctx.emit(changed)\nemits: []',
        'docs/adr/0001-history.md'
      )
    ).toEqual([]);
    expect(
      v1RetiredApiVocabulary.check(
        'run: () => undefined',
        'packages/store/src/testing.ts'
      )
    ).toEqual([]);
    expect(
      v1RetiredApiVocabulary.check(
        'event({})',
        'packages/warden/src/__tests__/valid-describe-refs.test.ts'
      )
    ).toEqual([]);
    expect(
      v1RetiredApiVocabulary.check(
        'trigger(schedule)',
        'packages/core/src/__tests__/schedule-runtime.test.ts'
      )
    ).toEqual([]);
    expect(
      v1RetiredApiVocabulary.check(
        'readonly signal: AbortSignal',
        'packages/core/src/__tests__/execute.test.ts'
      )
    ).toEqual([]);
    expect(
      v1RetiredApiVocabulary.check('service({})', 'docs/adr/0001-history.md')
    ).toHaveLength(1);
    expect(
      v1RetiredApiVocabulary.check(
        'service({})',
        'adapters/example/src/current.ts'
      )
    ).toEqual([]);
  });

  test('runs against current documentation and text files', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-api-vocabulary-'));
    try {
      mkdirSync(join(rootDir, 'docs'), { recursive: true });
      mkdirSync(join(rootDir, 'plugin'), { recursive: true });
      mkdirSync(join(rootDir, 'scripts'), { recursive: true });
      writeFileSync(
        join(rootDir, 'docs/current.md'),
        'Use ctx.emit(changed).\n'
      );
      writeFileSync(
        join(rootDir, 'plugin/plugin.json'),
        '{"field":"services:"}\n'
      );
      writeFileSync(join(rootDir, 'scripts/current.sh'), 'trigger(schedule)\n');

      const report = await runWarden({
        extraSourceRules: [v1RetiredApiVocabulary],
        lock: 'skip',
        rootDir,
      });

      expect(
        report.diagnostics
          .filter((entry) => entry.rule === 'v1-retired-api-vocabulary')
          .map((entry) => entry.filePath)
          .toSorted()
      ).toEqual([
        join(rootDir, 'docs/current.md'),
        join(rootDir, 'plugin/plugin.json'),
        join(rootDir, 'scripts/current.sh'),
      ]);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
