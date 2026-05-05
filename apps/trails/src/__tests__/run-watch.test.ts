import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SurfaceMapEntry } from '@ontrails/topographer';

import {
  WATCH_DEBOUNCE_MS,
  WATCH_WARMUP_MS,
  argvHasWatchFlag,
  createTrailWatcher,
  hashSurfaceMapEntry,
  readRunTrailId,
} from '../run-watch.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Settle delay between watcher install and triggering test changes.
 *
 * Slightly longer than `WATCH_WARMUP_MS` so the watcher's warmup window
 * has fully expired before the test write fires. Keeps the rerun counter
 * deterministic across the FSEvents phantom-event behavior on macOS.
 */
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
  readonly otherDir: string;
  readonly cleanup: () => void;
}

const setupFixture = (): TestFixture => {
  const root = mkdtempSync(join(tmpdir(), 'run-watch-'));
  const watchedDir = join(root, 'watched');
  const otherDir = join(root, 'other');
  mkdirSync(watchedDir, { recursive: true });
  mkdirSync(otherDir, { recursive: true });
  // Seed an initial trail file in the watched dir so resolved paths exist.
  writeFileSync(join(watchedDir, 'trail.ts'), 'export const v = 1;\n');
  return {
    cleanup: () => {
      rmSync(root, { force: true, recursive: true });
    },
    otherDir,
    watchedDir,
  };
};

// ---------------------------------------------------------------------------
// Argv detection
// ---------------------------------------------------------------------------

describe('argvHasWatchFlag', () => {
  test('returns true when --watch is present', () => {
    expect(argvHasWatchFlag(['node', 'trails', 'run', 'foo', '--watch'])).toBe(
      true
    );
  });

  test('returns false when --watch is absent', () => {
    expect(argvHasWatchFlag(['node', 'trails', 'run', 'foo'])).toBe(false);
  });

  test('does not match arbitrary substrings', () => {
    expect(
      argvHasWatchFlag(['node', 'trails', 'run', '--watch-something'])
    ).toBe(false);
  });
});

describe('readRunTrailId', () => {
  test('reads the direct run trail id', () => {
    expect(readRunTrailId(['run', 'entity.show', '--watch'])).toBe(
      'entity.show'
    );
  });

  test('skips short output and quiet flags before the trail id', () => {
    expect(readRunTrailId(['run', '-o', 'json', '-q', 'entity.show'])).toBe(
      'entity.show'
    );
  });

  test('skips compact short output flag before the trail id', () => {
    expect(readRunTrailId(['run', '-ojson', 'entity.show'])).toBe(
      'entity.show'
    );
  });

  test('reads the trail id from run example invocations with flags', () => {
    expect(
      readRunTrailId(['run', '-o', 'json', 'example', 'entity.show', 'happy'])
    ).toBe('entity.show');
  });
});

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

