import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, resource, signal, topo, trail } from '@ontrails/core';
import type { Layer, Topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraphEntry } from '@ontrails/topographer';
import { z } from 'zod';

import {
  WATCH_DEBOUNCE_MS,
  WATCH_WARMUP_MS,
  argvHasWatchFlag,
  createTrailWatcher,
  hashTopoGraphEntry,
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

const noopBlaze = () => Result.ok({ ok: true });

const passThroughLayer = (name: string, input?: Layer['input']): Layer => ({
  ...(input === undefined ? {} : { input }),
  name,
  wrap: (_trail, implementation) => implementation,
});

interface WatchedAppOptions {
  readonly crosses?: boolean | undefined;
  readonly examples?:
    | readonly [
        {
          readonly expected: { readonly ok: true };
          readonly input: Record<string, unknown>;
          readonly name: string;
        },
      ]
    | undefined;
  readonly fires?: boolean | undefined;
  readonly helperInput?: z.ZodType | undefined;
  readonly input?: z.ZodType | undefined;
  readonly intent?: 'destroy' | 'read' | 'write' | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly output?: z.ZodType | undefined;
  readonly resources?: boolean | undefined;
}

const buildWatchedApp = (options: WatchedAppOptions = {}): Topo => {
  const auditResource = resource('audit.log', {
    create: () => Result.ok({ write: () => null }),
  });
  const changed = signal('entity.changed', {
    payload: z.object({ id: z.string() }),
  });
  const helper = trail('entity.helper', {
    blaze: noopBlaze,
    input: options.helperInput ?? z.object({}),
    output: z.object({ ok: z.boolean() }),
  });
  const watched = trail('entity.watch', {
    blaze: noopBlaze,
    ...(options.crosses === true ? { crosses: ['entity.helper'] } : {}),
    ...(options.examples === undefined ? {} : { examples: options.examples }),
    ...(options.fires === true ? { fires: ['entity.changed'] } : {}),
    input: options.input ?? z.object({ id: z.string() }),
    ...(options.intent === undefined ? {} : { intent: options.intent }),
    ...(options.layers === undefined ? {} : { layers: options.layers }),
    output: options.output ?? z.object({ ok: z.boolean() }),
    ...(options.resources === true ? { resources: [auditResource] } : {}),
  });

  return topo('watch-contract-app', {
    auditResource,
    changed,
    helper,
    watched,
  });
};

const watchedEntry = (app: Topo): TopoGraphEntry => {
  const entry = deriveTopoGraph(app).entries.find(
    (candidate) => candidate.kind === 'trail' && candidate.id === 'entity.watch'
  );
  if (entry === undefined) {
    throw new Error('Expected watched trail entry');
  }
  return entry;
};

const watchedEntryHash = (app: Topo): string =>
  hashTopoGraphEntry(watchedEntry(app));

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

  test('hashes a TopoGraph entry deterministically', () => {
    const entry: TopoGraphEntry = {
      exampleCount: 0,
      id: 'entity.show',
      input: { type: 'object' },
      intent: 'read',
      kind: 'trail',
      output: { type: 'object' },
      surfaces: ['cli'],
    } as const;

    expect(hashTopoGraphEntry(entry)).toBe(hashTopoGraphEntry(entry));
    expect(hashTopoGraphEntry({ ...entry, intent: 'write' })).not.toBe(
      hashTopoGraphEntry(entry)
    );
  });

  test('derived watched entry hash changes for resolved contract fields', () => {
    const baseline = watchedEntryHash(buildWatchedApp());
    const cases = [
      {
        app: buildWatchedApp({
          input: z.object({ id: z.string(), verbose: z.boolean() }),
        }),
        name: 'input schema',
      },
      {
        app: buildWatchedApp({
          output: z.object({ id: z.string(), ok: z.boolean() }),
        }),
        name: 'output schema',
      },
      {
        app: buildWatchedApp({
          examples: [
            {
              expected: { ok: true },
              input: { id: 'entity-1' },
              name: 'happy path',
            },
          ],
        }),
        name: 'examples',
      },
      {
        app: buildWatchedApp({ intent: 'read' }),
        name: 'intent',
      },
      {
        app: buildWatchedApp({ resources: true }),
        name: 'resources',
      },
      {
        app: buildWatchedApp({ fires: true }),
        name: 'signals',
      },
      {
        app: buildWatchedApp({ crosses: true }),
        name: 'crosses',
      },
      {
        app: buildWatchedApp({
          layers: [passThroughLayer('audit', z.object({ token: z.string() }))],
        }),
        name: 'layers',
      },
    ];

    for (const { app, name } of cases) {
      expect(watchedEntryHash(app), name).not.toBe(baseline);
    }
  });

  test('derived watched entry hash ignores sibling trail contract changes', () => {
    const baseline = watchedEntryHash(buildWatchedApp({ crosses: true }));
    const changedSibling = watchedEntryHash(
      buildWatchedApp({
        crosses: true,
        helperInput: z.object({ changed: z.boolean() }),
      })
    );

    expect(changedSibling).toBe(baseline);
  });

  test('triggers a rerun when the watched TopoGraph entry changes', async () => {
    const reruns: number[] = [];
    let topoGraphEntryHash = 'contract:v1';
    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
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

      await waitFor(() => reruns.length >= 1, WATCH_DEBOUNCE_MS + 1000);

      expect(reruns.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  test('triggers exactly one rerun for a derived contract hash change', async () => {
    const reruns: number[] = [];
    let topoGraphEntryHash = watchedEntryHash(buildWatchedApp());
    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      topoGraphEntryHash = watchedEntryHash(
        buildWatchedApp({
          input: z.object({ id: z.string(), verbose: z.boolean() }),
        })
      );
      writeFileSync(
        join(fixture.watchedDir, 'trail.ts'),
        'export const inputChanged = true;\n'
      );

      await waitFor(() => reruns.length >= 1, WATCH_DEBOUNCE_MS + 1000);
      await Bun.sleep(WATCH_DEBOUNCE_MS + 100);

      expect(reruns).toHaveLength(1);
    } finally {
      watcher.close();
    }
  });

  test('does not rerun for comment-only edits with the same topo graph entry hash', async () => {
    const reruns: number[] = [];
    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => 'contract:v1',
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
      initialTopoGraphEntryHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => 'contract:v1',
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
      initialTopoGraphEntryHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => 'contract:v1',
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
      initialTopoGraphEntryHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => 'contract:v1',
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
    let topoGraphEntryHash = 'contract:v1';
    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      // Burst of writes within the debounce window.
      for (let i = 0; i < 5; i += 1) {
        topoGraphEntryHash = `contract:v${i + 2}`;
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

  test('skips invalid TopoGraph states and resumes on the next valid contract change', async () => {
    const reruns: number[] = [];
    let mode: 'invalid' | 'valid' = 'invalid';
    let topoGraphEntryHash = 'contract:v1';
    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: topoGraphEntryHash,
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => {
        if (mode === 'invalid') {
          throw new Error('schema invalid');
        }
        return topoGraphEntryHash;
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
      topoGraphEntryHash = 'contract:v2';
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
    let topoGraphEntryHash: string | null = null;
    const watcher = createTrailWatcher({
      initialTopoGraphEntryHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => topoGraphEntryHash,
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    try {
      await Bun.sleep(WATCHER_SETTLE_MS);
      writeFileSync(join(fixture.watchedDir, 'trail.ts'), 'export {};\n');
      await Bun.sleep(WATCH_DEBOUNCE_MS + 200);
      expect(reruns.length).toBe(0);

      topoGraphEntryHash = 'contract:v2';
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
      readTopoGraphEntryHash: () => 'contract:v1',
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

  test('close() suppresses rerun when topo graph entry hash read is already in flight', async () => {
    const reruns: number[] = [];
    const hashRead = Promise.withResolvers<string>();
    let readStarted = false;
    const watcher = createTrailWatcher({
      debounceMs: 10,
      initialTopoGraphEntryHash: 'contract:v1',
      onRerun: () => {
        reruns.push(Date.now());
      },
      readTopoGraphEntryHash: () => {
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
      readTopoGraphEntryHash: () => 'contract:v1',
      sourcePath: join(fixture.watchedDir, 'trail.ts'),
    });

    watcher.close();
    expect(() => {
      watcher.close();
    }).not.toThrow();
  });
});
