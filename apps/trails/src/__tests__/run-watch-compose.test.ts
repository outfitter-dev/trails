/**
 * Composition tests for `run example --watch` and `--watch + --trace`.
 *
 * These are unit-level tests against {@link runWatchLoop} and
 * {@link createTrailWatcher}: they drive the watcher via real filesystem
 * writes and stub the surface call so we can observe the per-rerun
 * behavior without spawning a subprocess.
 *
 * The compositions covered here are intentionally narrow:
 *
 * - `run example --watch`: each rerun runs the example helper afresh, so
 *   the comparison envelope reflects the current trail source. Flipping
 *   match -> mismatch is observable as a change in the captured output.
 * - `--watch + --trace`: each rerun gets a fresh trace session — records
 *   from a previous rerun do not bleed into the next sink.
 * - Error recovery: a rerun whose `run` callback throws does not tear
 *   down the watcher; a subsequent file change still triggers another
 *   rerun.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, executeTrail, trail } from '@ontrails/core';
import { z } from 'zod';

import { installTraceSink } from '../run-trace.js';
import {
  WATCH_DEBOUNCE_MS,
  WATCH_WARMUP_MS,
  createTrailWatcher,
  runWatchLoop,
} from '../run-watch.js';

// ---------------------------------------------------------------------------
// Stub trail used to drive executeTrail in the trace composition test.
// ---------------------------------------------------------------------------

const greetTrail = trail('greet', {
  description: 'simple trail used to drive executeTrail and emit a record',
  implementation: ({ name }: { name: string }) =>
    Result.ok({ greeting: `hi ${name}` }),
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WATCHER_SETTLE_MS = WATCH_WARMUP_MS + 50;

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(20);
  }
};

interface TestFixture {
  readonly watchedDir: string;
  readonly cleanup: () => void;
}

const setupFixture = (): TestFixture => {
  const root = mkdtempSync(join(tmpdir(), 'run-watch-compose-'));
  const watchedDir = join(root, 'watched');
  mkdirSync(watchedDir, { recursive: true });
  writeFileSync(join(watchedDir, 'trail.ts'), 'export const v = 1;\n');
  return {
    cleanup: () => {
      rmSync(root, { force: true, recursive: true });
    },
    watchedDir,
  };
};

// ---------------------------------------------------------------------------
// run example --watch
// ---------------------------------------------------------------------------

describe('runWatchLoop with run.example', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('rebuilds the comparison envelope on each rerun', async () => {
    // Simulate the `run.example` trail's behavior: the trail
    // returns a fresh comparison envelope per invocation. We model the
    // implementation flipping from a passing example to a failing one
    // by mutating a flag the stub reads each rerun.
    let nextMatch = true;
    let topoGraphEntryHash = 'contract:v1';
    const envelopes: { readonly match: boolean }[] = [];

    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: () => {
        // Imagine the run trail produces a fresh comparison envelope
        // each invocation. The `run example --watch` contract is that
        // each rerun observes the current source state, so flipping
        // `nextMatch` between writes simulates an edit that breaks
        // the example.
        envelopes.push({ match: nextMatch });
      },
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);

      // First edit: example matches.
      topoGraphEntryHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 2;\n'
      );
      await waitFor(() => envelopes.length >= 1, WATCH_DEBOUNCE_MS + 1000);

      // Second edit: implementation drifts, example mismatches.
      nextMatch = false;
      topoGraphEntryHash = 'contract:v3';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 3;\n'
      );
      await waitFor(() => envelopes.length >= 2, WATCH_DEBOUNCE_MS + 1000);

      expect(envelopes.length).toBeGreaterThanOrEqual(2);
      const [first, second] = envelopes;
      expect(first?.match).toBe(true);
      expect(second?.match).toBe(false);
    } finally {
      watcher.close();
    }
  });
});

// ---------------------------------------------------------------------------
// --watch + --trace
// ---------------------------------------------------------------------------

describe('runWatchLoop with --trace', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('each rerun gets a fresh trace sink (records do not bleed)', async () => {
    let topoGraphEntryHash = 'contract:v1';
    const recordCounts: number[] = [];

    // Simulate `runSurfaceOnce` under `--trace`: each invocation installs
    // its own session, executes work, and finalizes. The watch loop
    // composes by invoking this per rerun, so records from a previous
    // rerun must never appear in the next session.
    const performRun = async (): Promise<void> => {
      const session = installTraceSink();
      try {
        await executeTrail(greetTrail, { name: 'compose' });
      } finally {
        const records = session.finalize();
        recordCounts.push(records.length);
      }
    };

    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: performRun,
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);

      topoGraphEntryHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 2;\n'
      );
      await waitFor(() => recordCounts.length >= 1, WATCH_DEBOUNCE_MS + 1000);

      topoGraphEntryHash = 'contract:v3';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 3;\n'
      );
      await waitFor(() => recordCounts.length >= 2, WATCH_DEBOUNCE_MS + 1000);

      expect(recordCounts.length).toBeGreaterThanOrEqual(2);
      const [first, second] = recordCounts;
      expect(first).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(0);
      // If sessions bled into one another, the second count would be
      // strictly greater than the first (records would accumulate).
      // A fresh sink per rerun produces equal counts for the same trail.
      expect(second).toBe(first ?? 0);
    } finally {
      watcher.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

describe('runWatchLoop error recovery', () => {
  let fixture: TestFixture;
  let originalStderrWrite: typeof process.stderr.write;
  let stderrChunks: string[];

  beforeEach(() => {
    fixture = setupFixture();
    stderrChunks = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    fixture.cleanup();
  });

  test('a thrown rerun does not exit the watch loop; subsequent saves still trigger reruns', async () => {
    let runs = 0;
    let topoGraphEntryHash = 'contract:v1';
    let throwOnNextRun = false;

    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: () => {
        runs += 1;
        if (throwOnNextRun) {
          throwOnNextRun = false;
          throw new Error('synthetic syntax error');
        }
      },
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);

      // First save: rerun throws.
      throwOnNextRun = true;
      topoGraphEntryHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 2;\n'
      );
      await waitFor(() => runs >= 1, WATCH_DEBOUNCE_MS + 1000);

      // Watcher must still be live: a second save triggers another rerun.
      topoGraphEntryHash = 'contract:v3';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 3;\n'
      );
      await waitFor(() => runs >= 2, WATCH_DEBOUNCE_MS + 1000);

      expect(runs).toBeGreaterThanOrEqual(2);
      // The synthetic error was reported on stderr.
      const stderrText = stderrChunks.join('');
      expect(stderrText).toContain('synthetic syntax error');
    } finally {
      watcher.close();
    }
  });

  test('runWatchLoop continues across a thrown run() and exits cleanly on SIGINT', async () => {
    let runs = 0;
    let topoGraphEntryHash = 'contract:v1';
    let throwOnNextRun = false;

    const loopPromise = runWatchLoop({
      clearScreen: false,
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      run: async () => {
        runs += 1;
        if (throwOnNextRun) {
          throwOnNextRun = false;
          throw new Error('synthetic run failure');
        }
        await Promise.resolve();
      },
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      // Wait for the initial run to complete.
      await waitFor(() => runs >= 1, 1000);

      await Bun.sleep(WATCHER_SETTLE_MS);

      // First save throws.
      throwOnNextRun = true;
      topoGraphEntryHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 2;\n'
      );
      await waitFor(() => runs >= 2, WATCH_DEBOUNCE_MS + 1000);

      // Second save: loop is still alive, rerun succeeds.
      topoGraphEntryHash = 'contract:v3';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 3;\n'
      );
      await waitFor(() => runs >= 3, WATCH_DEBOUNCE_MS + 1000);

      expect(runs).toBeGreaterThanOrEqual(3);
    } finally {
      // SIGINT cleanly tears down the loop.
      process.emit('SIGINT');
      const exitCode = await loopPromise;
      expect(exitCode).toBe(0);
    }
  });
});
