import { ValidationError } from '@ontrails/core';
import type {
  LogRecord,
  LogSink,
  ObserveCapabilities,
  TraceRecord,
  TraceSink,
} from '@ontrails/core';

type ObserveRecord = LogRecord | TraceRecord;
type ObserveSink = LogSink | TraceSink;
type SinkWrite = (record: ObserveRecord) => void | Promise<void>;
type FlushableSink = ObserveSink & { readonly flush?: () => Promise<void> };

interface SinkFailure {
  readonly error: unknown;
  readonly index: number;
  readonly sinkName: string | undefined;
}

export interface CombinedSink {
  readonly name: string;
  readonly observes: ObserveCapabilities;
  write(record: LogRecord): void;
  write(record: TraceRecord): void | Promise<void>;
  flush(): Promise<void>;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { readonly then?: unknown }).then === 'function';

const isLogSink = (sink: ObserveSink): sink is LogSink =>
  'name' in sink && typeof sink.name === 'string';

const isLogRecord = (record: ObserveRecord): record is LogRecord =>
  'level' in record && 'message' in record && 'timestamp' in record;

const readObserveCapabilities = (
  sink: ObserveSink
): ObserveCapabilities | undefined => {
  const capabilities = (sink as { readonly observes?: unknown }).observes;
  if (typeof capabilities !== 'object' || capabilities === null) {
    return undefined;
  }
  const log = (capabilities as ObserveCapabilities).log === true;
  const trace = (capabilities as ObserveCapabilities).trace === true;
  if (!log && !trace) {
    return undefined;
  }
  return Object.freeze({
    ...(log ? { log: true as const } : {}),
    ...(trace ? { trace: true as const } : {}),
  });
};

const capabilitiesForSink = (sink: ObserveSink): ObserveCapabilities =>
  readObserveCapabilities(sink) ??
  Object.freeze(
    isLogSink(sink) ? { log: true as const } : { trace: true as const }
  );

const combineCapabilities = (
  sinks: readonly ObserveSink[]
): ObserveCapabilities => {
  let log = false;
  let trace = false;
  for (const sink of sinks) {
    const capabilities = capabilitiesForSink(sink);
    log ||= capabilities.log === true;
    trace ||= capabilities.trace === true;
  }
  return Object.freeze({
    ...(log ? { log: true as const } : {}),
    ...(trace ? { trace: true as const } : {}),
  });
};

const sinkName = (sink: ObserveSink): string | undefined =>
  'name' in sink && typeof sink.name === 'string' ? sink.name : undefined;

const flushForSink = (sink: ObserveSink): (() => Promise<void>) | undefined => {
  const { flush } = sink as FlushableSink;
  return typeof flush === 'function' ? flush.bind(sink) : undefined;
};

