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

import { runVocabularyRegrade } from '../vocabulary.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), `trails-vocabulary-regrade-${Date.now()}-`));

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

describe('runVocabularyRegrade', () => {
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
        'excluded-by-regrade-scope': 1,
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
            ignore: ['.scratch/**', '.agents/notes/**'],
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
      expect(result.value?.scanned).toBe(2);
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
        { form: 'facetId', reason: 'legacy API name', verdict: 'skipped' },
        {
          form: 'facetId',
          reason: 'unclassified-neighbor',
          verdict: 'deferred',
        },
      ]);
      expect(result.value?.run?.report).toMatchObject({
        deferred: 1,
        gate: { reasons: ['deferred-forms-or-occurrences'], status: 'open' },
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
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
