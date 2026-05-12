/**
 * CLI-surface bridge for the `--watch` flag (`trails run --watch`).
 *
 * `--watch` is a local-development ergonomics affordance for `trails run`.
 * After the first invocation completes, the CLI installs a filesystem
 * watcher as a cheap event source. On each debounced event, the watcher
 * re-derives the watched trail's resolved-contract hash from its TopoGraph
 * entry and invokes the supplied `onRerun` callback only when that hash
 * changes. The loop runs until the user sends `SIGINT`.
 *
 * Design notes:
 *
 * - **Scope.** Watching is intentionally narrow. Filesystem events only wake
 *   the loop; the rerun decision is the watched trail's TopoGraph entry.
 *   Comments, whitespace, and unrelated sibling trail changes wake the loop
 *   but do not rerun unless the resolved contract changes.
 * - **Debounce.** Editor saves often produce multiple `fs.watch` events
 *   per logical change (write tmp, rename, touch mtime). The debounce
 *   coalesces these into a single rerun and dampens AFS / iCloud sync
 *   bursts.
 * - **No external deps.** Uses `node:fs.watch` (re-exported by Bun) so
 *   we avoid pulling in `chokidar` or similar.
 */

import { once } from 'node:events';
import { watch as nodeWatch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { dirname, extname } from 'node:path';

import type { TopoGraphEntry } from '@ontrails/topographer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Debounce window (ms) for coalescing rapid filesystem events into a single
 * rerun. Sized small enough to feel instantaneous but large enough to
 * absorb editor save bursts and sync-driven duplicate notifications.
 */
export const WATCH_DEBOUNCE_MS = 100;

/**
 * Warmup window (ms) after the watcher is created during which incoming
 * events are ignored.
 *
 * On macOS, `fs.watch` (FSEvents) routinely emits a phantom `rename`
 * event for files that already existed in the watched directory shortly
 * after the watcher is installed. Ignoring events within this short
 * warmup prevents a spurious rerun on the first invocation without
 * meaningfully delaying real edits.
 *
 * Applied uniformly across platforms — the cost is negligible (no human
 * saves within ~150ms of starting `trails run --watch`), and a
 * platform-specific branch isn't worth the complexity.
 */
export const WATCH_WARMUP_MS = 150;

/** Extensions considered relevant to a trail rerun. */
const WATCHED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
]);

const ANSI_CLEAR_SCREEN = '\u001B[2J\u001B[H';

const WATCH_SCHEMA_INVALID_MESSAGE =
  '[watch] schema invalid; skipping rerun until valid\n';
const WATCH_TRAIL_REMOVED_MESSAGE = '[watch] trail removed; awaiting return\n';

// ---------------------------------------------------------------------------
// Argv detection
// ---------------------------------------------------------------------------

/**
 * Detect whether `--watch` appears in argv.
 *
 * Pre-parsed argv detection lets the CLI install the watcher loop before
 * `surface()` parses argv. The flag is also wired through the build
 * pipeline as a meta flag, so trail input is unaffected.
 */
export const argvHasWatchFlag = (argv: readonly string[]): boolean =>
  argv.includes('--watch');

const RUN_FLAGS_WITH_VALUES: ReadonlySet<string> = new Set([
  '--app',
  '--input',
  '--input-json',
  '--module',
  '--output',
  '--root-dir',
  '--token',
  '--permit',
]);

const RUN_SHORT_FLAGS_WITH_VALUES: ReadonlySet<string> = new Set(['-o']);

/**
 * Read the target trail id from a `trails run ...` argv slice.
 *
 * Accepts args after the binary name (for example
 * `['run', '-o', 'json', 'trail.id', '--watch']`). The parser is intentionally
 * small and conservative: it skips known CLI meta flags and their values so the
 * watch loop resolves the same trail the run command will execute.
 */