const canReceiveRecord = (
  sink: ObserveSink,
  record: ObserveRecord
): boolean => {
  const capabilities = capabilitiesForSink(sink);
  return isLogRecord(record)
    ? capabilities.log === true
    : capabilities.trace === true;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const createFailureRecord = (
  failure: SinkFailure,
  record: ObserveRecord
): LogRecord => ({
  category: 'observe.combine',
  level: 'warn',
  message: 'Observe sink write failed; continuing with remaining sinks',
  metadata: {
    error: describeError(failure.error),
    sinkIndex: failure.index,
    ...(failure.sinkName === undefined ? {} : { sinkName: failure.sinkName }),
    ...(isLogRecord(record)
      ? { recordCategory: record.category }
      : { recordId: record.id, traceId: record.traceId }),
  },
  timestamp: new Date(),
});

const writeToSink = (
  sink: ObserveSink,
  record: ObserveRecord
): void | Promise<void> => {
  // Call via the sink so class-based sinks keep `this` bound. Detaching the
  // method (e.g. `(sink.write as SinkWrite)(record)`) would lose `this` and
  // any class-method `write` would throw — silently dropping records since
  // combine() swallows child errors. Mirrors flushForSink's binding.
  const write = sink.write as SinkWrite;
  return write.call(sink, record);
};

const ignoreReportFailure = async (
  result: PromiseLike<unknown>
): Promise<void> => {
  try {
    await result;
  } catch {
    // Error reporting is best-effort.
  }
};

const reportFailures = (
  sinks: readonly ObserveSink[],
  failures: readonly SinkFailure[],
  record: ObserveRecord
): void => {
  if (failures.length === 0) {
    return;
  }

  const logSinks = sinks
    .map((sink, index) => ({ index, sink }))
    .filter(
      (entry): entry is { readonly index: number; readonly sink: LogSink } =>
        capabilitiesForSink(entry.sink).log === true && isLogSink(entry.sink)
    );

  for (const failure of failures) {
    const failureRecord = createFailureRecord(failure, record);
    for (const entry of logSinks) {
      if (entry.index === failure.index) {
        continue;
      }
      try {
        const result = entry.sink.write(failureRecord);
        if (isPromiseLike(result)) {
          void ignoreReportFailure(result);
        }
      } catch {
        // Error reporting is best-effort; the original write path is already isolated.
      }
    }
  }
};

const createFailure = (
  sink: ObserveSink,
  index: number,
  error: unknown
): SinkFailure => ({
  error,
  index,
  sinkName: sinkName(sink),
});

const isolateAsyncWriteFailure = async (
  result: PromiseLike<unknown>,
  sink: ObserveSink,
  index: number,
  failures: SinkFailure[]
): Promise<void> => {
  try {
    await result;
  } catch (error) {
    failures.push(createFailure(sink, index, error));
  }
};

const reportAfterPendingWrites = async (
  pending: readonly Promise<void>[],
  sinks: readonly ObserveSink[],
  failures: readonly SinkFailure[],
  record: ObserveRecord
): Promise<void> => {
  await Promise.all(pending);
  reportFailures(sinks, failures, record);
};

/**
 * Compose multiple observability sinks into one fan-out sink.
 *
 * @example
 * ```typescript
 * const sink = combine(otelSink, fileSink)
 * const app = topo('app', trails, { observe: sink })
 * ```
 *
 * @remarks
 * A child sink failure never prevents sibling sinks from receiving the same
 * record. Failures are swallowed and reported to log-capable sibling sinks
 * when one is present.
 */
export function combine(...sinks: readonly LogSink[]): CombinedSink;
export function combine(...sinks: readonly TraceSink[]): CombinedSink;
export function combine(...sinks: readonly ObserveSink[]): CombinedSink;
export function combine(...sinks: readonly ObserveSink[]): CombinedSink {
  if (sinks.length === 0) {
    throw new ValidationError(
      'combine() requires at least one sink; an empty composition has no observe capabilities and would fail topo validation.'
    );
  }

  const observes = combineCapabilities(sinks);

  return {
    async flush(): Promise<void> {
      await Promise.all(
        sinks.map(async (sink) => {
          const flush = flushForSink(sink);
          if (flush === undefined) {
            return;
          }
          try {
            await flush();
          } catch {
            // Flush follows write isolation: one broken sink should not block shutdown.
          }
        })
      );
    },
    name: 'combined',
    observes,
    write(record: ObserveRecord): void | Promise<void> {
      const failures: SinkFailure[] = [];
      const pending: Promise<void>[] = [];

      for (const [index, sink] of sinks.entries()) {
        if (!canReceiveRecord(sink, record)) {
          continue;
        }
        try {
          const result = writeToSink(sink, record);
          if (isPromiseLike(result)) {
            pending.push(
              isolateAsyncWriteFailure(result, sink, index, failures)
            );
          }
        } catch (error) {
          failures.push(createFailure(sink, index, error));
        }
      }

      if (pending.length === 0) {
        reportFailures(sinks, failures, record);
        return undefined;
      }

      return reportAfterPendingWrites(pending, sinks, failures, record);
    },
  };
}
