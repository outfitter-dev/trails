/**
 * Intrinsic tracing primitives.
 *
 * This module is the home for the trace record type, the sink interface,
 * the sink registry, and the helpers `executeTrail` uses to create root
 * trace records and child spans. It is intentionally framework-internal —
 * the `@ontrails/tracing` package re-exports the public surface so callers
 * can continue to import from there.
 *
 * Tracing is intrinsic: every `executeTrail` call automatically produces a
 * root `TraceRecord`, and `ctx.trace(label, fn)` creates nested child spans
 * underneath it. A default no-op sink is installed at module load so core
 * never crashes when no real sink has been registered.
 */

/** Evidence of a single trail execution or manual span. */
export interface TraceRecord {
  readonly id: string;
  readonly traceId: string;
  readonly rootId: string;
  readonly parentId?: string | undefined;
  readonly kind: 'trail' | 'span';
  readonly name: string;
  readonly trailId?: string | undefined;
  readonly trailhead?: 'cli' | 'mcp' | 'http' | 'ws' | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly startedAt: number;
  readonly endedAt?: number | undefined;
  readonly status: 'ok' | 'err' | 'cancelled';
  readonly errorCategory?: string | undefined;
  readonly permit?:
    | { readonly id: string; readonly tenantId?: string }
    | undefined;
  readonly attrs: Readonly<Record<string, unknown>>;
}

/**
 * Minimal shape a tracing sink must satisfy.
 *
 * Kept intentionally tiny so adapters in `@ontrails/tracing`,
 * `@ontrails/observe`, and user code can all satisfy it without
 * additional dependencies.
 */
export interface TraceSink {
  readonly write: (record: TraceRecord) => void | Promise<void>;
}

/** Trace context carried through trail execution via `ctx.extensions`. */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly rootId: string;
  readonly sampled: boolean;
}

/** Key used to store trace context in `ctx.extensions`. */
export const TRACE_CONTEXT_KEY = '__trace_context';

/** Read trace context from trail context extensions. */
export const getTraceContext = (ctx: {
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}): TraceContext | undefined =>
  ctx.extensions?.[TRACE_CONTEXT_KEY] as TraceContext | undefined;

// ---------------------------------------------------------------------------
// Default no-op sink + sink registry
// ---------------------------------------------------------------------------

/** No-op sink installed by default so core never crashes without configuration. */
const noopSink: TraceSink = {
  // oxlint-disable-next-line no-empty-function -- intentional no-op
  write: () => {},
};

// oxlint-disable-next-line eslint-plugin-jest/require-hook -- module-level sink registry, not test setup
let currentSink: TraceSink = noopSink;

/**
 * Register a trace sink globally.
 *
 * All trails executed via `executeTrail` will write their completed trace
 * records to this sink, as will every `ctx.trace(label, fn)` child span.
 * Registering `undefined` or calling {@link clearTraceSink} resets back to
 * the default no-op sink.
 */
export const registerTraceSink = (sink: TraceSink | undefined): void => {
  currentSink = sink ?? noopSink;
};

/** Retrieve the currently registered sink (never undefined). */
export const getTraceSink = (): TraceSink => currentSink;

/** Reset the sink registry back to the default no-op sink. */
export const clearTraceSink = (): void => {
  currentSink = noopSink;
};

// ---------------------------------------------------------------------------
// Record + span helpers
// ---------------------------------------------------------------------------

/** Options for creating a trail-scoped {@link TraceRecord}. */
interface CreateTraceRecordOptions {
  readonly trailId: string;
  readonly traceId?: string | undefined;
  readonly parentId?: string | undefined;
  readonly rootId?: string | undefined;
  readonly trailhead?: TraceRecord['trailhead'];
  readonly intent?: TraceRecord['intent'];
  readonly permit?:
    | { readonly id: string; readonly tenantId?: string }
    | undefined;
}

/** Create a fresh trail-kind {@link TraceRecord}. */
export const createTraceRecord = (
  options: CreateTraceRecordOptions
): TraceRecord => {
  const id = Bun.randomUUIDv7();
  const traceId = options.traceId ?? Bun.randomUUIDv7();

  return {
    attrs: {},
    endedAt: undefined,
    id,
    intent: options.intent,
    kind: 'trail',
    name: options.trailId,
    parentId: options.parentId,
    permit: options.permit,
    rootId: options.rootId ?? id,
    startedAt: Date.now(),
    status: 'ok',
    traceId,
    trailId: options.trailId,
    trailhead: options.trailhead,
  };
};

/** Build a span record from a parent trace context. */
export const createSpanRecord = (
  parent: TraceContext,
  label: string
): TraceRecord => ({
  attrs: {},
  endedAt: undefined,
  errorCategory: undefined,
  id: Bun.randomUUIDv7(),
  intent: undefined,
  kind: 'span',
  name: label,
  parentId: parent.spanId,
  rootId: parent.rootId,
  startedAt: Date.now(),
  status: 'ok',
  traceId: parent.traceId,
  trailId: undefined,
  trailhead: undefined,
});

/** Mark a record as completed with timing and status. */
export const completeRecord = (
  record: TraceRecord,
  status: TraceRecord['status'],
  errorCategory?: string | undefined
): TraceRecord => ({
  ...record,
  endedAt: Date.now(),
  errorCategory,
  status,
});

/** Best-effort sink write that never throws. */
export const writeToSink = async (
  sink: TraceSink,
  record: TraceRecord
): Promise<void> => {
  try {
    await Promise.resolve(sink.write(record));
  } catch {
    // Sink failures must never affect trail result delivery.
  }
};