export const readRunTrailId = (args: readonly string[]): string | undefined => {
  const runIndex = args.indexOf('run');
  if (runIndex === -1) {
    return undefined;
  }
  const positionals: string[] = [];
  for (let i = runIndex + 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && RUN_FLAGS_WITH_VALUES.has(arg)) {
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('-')) {
      if (RUN_SHORT_FLAGS_WITH_VALUES.has(arg)) {
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  const [first, second] = positionals;
  if (first === 'examples' || first === 'example') {
    return second;
  }
  return first;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isRelevantFilename = (filename: string | null): boolean => {
  if (filename === null || filename.length === 0) {
    return false;
  }
  return WATCHED_EXTENSIONS.has(extname(filename));
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

export const hashTopoGraphEntry = (entry: TopoGraphEntry): string => {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(JSON.stringify(canonicalize(entry)));
  return hasher.digest('hex');
};

export type ReadTopoGraphEntryHash = () =>
  | Promise<string | null>
  | string
  | null;

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/** Options for {@link createTrailWatcher}. */
export interface CreateTrailWatcherOptions {
  /**
   * Absolute path to the resolved trail's source file. The watcher targets
   * the directory containing this file (non-recursive) and filters events
   * to relevant extensions only.
   */
  readonly sourcePath: string;
  /**
   * Invoked once per debounced change burst. Errors thrown by the callback
   * are caught and reported to stderr so a misbehaving handler does not
   * tear down the watcher loop.
   */
  readonly onRerun: () => void | Promise<void>;
  /**
   * Derive the watched trail's current resolved-contract hash. Return `null`
   * when the watched trail is temporarily absent. Throw when the current
   * source state cannot produce a valid TopoGraph.
   */
  readonly readTopoGraphEntryHash: ReadTopoGraphEntryHash;
  /**
   * Last known good resolved-contract hash captured after the initial run.
   * When omitted, the next valid changed hash becomes the first rerun signal.
   */
  readonly initialTopoGraphEntryHash?: string | null | undefined;
  /**
   * Override for the debounce window. Primarily a test seam; production
   * callers should rely on {@link WATCH_DEBOUNCE_MS}.
   */
  readonly debounceMs?: number | undefined;
  /**
   * Override for the warmup window. Primarily a test seam; production
   * callers should rely on {@link WATCH_WARMUP_MS}.
   */
  readonly warmupMs?: number | undefined;
}

/** Handle returned by {@link createTrailWatcher}. */
export interface TrailWatcher {
  /**
   * Stop the watcher and clear any pending debounce timer. Idempotent —
   * subsequent calls are no-ops.
   */
  readonly close: () => void;
}

/**
 * Create a filesystem watcher that triggers `onRerun` whenever a relevant
 * filesystem event changes the watched trail's resolved contract.
 *
 * The watcher targets the directory of `sourcePath` (non-recursive). Events
 * are filtered to TypeScript/JavaScript file extensions and coalesced through
 * a short debounce window. Each debounced event re-reads the watched trail's
 * TopoGraph entry hash; only a hash change reruns the trail.
 *
 * @remarks Reruns are not serialized. If a save lands while a previous
 * rerun is still awaiting `onRerun`, the new debounce window can fire
 * concurrently. In practice the {@link WATCH_DEBOUNCE_MS} window plus
 * realistic save cadences make this uncommon, and each `surface()` call
 * from the loop is independent. Callers that share mutable surface
 * state (e.g. a global trace sink) must scope it per invocation —
 * `runSurfaceOnce` in `apps/trails/src/cli.ts` does this for `--trace`.
 */
export const createTrailWatcher = (
  options: CreateTrailWatcherOptions
): TrailWatcher => {
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const warmupMs = options.warmupMs ?? WATCH_WARMUP_MS;
  const watchDir = dirname(options.sourcePath);
  const startedAt = Date.now();

  let closed = false;
  let currentTopoGraphEntryHash = options.initialTopoGraphEntryHash ?? null;
  let invalidTopoGraphWarned = false;
  let trailRemovedWarned = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;

  const readNextTopoGraphEntryHash = async (): Promise<
    string | null | undefined
  > => {
    try {
      const nextHash = await options.readTopoGraphEntryHash();
      invalidTopoGraphWarned = false;
      if (nextHash !== null) {
        trailRemovedWarned = false;
      } else if (!trailRemovedWarned) {
        process.stderr.write(WATCH_TRAIL_REMOVED_MESSAGE);
        trailRemovedWarned = true;
      }
      return nextHash;
    } catch {
      if (!invalidTopoGraphWarned) {
        process.stderr.write(WATCH_SCHEMA_INVALID_MESSAGE);
        invalidTopoGraphWarned = true;
      }
      return undefined;
    }
  };

  const fireRerun = async (): Promise<void> => {
    pending = undefined;
    if (closed) {
      return;
    }
    const nextHash = await readNextTopoGraphEntryHash();
    if (closed) {
      return;
    }
    if (nextHash === undefined || nextHash === null) {
      return;
    }
    if (nextHash === currentTopoGraphEntryHash) {
      return;
    }
    currentTopoGraphEntryHash = nextHash;
    try {
      await options.onRerun();
    } catch (error: unknown) {
      process.stderr.write(`watch: rerun failed: ${formatError(error)}\n`);
    }
  };

  const scheduleRerun = (): void => {
    if (closed) {
      return;
    }
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => {
      void fireRerun();
    }, debounceMs);
  };

  watcher = nodeWatch(
    watchDir,
    { persistent: true, recursive: false },
    (_event, filename) => {
      if (Date.now() - startedAt < warmupMs) {
        // Suppress FSEvents replay of pre-existing files on macOS.
        return;
      }
      if (!isRelevantFilename(filename)) {
        return;
      }
      scheduleRerun();
    }
  );

  watcher.on('error', (error: Error) => {
    process.stderr.write(`watch: watcher error: ${error.message}\n`);
  });

  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      if (pending !== undefined) {
        clearTimeout(pending);
        pending = undefined;
      }
      if (watcher !== undefined) {
        watcher.close();
        watcher = undefined;
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Watch loop
// ---------------------------------------------------------------------------

/** Options for {@link runWatchLoop}. */
export interface RunWatchLoopOptions {
  /** Absolute path to the resolved trail's source file. */
  readonly sourcePath: string;
  /** Invoked once per debounced change burst (and once initially). */
  readonly run: () => Promise<void>;
  /** Derive the watched trail's current resolved-contract hash. */
  readonly readTopoGraphEntryHash: ReadTopoGraphEntryHash;
  /**
   * Override for the debounce window. Primarily a test seam.
   */
  readonly debounceMs?: number | undefined;
  /**
   * Whether to clear the terminal between reruns. Defaults to `true` for
   * the standard interactive experience; tests pass `false` to keep
   * captured output legible.
   */
  readonly clearScreen?: boolean | undefined;
}

/**
 * Run the trail once, then install a watcher and re-run on changes until
 * `SIGINT` is received. Returns the exit code (always `0` on a clean
 * SIGINT shutdown).
 *
 * @remarks This is the high-level entry point used by the CLI binary.
 * Tests should target {@link createTrailWatcher} directly rather than
 * spawning a subprocess to drive this loop.
 */
export const runWatchLoop = async (
  options: RunWatchLoopOptions
): Promise<number> => {
  const clearScreen = options.clearScreen ?? true;

  const performRun = async (): Promise<void> => {
    if (clearScreen) {
      process.stdout.write(ANSI_CLEAR_SCREEN);
    }
    try {
      await options.run();
    } catch (error: unknown) {
      process.stderr.write(`watch: run failed: ${formatError(error)}\n`);
    }
  };

  await performRun();

  let initialTopoGraphEntryHash: string | null = null;
  try {
    initialTopoGraphEntryHash = await options.readTopoGraphEntryHash();
  } catch {
    process.stderr.write(WATCH_SCHEMA_INVALID_MESSAGE);
  }

  const watcher = createTrailWatcher({
    debounceMs: options.debounceMs,
    initialTopoGraphEntryHash,
    onRerun: performRun,
    readTopoGraphEntryHash: options.readTopoGraphEntryHash,
    sourcePath: options.sourcePath,
  });

  // `once(emitter, 'event')` returns a Promise that resolves when the
  // event fires. Cleaner than `new Promise(resolve => emitter.on(...))`
  // and aligns with `eslint-plugin-promise/avoid-new`.
  await once(process, 'SIGINT');
  watcher.close();
  return 0;
};
