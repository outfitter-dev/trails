import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectDownstreamSources } from '../collect.js';
import { runRegrade, wardenTermRewriteClasses } from '../report.js';

/**
 * Radio-shaped downstream regrade regression fixture (TRL-846).
 *
 * The committed fixture under `fixtures/radio-shaped/` is a synthetic source
 * tree shaped like the Radio app. Its source files carry a trailing `.txt`
 * guard so they stay invisible to this package's typecheck, lint, test
 * discovery, and Warden scan, and the build-output directory is committed as
 * `dist-guard/` because a literal `dist/` is gitignored repo-wide. Here we
 * materialize the tree into a temp directory with the real extensions and the
 * real `dist/` name, then run the regrade engine against it, locking the
 * downstream collection + coverage behavior without depending on the live
 * Radio checkout.
 */

const FIXTURE_ROOT = join(import.meta.dir, 'fixtures', 'radio-shaped');

/** Recursively strip the `.txt` guard from every materialized fixture file. */
const stripTxtGuards = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      stripTxtGuards(full);
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      renameSync(full, full.slice(0, -'.txt'.length));
    }
  }
};

/**
 * Copy the committed fixture into a temp dir and reveal real extensions.
 *
 * The temp dir lives under the OS temp root, not the package tree, so a
 * concurrent full-suite run never walks another test's scratch directory and
 * an interrupted run leaves nothing under `src/`.
 */
const materializeFixture = (): string => {
  // Copy into a fresh dest that does not yet exist, nested under a unique temp
  // parent. Copying into an already-created mkdtemp dir can merge a second copy
  // of the tree under a concurrent full-suite run; a non-existing dest makes
  // the copy unambiguous and the walk deterministic.
  const parent = mkdtempSync(join(tmpdir(), 'regrade-radio-'));
  const root = join(parent, 'fixture');
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  stripTxtGuards(root);
  // Reveal the build-output directory's real name. `dist/` is gitignored
  // repo-wide, so the fixture commits it as `dist-guard/`; without this rename a
  // fresh CI checkout would lack any `dist/` and the ignored-directory skip
  // would go unexercised (the failure mode this guard exists to prevent).
  renameSync(join(root, 'dist-guard'), join(root, 'dist'));
  return root;
};

describe('Radio-shaped downstream fixture (TRL-846)', () => {
  const crossToComposeClassId = 'term-rewrite:no-retired-cross-vocabulary';

  test('collects only in-scope source files and records skips', () => {
    const root = materializeFixture();
    try {
      const collection = collectDownstreamSources(root);
      expect(collection).not.toBeNull();
      const result = collection as NonNullable<typeof collection>;

      expect(result.files.map((file) => file.path)).toEqual([
        'src/components/now-playing.tsx',
        'src/signals/track.ts',
        'src/trails/play.ts',
      ]);

      const skippedReasons = new Map(
        result.skipped.map((entry) => [entry.path, entry.reason])
      );
      expect(skippedReasons.get('dist')).toBe('ignored-directory');
      expect(skippedReasons.get('README.md')).toBe('unsupported-extension');
      // The dist/ bundle is never scanned, so its `signal` is invisible.
      expect(result.files.some((file) => file.path.startsWith('dist/'))).toBe(
        false
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('regrade coverage over the fixture is deterministic', () => {
    const root = materializeFixture();
    try {
      const result = runRegrade({
        classes: wardenTermRewriteClasses,
        root,
        selection: { classIds: [crossToComposeClassId] },
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      const report = result.value;
      expect(report).not.toBeNull();
      const r = report as NonNullable<typeof report>;

      expect(r.selectedClassIds).toEqual([crossToComposeClassId]);
      expect(r.unknownClassIds).toEqual([]);
      expect(r.scanned).toBe(3);
      expect(r.rewritten).toBe(1);
      expect(r.review).toBe(1);
      expect(r.matched).toBe(2);

      const byPath = new Map(r.entries.map((entry) => [entry.path, entry]));
      expect(byPath.get('src/signals/track.ts')?.outcome).toBe('rewrite');
      expect(byPath.get('src/trails/play.ts')?.outcome).toBe('needs-review');
      expect(byPath.get('src/trails/play.ts')?.reason).toBe(
        'warden-review-required'
      );
      expect(byPath.get('src/components/now-playing.tsx')?.outcome).toBe(
        'no-op'
      );
      expect(byPath.get('dist')?.outcome).toBe('skip');
      expect(byPath.get('README.md')?.outcome).toBe('skip');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
