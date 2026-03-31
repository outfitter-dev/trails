import type { TrackRecord } from './record.js';
import { getTraceContext } from './trace-context.js';

/** Sink type re-declared to avoid circular import with tracks-layer. */
interface TrackSinkLike {
  readonly write: (record: TrackRecord) => void | Promise<void>;
}

/** Key used to store the TracksApi in ctx.extensions. */
export const TRACKS_API_KEY = '__tracks_api';

/** Manual instrumentation API for trail implementations. */
export interface TracksApi {
  /**
   * Create a timed child span. Callback-only to guarantee spans close.
   * No raw startSpan/endSpan to prevent forgotten closures.
   */
  readonly span: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;

  /** Add key-value pairs to the current trail's record attrs. */
  readonly annotate: (attrs: Record<string, unknown>) => void;
}

/** TracksApi bundled with internal state the layer needs after execution. */
export interface TracksApiWithState {
  readonly api: TracksApi;
  /** Retrieve all accumulated annotations, merged into a single object. */
  readonly getAnnotations: () => Record<string, unknown>;
}

/** Build a span record from trace context and span name. */
const createSpanRecord = (
  traceId: string,
  parentId: string,
  rootId: string,
  name: string
): TrackRecord => ({
  attrs: {},
  endedAt: undefined,
  errorCategory: undefined,
  id: Bun.randomUUIDv7(),
  intent: undefined,
  kind: 'span',
  name,
  parentId,
  rootId,
  startedAt: Date.now(),
  status: 'ok',
  surface: undefined,
  traceId,
  trailId: undefined,
});

/** Mark a record as completed with timing and status. */
const completeSpanRecord = (
  record: TrackRecord,
  status: 'ok' | 'err',
  error?: unknown
): TrackRecord => ({
  ...record,
  endedAt: Date.now(),
  errorCategory:
    status === 'err' && error instanceof Error
      ? error.constructor.name
      : undefined,
  status,
});

/** Merge an array of annotation objects into a single flat record. */
const mergeAnnotations = (
  annotations: readonly Record<string, unknown>[]
): Record<string, unknown> =>
  Object.assign({}, ...annotations) as Record<string, unknown>;

/**
 * Create a TracksApi bound to a specific execution context and sink.
 *
 * Reads trace context from `ctx.extensions` so manual spans become
 * children of the trail's automatic record. Returns the API alongside
 * a `getAnnotations` accessor the layer uses to merge attrs into the
 * completed record.
 */
export const createTracksApi = (
  ctx: { readonly extensions?: Readonly<Record<string, unknown>> | undefined },
  sink: TrackSinkLike
): TracksApiWithState => {
  const annotations: Record<string, unknown>[] = [];

  const trace = getTraceContext(ctx);
  const traceId = trace?.traceId ?? Bun.randomUUIDv7();
  const parentId = trace?.spanId ?? Bun.randomUUIDv7();
  const rootId = trace?.rootId ?? parentId;

  const span = async <T>(
    name: string,
    fn: () => T | Promise<T>
  ): Promise<T> => {
    if (trace?.sampled === false) {
      return await fn();
    }

    const record = createSpanRecord(traceId, parentId, rootId, name);

    try {
      const result = await fn();
      await Promise.resolve(sink.write(completeSpanRecord(record, 'ok'))).catch(
        () => {
          // sink failures must not affect span result delivery
        }
      );
      return result;
    } catch (error: unknown) {
      try {
        await Promise.resolve(
          sink.write(completeSpanRecord(record, 'err', error))
        );
      } catch {
        // best-effort write; don't let sink errors mask the original
      }
      throw error;
    }
  };

  const annotate = (attrs: Record<string, unknown>): void => {
    annotations.push(attrs);
  };

  const getAnnotations = (): Record<string, unknown> =>
    mergeAnnotations(annotations);

  return { api: { annotate, span }, getAnnotations };
};
