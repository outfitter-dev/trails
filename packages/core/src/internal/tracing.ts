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
 * root `TraceRecord`, `ctx.trace(label, fn)` creates nested child spans, and
 * the signal runtime records lifecycle points underneath the active producer
 * trace. A default no-op sink is installed at module load so core never
 * crashes when no real sink has been registered.
 */

/** Signal lifecycle records emitted by the typed signal runtime. */
export type SignalTraceRecordName =
  | 'signal.fired'
  | 'signal.handler.completed'
  | 'signal.handler.failed'
  | 'signal.handler.invoked'
  | 'signal.handler.predicate_failed'
  | 'signal.handler.predicate_matched'
  | 'signal.handler.predicate_skipped'
  | 'signal.invalid';

/** Activation boundary records emitted by runtime materializers. */
export type ActivationTraceRecordName =
  | 'activation.cycle_detected'
  | 'activation.scheduled'
  | 'activation.webhook'
  | 'activation.webhook.invalid';

/** Evidence of a single trail execution, manual span, activation boundary, or signal lifecycle point. */
export interface TraceRecord {
  readonly id: string;
  readonly traceId: string;
  readonly rootId: string;
  readonly parentId?: string | undefined;
  readonly kind: 'activation' | 'signal' | 'span' | 'trail';
  readonly name: string;
  readonly trailId?: string | undefined;
  readonly trailhead?: 'cli' | 'mcp' | 'http' | 'ws' | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly startedAt: number;
  readonly endedAt?: number | undefined;
  readonly status: 'ok' | 'err' | 'cancelled';
  readonly errorCategory?: string | undefined;
  readonly sampled?: boolean | undefined;
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
export const NOOP_SINK: TraceSink = {
  // oxlint-disable-next-line no-empty-function -- intentional no-op
  write: () => {},
};

// oxlint-disable-next-line eslint-plugin-jest/require-hook -- module-level sink registry, not test setup
let currentSink: TraceSink = NOOP_SINK;

/**
 * Register a trace sink globally.
 *
 * All trails executed via `executeTrail` will write their completed trace
 * records to this sink, as will every `ctx.trace(label, fn)` child span.
 * Registering `undefined` or calling {@link clearTraceSink} resets back to
 * the default no-op sink.
 */
export const registerTraceSink = (sink: TraceSink | undefined): void => {
  currentSink = sink ?? NOOP_SINK;
};

/** Retrieve the currently registered sink (never undefined). */
export const getTraceSink = (): TraceSink => currentSink;

/** True when tracing is effectively disabled and executeTrail should skip allocation. */
export const isTracingDisabled = (sink: TraceSink = currentSink): boolean =>
  sink === NOOP_SINK;

/** Reset the sink registry back to the default no-op sink. */
export const clearTraceSink = (): void => {
  currentSink = NOOP_SINK;
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
  readonly sampled?: boolean | undefined;
  readonly permit?:
    | { readonly id: string; readonly tenantId?: string }
    | undefined;
}

interface CreateActivationTraceRecordOptions {
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
  readonly parentId?: string | undefined;
  readonly rootId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly sampled?: boolean | undefined;
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
    sampled: options.sampled,
    startedAt: Date.now(),
    status: 'ok',
    traceId,
    trailId: options.trailId,
    trailhead: options.trailhead,
  };
};

/** Create an activation-kind {@link TraceRecord}. */
export const createActivationTraceRecord = (
  name: ActivationTraceRecordName,
  options: CreateActivationTraceRecordOptions = {}
): TraceRecord => {
  const id = Bun.randomUUIDv7();
  const traceId = options.traceId ?? Bun.randomUUIDv7();

  return {
    attrs: options.attrs ?? {},
    endedAt: undefined,
    errorCategory: undefined,
    id,
    intent: undefined,
    kind: 'activation',
    name,
    parentId: options.parentId,
    permit: undefined,
    rootId: options.rootId ?? id,
    sampled: options.sampled,
    startedAt: Date.now(),
    status: 'ok',
    traceId,
    trailId: undefined,
    trailhead: undefined,
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
  sampled: parent.sampled,
  startedAt: Date.now(),
  status: 'ok',
  traceId: parent.traceId,
  trailId: undefined,
  trailhead: undefined,
});

