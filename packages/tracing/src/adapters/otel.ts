import type { TraceRecord, TraceSink } from '@ontrails/core';

type OtelAttributeValue = string | number | boolean;

/** OTel span representation produced by the adapter. */
export interface OtelSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly operationName: string;
  readonly startTime: number;
  readonly endTime?: number | undefined;
  readonly status: 'OK' | 'ERROR' | 'UNSET';
  readonly kind: 'INTERNAL' | 'SERVER';
  readonly attributes: Readonly<Record<string, OtelAttributeValue>>;
}

/** Callback that receives translated OTel spans. */
export type OtelExporter = (spans: readonly OtelSpan[]) => void | Promise<void>;

/** Configuration for the OTel adapter. */
export interface OtelAdapterOptions {
  readonly exporter: OtelExporter;
  readonly batchSize?: number;
}

/** Map from TraceRecord status to OTel status. */
const STATUS_MAP: Record<TraceRecord['status'], OtelSpan['status']> = {
  cancelled: 'UNSET',
  err: 'ERROR',
  ok: 'OK',
};

/** Derive OTel span kind from parentId presence. */
const deriveKind = (parentId: string | undefined): OtelSpan['kind'] =>
  parentId === undefined ? 'SERVER' : 'INTERNAL';

const SAFE_SIGNAL_PAYLOAD_ATTRIBUTE_KEYS = new Set([
  'trails.signal.payload.byte_length',
  'trails.signal.payload.digest',
  'trails.signal.payload.redacted',
  'trails.signal.payload.shape',
  'trails.signal.payload.top_level_entry_count',
]);

const UNSAFE_SENSITIVE_ATTRIBUTE_SEGMENTS = new Set([
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
]);
const UNSAFE_RAW_ATTRIBUTE_NAMES = new Set([
  'body',
  'input',
  'output',
  'payload',
]);

const UNSAFE_ATTRIBUTE_KEYS = new Set([
  'error.message',
  'error.stack',
  'exception.message',
  'exception.stacktrace',
  'message',
  'stack',
  'stacktrace',
]);

