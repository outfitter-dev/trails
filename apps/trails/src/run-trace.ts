/**
 * CLI-surface bridge for the `--trace` flag.
 *
 * `--trace` installs a per-invocation in-memory {@link TraceSink} so the
 * intrinsic tracing pipeline in `@ontrails/core` records every trail-,
 * span-, signal-, and activation-level event during the invocation. After
 * the trail completes (success or failure), the records are rendered as a
 * tree to stderr via `renderTraceTree` from `@ontrails/observability`. Under
 * `--json`, the structured `TraceRecord[]` is also emitted on stdout as
 * the `tracing` field of a Result envelope.
 *
 * Design notes:
 *
 * - The sink is **per-invocation**, not module-global. Each call to
 *   {@link installTraceSink} replaces the registry entry with a fresh
 *   `MemoryTraceSink` and returns a handle whose {@link TraceSession.finalize}
 *   restores the previous sink and returns the captured records.
 * - Tracing output is split across streams: the tree always goes to stderr,
 *   structured records only enter stdout when both `--trace` and `--json`
 *   are set. Under `--quiet`, the inner trail value remains the only stdout
 *   payload (no envelope) per ADR-0044's pipe-friendly contract.
 * - `--trace` on `run.examples` is a metadata read; the run trail short-circuits
 *   before any execution, so no trace tree is rendered.
 */

import { getTraceSink, registerTraceSink } from '@ontrails/core';
import type { TraceRecord, TraceSink } from '@ontrails/core';
import { createMemorySink, renderTraceTree } from '@ontrails/observability';
import type { MemoryTraceSink } from '@ontrails/observability';

// ---------------------------------------------------------------------------
// Argv detection
// ---------------------------------------------------------------------------

/**
 * Detect whether `--trace` appears in argv.
 *
 * Pre-parsed argv detection lets the CLI install the sink before
 * `surface()` parses argv. The flag is also wired through the build
 * pipeline as a meta flag, so trail input is unaffected.
 */
export const argvHasTraceFlag = (argv: readonly string[]): boolean =>
  argv.includes('--trace');

// ---------------------------------------------------------------------------
// Sink session
// ---------------------------------------------------------------------------

/** Handle returned by {@link installTraceSink}. */
export interface TraceSession {
  /** The fresh in-memory sink that received records during this invocation. */
  readonly sink: MemoryTraceSink;
  /**
   * Restore the previous trace sink and return a stable snapshot of the
   * records collected during this session. Safe to call once; subsequent
   * calls return an empty array.
   */
  readonly finalize: () => readonly TraceRecord[];
}

const restoreSink = (previous: TraceSink): void => {
  // `registerTraceSink(undefined)` collapses back to `NOOP_SINK`, which is
  // what we want when the prior sink was the default no-op singleton. For
  // any other prior sink (e.g. an OTel adapter wired by the host), restore
  // it directly so we do not accidentally drop the host's configured sink.
  registerTraceSink(previous);
};

/**
 * Register a fresh {@link MemoryTraceSink} as the active trace sink and
 * return a handle that can later restore the previous sink.
 */
export const installTraceSink = (): TraceSession => {
  const previous = getTraceSink();
  const sink = createMemorySink();
  registerTraceSink(sink);

  let finalized = false;
  return {
    finalize: () => {
      if (finalized) {
        return [];
      }
      finalized = true;
      const records = sink.records();
      restoreSink(previous);
      return records;
    },
    sink,
  };
};

// ---------------------------------------------------------------------------
// Stderr rendering
// ---------------------------------------------------------------------------

/**
 * Render the captured records as a tree to stderr, followed by a newline.
 *
 * No-ops on an empty record list so that quiet trails (e.g. metadata reads
 * that never invoke `executeTrail`) do not produce a stray blank line.
 */
export const writeTraceTreeToStderr = (
  records: readonly TraceRecord[]
): void => {
  if (records.length === 0) {
    return;
  }
  const tree = renderTraceTree(records);
  if (tree.length === 0) {
    return;
  }
  process.stderr.write(`${tree}\n`);
};

// ---------------------------------------------------------------------------
// JSON envelope shaping
// ---------------------------------------------------------------------------

/**
 * Result-style envelope emitted on stdout under `--trace --json`.
 *
 * Mirrors the shape of `Result<T, E>` but adds a `tracing` field so a
 * downstream consumer can deserialize the run outcome and the structured
 * trace from a single document.
 */