/** Build a signal lifecycle record from a parent trace context. */
export const createSignalTraceRecord = (
  parent: TraceContext,
  name: SignalTraceRecordName,
  attrs: Readonly<Record<string, unknown>> = {}
): TraceRecord => ({
  attrs,
  endedAt: undefined,
  errorCategory: undefined,
  id: Bun.randomUUIDv7(),
  intent: undefined,
  kind: 'signal',
  name,
  parentId: parent.spanId,
  rootId: parent.rootId,
  sampled: parent.sampled,
  startedAt: Date.now(),
  status: 'ok',
  traceId: parent.traceId,
  trailId: undefined,
  trailhead: undefined,
});

/** Use a completed record as the current trace parent for subsequent trail execution. */
export const traceContextFromRecord = (record: TraceRecord): TraceContext => ({
  rootId: record.rootId,
  sampled: record.sampled ?? true,
  spanId: record.id,
  traceId: record.traceId,
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

/**
 * Best-effort sink write that never throws.
 *
 * Returns `true` when the sink accepted the record, `false` when the write
 * threw. Most callers can ignore the return value -- it exists so that
 * callers that hand the written record back as a parent trace context
 * (e.g. {@link writeActivationTraceRecord}) can refuse to do so when the
 * record never actually made it to storage.
 */
export const writeToSink = async (
  sink: TraceSink,
  record: TraceRecord
): Promise<boolean> => {
  try {
    await Promise.resolve(sink.write(record));
    return true;
  } catch {
    // Sink failures must never affect trail result delivery.
    return false;
  }
};

/** Best-effort write for signal lifecycle records, no-op when tracing is disabled. */
export const writeSignalTraceRecord = async (
  ctx: { readonly extensions?: Readonly<Record<string, unknown>> | undefined },
  name: SignalTraceRecordName,
  attrs: Readonly<Record<string, unknown>>,
  status: TraceRecord['status'] = 'ok',
  errorCategory?: string | undefined,
  sink: TraceSink = getTraceSink()
): Promise<void> => {
  const parent = getTraceContext(ctx);
  if (parent === undefined || isTracingDisabled(sink)) {
    return;
  }
  await writeToSink(
    sink,
    completeRecord(
      createSignalTraceRecord(parent, name, attrs),
      status,
      errorCategory
    )
  );
};

/** Best-effort write for activation boundary records, no-op when tracing is disabled. */
export const writeActivationTraceRecord = async (
  name: ActivationTraceRecordName,
  attrs: Readonly<Record<string, unknown>>,
  status: TraceRecord['status'] = 'ok',
  errorCategory?: string | undefined,
  parent?: TraceContext | undefined,
  sink: TraceSink = getTraceSink()
): Promise<TraceRecord | undefined> => {
  if (isTracingDisabled(sink)) {
    return undefined;
  }
  const record = completeRecord(
    createActivationTraceRecord(name, {
      attrs,
      parentId: parent?.spanId,
      rootId: parent?.rootId,
      // Parentless activations are the root span of their trace tree. Default
      // sampled to true so the activation boundary stays consistent with
      // child trail records, which default sampled=true via
      // traceContextFromRecord. Inconsistent sampled flags within a trace
      // break filters/exporters that gate on the activation boundary.
      sampled: parent?.sampled ?? true,
      traceId: parent?.traceId,
    }),
    status,
    errorCategory
  );
  const written = await writeToSink(sink, record);
  // When the sink dropped the record we must not hand it back to callers as
  // a parent trace context -- subsequent child writes would reference an
  // activation span that never reached storage, producing broken lineage.
  return written ? record : undefined;
};