describe('createTrailWatcher', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('exposes the debounce window', () => {
    expect(WATCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(50);
    expect(WATCH_DEBOUNCE_MS).toBeLessThanOrEqual(200);
  });

  test('hashes a surface-map entry deterministically', () => {
    const entry: SurfaceMapEntry = {
      exampleCount: 0,
      id: 'entity.show',
      input: { type: 'object' },
      intent: 'read',
      kind: 'trail',
      output: { type: 'object' },
      surfaces: ['cli'],
    } as const;

    expect(hashSurfaceMapEntry(entry)).toBe(hashSurfaceMapEntry(entry));
    expect(hashSurfaceMapEntry({ ...entry, intent: 'write' })).not.toBe(
      hashSurfaceMapEntry(entry)
    );
  });

  test('triggers a rerun when the watched surface-map entry changes', async () => {
    const reruns: number[] = [];
    let surfaceHash = 'contract:v1';
    const watcher = createTrailWatcher({
      initialSurfaceHash: surfaceHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => surfaceHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      surfaceHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 2;\n'
      );

      await waitFor(() => reruns.length >= 1, WATCH_DEBOUNCE_MS + 1000);

      expect(reruns.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  test('does not rerun for comment-only edits with the same surface hash', async () => {
    const reruns: number[] = [];
    const watcher = createTrailWatcher({
      initialSurfaceHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        '// comment-only edit\nexport const v = 1;\n'
      );

      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);

      expect(reruns.length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test('does not rerun for sibling source edits when the watched contract is unchanged', async () => {
    const reruns: number[] = [];
    const watcher = createTrailWatcher({
      initialSurfaceHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(
        join(fixture.watchedDir, 'sibling.ts'),
        'export const typo = "fixed";\n'
      );

      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);

      expect(reruns.length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test('does not rerun for non .ts/.js files', async () => {
    const reruns: number[] = [];
    const watcher = createTrailWatcher({
      initialSurfaceHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(join(fixture.watchedDir, 'notes.md'), '# notes\n');

      // Wait beyond the debounce window plus margin.
      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);

      expect(reruns.length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test('does not rerun for changes in unrelated directories', async () => {
    const reruns: number[] = [];
    const watcher = createTrailWatcher({
      initialSurfaceHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(
        join(fixture.otherDir, 'unrelated.ts'),
        'export const u = 1;\n'
      );

      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);

      expect(reruns.length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test('debounces rapid changes into a single rerun', async () => {
    const reruns: number[] = [];
    let surfaceHash = 'contract:v1';
    const watcher = createTrailWatcher({
      initialSurfaceHash: surfaceHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => surfaceHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      // Burst of writes within the debounce window.
      for (let i = 0; i < 5; i += 1) {
        surfaceHash = `contract:v${i + 2}`;
        writeFileSync(
          join(fixture.watchedDir, 'trail.ts'),
          `export const v = ${i};\n`
        );
      }

      await waitFor(() => reruns.length >= 1, WATCH_DEBOUNCE_MS + 1000);

      // Allow any extra debounced firings to settle, then assert just one.
      await Bun.sleep(WATCH_DEBOUNCE_MS + 100);
      expect(reruns.length).toBe(1);
    } finally {
      watcher.close();
    }
  });

  test('skips invalid surface states and resumes on the next valid contract change', async () => {
    const reruns: number[] = [];
    let mode: 'invalid' | 'valid' = 'invalid';
    let surfaceHash = 'contract:v1';
    const watcher = createTrailWatcher({
      initialSurfaceHash: surfaceHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => {
        if (mode === 'invalid') {
          throw new Error('schema invalid');
        }
        return surfaceHash;
      },
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const broken = ;\n'
      );
      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);
      expect(reruns.length).toBe(0);

      mode = 'valid';
      surfaceHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const fixed = 1;\n'
      );
      await waitFor(() => reruns.length >= 1, WATCH_DEBOUNCE_MS + 1000);
      expect(reruns.length).toBe(1);
    } finally {
      watcher.close();
    }
  });

  test('holds when the watched trail is removed and reruns once it returns changed', async () => {
    const reruns: number[] = [];
    let surfaceHash: string | null = null;
    const watcher = createTrailWatcher({
      initialSurfaceHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => surfaceHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(join(fixture.watchedDir, 'trail.ts'), 'export {};\n');
      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);
      expect(reruns.length).toBe(0);

      surfaceHash = 'contract:v2';
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const restored = 1;\n'
      );
      await waitFor(() => reruns.length >= 1, WATCH_DEBOUNCE_MS + 1000);
      expect(reruns.length).toBe(1);
    } finally {
      watcher.close();
    }
  });

  test('close() stops further reruns', async () => {
    const reruns: number[] = [];
    const watcher = createTrailWatcher({
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    watcher.close();

    writeFileSync(
      join(fixture.watchedDir, 'trail.ts'),
      'export const v = 99;\n'
    );

    await Bun.sleep(WATCH_DEBOUNCE_MS + 200);

    expect(reruns.length).toBe(0);
  });

  test('close() suppresses rerun when surface hash read is already in flight', async () => {
    const reruns: number[] = [];
    const hashRead = Promise.withResolvers<string>();
    let readStarted = false;
    const watcher = createTrailWatcher({
      debounceMs: 10,
      initialSurfaceHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readSurfaceHash: () => {
        readStarted = true;
        return hashRead.promise;
      },
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
      warmupMs: 0,
    });

    try {
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const v = 100;\n'
      );
      await waitFor(() => readStarted, WATCH_DEBOUNCE_MS + 1000);

      watcher.close();
      hashRead.resolve('contract:v2');

      await Bun.sleep(WATCH_DEBOUNCE_MS + 100);
      expect(reruns.length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test('close() is idempotent', () => {
    const watcher = createTrailWatcher({
      onRerun: () => {
        // no-op
      },
      readSurfaceHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    watcher.close();
    expect(() => {
      watcher.close();
    }).not.toThrow();
  });
});