const normalizeAttributeKey = (key: string): string =>
  key.replaceAll(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase();

const splitAttributeKey = (key: string): readonly string[] =>
  normalizeAttributeKey(key).split(/[._-]+/u);

const isUnsafeCustomAttributeKey = (key: string): boolean => {
  const normalized = normalizeAttributeKey(key);
  if (SAFE_SIGNAL_PAYLOAD_ATTRIBUTE_KEYS.has(normalized)) {
    return false;
  }
  if (
    UNSAFE_ATTRIBUTE_KEYS.has(normalized) ||
    normalized.endsWith('.error.message') ||
    normalized.endsWith('.error.stack') ||
    normalized.endsWith('.exception.message') ||
    normalized.endsWith('.exception.stacktrace')
  ) {
    return true;
  }
  const parts = splitAttributeKey(normalized);
  if (parts.some((part) => UNSAFE_SENSITIVE_ATTRIBUTE_SEGMENTS.has(part))) {
    return true;
  }
  const last = parts.at(-1);
  if (last !== undefined && UNSAFE_RAW_ATTRIBUTE_NAMES.has(last)) {
    return true;
  }
  return parts.includes('payload');
};

const isOtelAttributeValue = (value: unknown): value is OtelAttributeValue =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/** Attribute mapping: record field → OTel attribute key + extractor. */
const ATTR_MAP: readonly {
  key: string;
  get: (r: TraceRecord) => OtelAttributeValue | undefined;
}[] = [
  {
    get: (r) => (r.kind === 'activation' ? r.name : undefined),
    key: 'trails.activation.event',
  },
  { get: (r) => r.errorCategory, key: 'trails.error.category' },
  { get: (r) => r.intent, key: 'trails.intent' },
  { get: (r) => r.permit?.id, key: 'trails.permit.id' },
  { get: (r) => r.permit?.tenantId, key: 'trails.permit.tenant_id' },
  { get: (r) => r.kind, key: 'trails.record.kind' },
  { get: (r) => r.name, key: 'trails.record.name' },
  { get: (r) => r.sampled, key: 'trails.sampled' },
  {
    get: (r) => (r.kind === 'signal' ? r.name : undefined),
    key: 'trails.signal.event',
  },
  { get: (r) => r.id, key: 'trails.span.id' },
  { get: (r) => r.parentId, key: 'trails.span.parent_id' },
  { get: (r) => r.rootId, key: 'trails.span.root_id' },
  { get: (r) => r.status, key: 'trails.status' },
  { get: (r) => r.surface, key: 'trails.surface' },
  {
    get: (r) => (r.endedAt === undefined ? undefined : r.endedAt - r.startedAt),
    key: 'trails.timing.duration_ms',
  },
  { get: (r) => r.endedAt, key: 'trails.timing.ended_at_ms' },
  { get: (r) => r.startedAt, key: 'trails.timing.started_at_ms' },
  { get: (r) => r.traceId, key: 'trails.trace.id' },
  { get: (r) => r.trailId, key: 'trails.trail.id' },
];

const STABLE_ATTRIBUTE_KEYS = new Set(ATTR_MAP.map(({ key }) => key));

/** Build the trails-namespaced attributes from a TraceRecord. */
const buildAttributes = (
  record: TraceRecord
): Record<string, OtelAttributeValue> => {
  const attrs: Record<string, OtelAttributeValue> = {};
  for (const { key, get } of ATTR_MAP) {
    const val = get(record);
    if (val !== undefined) {
      attrs[key] = val;
    }
  }
  for (const [key, val] of Object.entries(record.attrs)) {
    if (
      attrs[key] === undefined &&
      !STABLE_ATTRIBUTE_KEYS.has(key) &&
      !isUnsafeCustomAttributeKey(key) &&
      isOtelAttributeValue(val)
    ) {
      attrs[key] = val;
    }
  }
  return attrs;
};

/** Translate a TraceRecord into an OTel span. */
const toOtelSpan = (record: TraceRecord): OtelSpan => ({
  attributes: buildAttributes(record),
  endTime: record.endedAt,
  kind: deriveKind(record.parentId),
  operationName: record.name,
  parentSpanId: record.parentId,
  spanId: record.id,
  startTime: record.startedAt,
  status: STATUS_MAP[record.status],
  traceId: record.traceId,
});

/** A TraceSink extended with an explicit flush for shutdown. */
export interface OtelSink extends TraceSink {
  /**
   * Flush any remaining buffered spans to the exporter.
   *
   * Call this during shutdown after the app stops accepting new work. Concurrent
   * flush calls await the same in-flight export. If the exporter rejects, the
   * failed batch is restored to the buffer so a later flush can retry it.
   */
  readonly flush: () => Promise<void>;
}

/**
 * Create a TraceSink that translates Tracing to OTel spans.
 *
 * The adapter maps Trails-native fields to OpenTelemetry span attributes
 * under a `trails.*` namespace. Pass any OTel-compatible exporter callback
 * to forward spans to your collector.
 *
 * Translates and exports spans on each write. Call `flush()` on shutdown
 * to send any remaining buffered spans.
 */
export const createOtelAdapter = (options: OtelAdapterOptions): OtelSink => {
  const batchSize = options.batchSize ?? 1;
  if (!(Number.isSafeInteger(batchSize) && batchSize > 0)) {
    throw new RangeError('OTel adapter batchSize must be a positive integer');
  }
  const buffer: OtelSpan[] = [];
  let activeFlush: Promise<void> | undefined;
  let flushAllRequested = false;

  const exportBuffered = async (): Promise<void> => {
    const batch = buffer.splice(0);
    try {
      await options.exporter(batch);
    } catch (error) {
      // Restore batch on exporter failure so data is not lost.
      buffer.unshift(...batch);
      throw error;
    }
  };

  const startFlush = (request?: {
    readonly flushAll?: boolean;
  }): Promise<void> => {
    if (request?.flushAll === true) {
      flushAllRequested = true;
    }
    if (activeFlush !== undefined) {
      return activeFlush;
    }
    if (
      buffer.length === 0 ||
      (request?.flushAll !== true && buffer.length < batchSize)
    ) {
      if (buffer.length === 0) {
        flushAllRequested = false;
      }
      return Promise.resolve();
    }
    activeFlush = (async () => {
      try {
        let shouldContinue = true;
        do {
          await exportBuffered();
          shouldContinue =
            buffer.length > 0 &&
            (flushAllRequested || buffer.length >= batchSize);
        } while (shouldContinue);
      } finally {
        activeFlush = undefined;
        if (buffer.length === 0) {
          flushAllRequested = false;
        }
      }
    })();
    return activeFlush;
  };

  const flush = (): Promise<void> => startFlush({ flushAll: true });

  const maybeFlush = async (): Promise<void> => {
    while (buffer.length >= batchSize) {
      await startFlush();
    }
  };

  return {
    flush,
    write: async (record: TraceRecord): Promise<void> => {
      buffer.push(toOtelSpan(record));
      await maybeFlush();
    },
  };
};
