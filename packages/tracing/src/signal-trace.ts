import { getTraceContext, getTraceSink, NOOP_SINK } from '@ontrails/core';
import type {
  SignalTraceRecordName as CoreSignalTraceRecordName,
  TraceContext,
  TraceRecord,
  TraceSink,
} from '@ontrails/core';

/** Signal lifecycle records emitted by the typed signal runtime. */
export type SignalTraceRecordName = CoreSignalTraceRecordName;

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
  startedAt: Date.now(),
  status: 'ok',
  traceId: parent.traceId,
  trailId: undefined,
  trailhead: undefined,
});

const completeSignalTraceRecord = (
  record: TraceRecord,
  status: TraceRecord['status'],
  errorCategory?: string | undefined
): TraceRecord => ({
  ...record,
  endedAt: Date.now(),
  errorCategory,
  status,
});

const writeToSink = async (
  sink: TraceSink,
  record: TraceRecord
): Promise<void> => {
  try {
    await Promise.resolve(sink.write(record));
  } catch {
    // Trace sink failures must not affect caller control flow.
  }
};

/** Best-effort write for signal lifecycle records, no-op when tracing is disabled. */
export const writeSignalTraceRecord = async (
  ctx: { readonly extensions?: Readonly<Record<string, unknown>> | undefined },
  name: SignalTraceRecordName,
  attrs: Readonly<Record<string, unknown>>,
  status: TraceRecord['status'] = 'ok',
  errorCategory?: string | undefined
): Promise<void> => {
  const sink = getTraceSink();
  const parent = getTraceContext(ctx);
  if (parent === undefined || sink === NOOP_SINK) {
    return;
  }
  await writeToSink(
    sink,
    completeSignalTraceRecord(
      createSignalTraceRecord(parent, name, attrs),
      status,
      errorCategory
    )
  );
};
