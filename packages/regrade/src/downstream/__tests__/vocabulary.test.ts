import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getGovernedVocabularyTransition } from '@ontrails/warden';

import {
  runVocabularyRegrade,
  vocabularyRegradePlanSchema,
} from '../vocabulary.js';
import {
  listVocabularyRegradePlansFromRegistry,
  vocabularyRegradePlanFromTransition,
} from '../vocabulary-registry.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), `trails-vocabulary-regrade-${Date.now()}-`));

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

describe('runVocabularyRegrade', () => {
  test('runs single-target governed vocabulary transitions from the registry', () => {
    const transition = getGovernedVocabularyTransition('v1-facet-trailhead');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected facet vocabulary transition.');
    }
    const plan = vocabularyRegradePlanFromTransition(transition);
    expect(plan).toMatchObject({
      from: 'facet',
      id: 'v1-facet-trailhead',
      kind: 'vocabulary',
      to: 'trailhead',
    });
    if (plan === null) {
      throw new Error('Expected single-target transition to produce a plan.');
    }

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facets = ["facet"];\nexport const Facet = "review";\nexport const facetId = "manual";\n'
      );

      const result = runVocabularyRegrade({
        plan: { ...plan, scope: { include: ['src/**/*.ts'] } },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toMatchObject({
        Facet: 'deferred',
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not turn classified vocabulary transitions into unsafe plans', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-projection-derive-render'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected projection vocabulary transition.');
    }

    expect(vocabularyRegradePlanFromTransition(transition)).toBeNull();
  });

  test('does not turn review-only registry defaults into unsafe plans', () => {
    const transition = getGovernedVocabularyTransition('cross-compose');
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected cross vocabulary transition.');
    }

    expect(vocabularyRegradePlanFromTransition(transition)).toBeNull();
    expect(
      listVocabularyRegradePlansFromRegistry().map((plan) => plan.id)
    ).not.toContain('cross-compose');
  });

  test('registry-generated plans preserve review forms as deferred inventory', () => {
    const transition = getGovernedVocabularyTransition(
      'v1-blaze-implementation'
    );
    expect(transition).toBeDefined();
    if (transition === undefined) {
      throw new Error('Expected blaze vocabulary transition.');
    }
    const plan = vocabularyRegradePlanFromTransition(transition);
    if (plan === null) {
      throw new Error(
        'Expected blaze vocabulary transition to produce a plan.'
      );
    }
    expect(plan).toMatchObject({
      from: 'blaze',
      id: 'v1-blaze-implementation',
      kind: 'vocabulary',
      to: 'implementation',
    });
    expect(plan.deferForms).toContain('blazing');

    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/blaze.ts',
        'export const blaze = "safe";\nexport const blazing = "review";\n'
      );

      const result = runVocabularyRegrade({
        plan: { ...plan, scope: { include: ['src/**/*.ts'] } },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toMatchObject({
        blaze: 'modified',
        blazing: 'deferred',
      });
      expect(result.value.run.report.gate.status).toBe('open');
      expect(result.value.run.report.gate.reasons).toContain(
        'deferred-forms-or-occurrences'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lets deferred forms take precedence over safe rewrite targets', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const facet = "facet";\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          deferForms: ['facet'],
          from: 'facet',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.run.ledger.forms).toEqual({ facet: 'deferred' });
      expect(
        result.value.run.ledger.occurrences.every(
          (occurrence) => occurrence.verdict === 'deferred'
        )
      ).toBe(true);
      expect(result.value.run.report).toMatchObject({
        deferred: 2,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 2,
          status: 'open',
        },
        modified: 0,
        open: 2,
      });
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'export const facet = "facet";\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('dry-runs authored vocabulary plans into plan ledger report shape', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facets = ["facet"];\nexport const facetId = "manual";\n'
      );

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { include: ['src/**/*.ts'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.plan).toMatchObject({
        from: 'facet',
        kind: 'vocabulary',
        to: 'trailhead',
      });
      expect(result.value?.run?.ledger.forms).toEqual({
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 0,
        deferred: 1,
        gate: {
          reasons: [
            'safe-modifications-not-yet-applied',
            'deferred-forms-or-occurrences',
          ],
          remaining: 3,
          status: 'open',
        },
        modified: 2,
        open: 3,
        skipped: 0,
      });
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('honors include globs when collecting vocabulary sources', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/keep.md', 'facet\n');
      writeFile(dir, 'docs/skip.md', 'facet\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { extensions: ['.md'], include: ['docs/keep.*'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.skipsByReason).toMatchObject({
        'not-included-glob': 1,
      });
      expect(readFileSync(join(dir, 'docs', 'keep.md'), 'utf8')).toBe(
        'trailhead\n'
      );
      expect(readFileSync(join(dir, 'docs', 'skip.md'), 'utf8')).toBe(
        'facet\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('applies safe captures and preserves authored contexts', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        'facet belongs here\nlegacy facet stays here\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [
            { pattern: 'legacy facet', reason: 'documented old example' },
          ],
          scope: { extensions: ['.md'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 0,
        skipped: 1,
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        gate: { status: 'green' },
        modified: 0,
        open: 0,
        skipped: 1,
      });
      expect(
        result.value?.run?.ledger.occurrences.find(
          (occurrence) => occurrence.verdict === 'skipped'
        )
      ).not.toHaveProperty('replacement');
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'trailhead belongs here\nlegacy facet stays here\n'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers markdown code contexts instead of treating them as safe prose', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        [
          'facet prose should move.',
          'Inline `facet` should be reviewed.',
          '',
          '```ts',
          'facets: {',
          '  inspect: ["facet"],',
          '}',
          '```',
          '',
        ].join('\n')
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { extensions: ['.md'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        [
          'trailhead prose should move.',
          'Inline `facet` should be reviewed.',
          '',
          '```ts',
          'facets: {',
          '  inspect: ["facet"],',
          '}',
          '```',
          '',
        ].join('\n')
      );
      expect(
        result.value?.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          reason: occurrence.reason,
          replacement: occurrence.replacement,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        {
          form: 'facet',
          reason: 'markdown-code-context',
          replacement: undefined,
          verdict: 'deferred',
        },
        {
          form: 'facets',
          reason: 'markdown-code-context',
          replacement: undefined,
          verdict: 'deferred',
        },
        {
          form: 'facet',
          reason: 'markdown-code-context',
          replacement: undefined,
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 1,
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        deferred: 3,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 3,
          status: 'open',
        },
        modified: 0,
        open: 3,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers multi-backtick and blockquoted markdown code contexts', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        [
          'Use ``facet`` as a literal.',
          '',
          '> ```ts',
          '> facet',
          '> ```',
          '',
        ].join('\n')
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { extensions: ['.md'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        [
          'Use ``facet`` as a literal.',
          '',
          '> ```ts',
          '> facet',
          '> ```',
          '',
        ].join('\n')
      );
      expect(
        result.value?.run?.ledger.occurrences.map((occurrence) => ({
          form: occurrence.form,
          reason: occurrence.reason,
          verdict: occurrence.verdict,
        }))
      ).toEqual([
        {
          form: 'facet',
          reason: 'markdown-code-context',
          verdict: 'deferred',
        },
        {
          form: 'facet',
          reason: 'markdown-code-context',
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.run?.report).toMatchObject({
        applied: 0,
        deferred: 2,
        gate: { status: 'open' },
        modified: 0,
        open: 2,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('scopes path discovery before judging occurrences', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/keep.ts', 'export const facet = "facet";\n');
      writeFile(dir, 'test/skip.ts', 'export const facet = "facet";\n');

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: { exclude: ['test/**'] },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.scanned).toBe(1);
      expect(result.value?.skipsByReason).toMatchObject({
        'ignored-glob': 1,
      });
      expect(result.value?.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        'src/keep.ts',
        'src/keep.ts',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('ignores path globs before reading vocabulary occurrences', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, '.agents/notes/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        '.agents/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );
      writeFile(dir, '.scratch/history.ts', 'export const facet = 1;\n');
      writeFile(
        dir,
        'plugin/skills/trails/SKILL.ts',
        'export const facet = 1;\n'
      );

      const result = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            exclude: ['.scratch/**', '.agents/notes/**'],
          },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        '.agents/skills/trails/SKILL.ts',
        'plugin/skills/trails/SKILL.ts',
      ]);
      expect(result.value?.skipsByReason).toMatchObject({
        'ignored-glob': 2,
      });
      expect(result.value?.scan).toEqual({
        byDirectory: [
          { files: 1, occurrences: 1, path: '.agents' },
          { files: 1, occurrences: 1, path: 'plugin' },
        ],
        byExtension: [{ extension: '.ts', files: 2, occurrences: 2 }],
        files: { matched: 2, scanned: 2, skipped: 2 },
        skippedByReason: { 'ignored-glob': 2 },
      });
      expect(result.value?.scanned).toBe(2);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('preserves legacy ignored-directory overrides during collection', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'dist/generated.md', 'facet in generated output\n');
      const plan = vocabularyRegradePlanSchema.parse({
        from: 'facet',
        kind: 'vocabulary',
        scope: { ignoredDirectories: [] },
        to: 'trailhead',
      });

      const result = runVocabularyRegrade({
        plan,
        root: dir,
      });

      expect(plan.scope?.ignoredDirectories).toEqual([]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.scanned).toBe(1);
      expect(result.value?.run?.ledger.occurrences.map((o) => o.path)).toEqual([
        'dist/generated.md',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('prefers longer override captures over overlapping defaults', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facet-like\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          overrides: { 'facet-like': 'trailhead-like' },
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'trailhead-like\n'
      );
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        gate: { status: 'green' },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers hyphenated neighbor forms unless explicitly overridden', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facet-like\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: { from: 'facet', kind: 'vocabulary', to: 'trailhead' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'facet-like\n'
      );
      expect(result.value?.run?.ledger.forms).toMatchObject({
        'facet-like': 'deferred',
      });
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        gate: { status: 'open' },
        modified: 0,
        open: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers dollar identifier neighbors instead of partial rewrites', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'const facet$Id = $facet;\nconst _facet = 1;\n'
      );

      const result = runVocabularyRegrade({
        apply: true,
        plan: { from: 'facet', kind: 'vocabulary', to: 'trailhead' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'const facet$Id = $facet;\nconst _facet = 1;\n'
      );
      expect(result.value?.run?.ledger.forms).toEqual({
        $facet: 'deferred',
        _facet: 'deferred',
        facet$Id: 'deferred',
      });
      expect(result.value?.run?.report).toMatchObject({
        deferred: 3,
        gate: { status: 'open' },
        modified: 0,
        open: 3,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('defers phrase neighbors instead of reporting green', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'export const label = "old termsId";\n');

      const result = runVocabularyRegrade({
        plan: { from: 'old term', kind: 'vocabulary', to: 'new term' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'export const label = "old termsId";\n'
      );
      expect(result.value?.run?.ledger.forms).toEqual({
        'old termsId': 'deferred',
      });
      expect(result.value?.run?.ledger.occurrences).toHaveLength(1);
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remaining: 1,
          status: 'open',
        },
        modified: 0,
        open: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lets preserve rules skip unclassified neighbor forms', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facetId\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: 'facetId', reason: 'intentional API name' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'facetId\n'
      );
      expect(result.value?.run?.ledger.forms).toMatchObject({
        facetId: 'skipped',
      });
      expect(result.value?.run?.report).toMatchObject({
        deferred: 0,
        gate: { status: 'green' },
        modified: 0,
        open: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps context-only preserve markers effective for captured forms', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'const facet = 1; // no-rewrite\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: 'no-rewrite', reason: 'operator marker' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'const facet = 1; // no-rewrite\n'
      );
      expect(result.value.run.ledger.occurrences).toMatchObject([
        {
          form: 'facet',
          reason: 'operator marker',
          verdict: 'skipped',
        },
      ]);
      expect(result.value.run.report).toMatchObject({
        modified: 0,
        open: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports form verdicts from observed occurrences only', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'legacy facet\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: 'legacy facet', reason: 'documented name' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.run?.ledger.forms).toEqual({
        facet: 'skipped',
      });
      expect(result.value?.run?.report).toMatchObject({
        modified: 0,
        open: 0,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps repeated neighbor occurrences reviewable after contextual preserve', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'legacy facetId\nactive facetId\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [
            { pattern: '^legacy facetId$', reason: 'legacy API name' },
          ],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'legacy facetId\nactive facetId\n'
      );
      expect(result.value?.run?.ledger.occurrences).toMatchObject([
        {
          disposition: 'explicit-preserve',
          form: 'facetId',
          reason: 'legacy API name',
          verdict: 'skipped',
        },
        {
          disposition: 'in-family-unresolved',
          form: 'facetId',
          reason: 'unclassified-neighbor',
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        dispositions: {
          'explicit-preserve': 1,
          'in-family-unresolved': 1,
        },
        gate: {
          reasons: ['deferred-forms-or-occurrences'],
          remainingByDisposition: { 'in-family-unresolved': 1 },
          status: 'open',
        },
        open: 1,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps post-apply source forms open when the target contains the source', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'const label = "API";\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: { from: 'API', kind: 'vocabulary', to: 'REST API' },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        'const label = "REST API";\n'
      );
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        gate: {
          reasons: ['source-forms-remain-after-apply'],
          status: 'open',
        },
        modified: 1,
        open: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps the compatibility apply summary file-oriented', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facetId facetName facetOther facet\n');

      const result = runVocabularyRegrade({
        apply: true,
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: '^facetName$', reason: 'public symbol' }],
          to: 'trailhead',
        },
        root: dir,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value?.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 1,
        skipped: 1,
      });
      expect(result.value?.run?.report).toMatchObject({
        applied: 1,
        deferred: 2,
        filesChanged: 1,
        modified: 0,
        open: 2,
        skipped: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects empty source, override, or preserve forms before scanning', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'src/surface.ts', 'facet\n');

      const emptySource = runVocabularyRegrade({
        plan: { from: '', kind: 'vocabulary', to: 'trailhead' },
        root: dir,
      });
      expect(emptySource.isErr()).toBe(true);
      if (emptySource.isErr()) {
        expect(emptySource.error.constructor.name).toBe('ValidationError');
      }

      const emptyOverride = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          overrides: { '': 'trailhead' },
          to: 'trailhead',
        },
        root: dir,
      });
      expect(emptyOverride.isErr()).toBe(true);
      if (emptyOverride.isErr()) {
        expect(emptyOverride.error.constructor.name).toBe('ValidationError');
      }

      const emptyPreserve = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ pattern: '' }],
          to: 'trailhead',
        },
        root: dir,
      });
      expect(emptyPreserve.isErr()).toBe(true);
      if (emptyPreserve.isErr()) {
        expect(emptyPreserve.error.constructor.name).toBe('ValidationError');
      }

      const invalidDisposition = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          preserve: [{ disposition: 'bogus', pattern: 'facet' }],
          to: 'trailhead',
        } as Parameters<typeof runVocabularyRegrade>[0]['plan'],
        root: dir,
      });
      expect(invalidDisposition.isErr()).toBe(true);
      if (invalidDisposition.isErr()) {
        expect(invalidDisposition.error.constructor.name).toBe(
          'ValidationError'
        );
        expect(invalidDisposition.error.message).toContain(
          'preserve disposition "bogus" is not supported'
        );
      }

      const invalidInventoryDisposition = runVocabularyRegrade({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          to: 'trailhead',
        },
        preserveInventory: [
          {
            disposition: 'bogus',
            evidence: ['derived proof'],
            pattern: 'facet',
            source: 'derived-live-api',
          },
        ] as Parameters<typeof runVocabularyRegrade>[0]['preserveInventory'],
        root: dir,
      });
      expect(invalidInventoryDisposition.isErr()).toBe(true);
      if (invalidInventoryDisposition.isErr()) {
        expect(invalidInventoryDisposition.error.constructor.name).toBe(
          'ValidationError'
        );
        expect(invalidInventoryDisposition.error.message).toContain(
          'preserve inventory disposition "bogus" is not supported'
        );
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