export type TraceJsonEnvelope =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly tracing: readonly TraceRecord[];
    }
  | {
      readonly ok: false;
      readonly error: { readonly message: string; readonly name: string };
      readonly tracing: readonly TraceRecord[];
    };

/**
 * Minimal Result-shape contract used by the JSON envelope builder.
 *
 * The `value` and `error` properties may be present at the same time on a
 * Result instance (the discriminated union narrows by `isOk` / `isErr`),
 * so this interface keeps both optional and lets the builder branch without
 * asserting either side.
 */
interface ResultLike {
  readonly isOk: () => boolean;
  readonly isErr: () => boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}

const errorFromUnknown = (
  value: unknown
): { readonly message: string; readonly name: string } => {
  if (value instanceof Error) {
    return { message: value.message, name: value.name };
  }
  return { message: String(value), name: 'Error' };
};

/**
 * Build the stdout envelope for `--trace --json`.
 *
 * On success, the inner value is taken straight from the trail's
 * `Result.ok(...)` payload. On failure the envelope captures the error's
 * `name` and `message` -- both safe to serialize and consistent with how
 * other Trails surfaces render errors.
 */
export const buildTraceJsonEnvelope = (
  result: ResultLike,
  records: readonly TraceRecord[]
): TraceJsonEnvelope => {
  if (result.isOk()) {
    return {
      ok: true,
      tracing: records,
      value: result.value,
    };
  }
  return {
    error: errorFromUnknown(result.error),
    ok: false,
    tracing: records,
  };
};

/**
 * Serialize a {@link TraceJsonEnvelope} as a single JSON document for stdout.
 *
 * Indented with two spaces to match the rest of the CLI's `--json`
 * formatting (see `output()` in `@ontrails/cli`).
 */
export const formatTraceJsonEnvelope = (envelope: TraceJsonEnvelope): string =>
  `${JSON.stringify(envelope, null, 2)}\n`;

// ---------------------------------------------------------------------------
// onResult bridge
// ---------------------------------------------------------------------------

interface TryTraceCtx {
  readonly flags: Record<string, unknown>;
  readonly result: ResultLike;
  readonly trail?: { readonly id: string } | undefined;
}

const isJsonMode = (flags: Record<string, unknown>): boolean => {
  if (flags['json'] === true) {
    return true;
  }
  if (typeof flags['output'] === 'string' && flags['output'] === 'json') {
    return true;
  }
  return false;
};

const shouldEmitTraceEnvelope = (flags: Record<string, unknown>): boolean => {
  if (flags['trace'] !== true) {
    return false;
  }
  if (flags['quiet'] === true) {
    // `--quiet` is the explicit pipe-friendly mode. Adding the tracing
    // envelope to stdout would defeat the contract -- defer to the
    // existing quiet handler for stdout and only render the tree on
    // stderr (handled outside this helper).
    return false;
  }
  if (flags['jsonl'] === true) {
    // `--jsonl` streams items per line; the structured envelope cannot be
    // expressed without breaking the line-delimited contract.
    return false;
  }
  return isJsonMode(flags);
};

const traceOutputIsOwnedByRunFamily = (ctx: TryTraceCtx): boolean => {
  if (ctx.trail?.id === 'run.example') {
    // `run.example` owns stdout via its comparison envelope. Still render the
    // trace tree to stderr, but do not override the example helper output.
    return false;
  }
  if (ctx.trail?.id === 'run.examples') {
    // Pure metadata read; no execution to trace.
    return false;
  }
  return true;
};

/**
 * If the invocation requested both `--trace` and `--json`, serialize the
 * trace envelope to stdout and return `true`. Otherwise return `false` so
 * the caller falls through to the regular on-result chain.
 *
 * The stderr tree is **not** rendered here -- it is rendered uniformly
 * for every `--trace` invocation in the CLI entry-point's `finally`
 * block, even when this helper short-circuits.
 */
export const tryTraceJsonOutput = (
  ctx: TryTraceCtx,
  session: TraceSession
): boolean => {
  if (
    !shouldEmitTraceEnvelope(ctx.flags) ||
    !traceOutputIsOwnedByRunFamily(ctx)
  ) {
    return false;
  }
  const records = session.sink.records();
  const envelope = buildTraceJsonEnvelope(ctx.result, records);
  process.stdout.write(formatTraceJsonEnvelope(envelope));
  return true;
};
