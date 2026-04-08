import type { TraceRecord, TraceSink } from '@ontrails/core';

/** OTel span representation produced by the connector. */
export interface OtelSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly operationName: string;
  readonly startTime: number;
  readonly endTime?: number | undefined;
  readonly status: 'OK' | 'ERROR' | 'UNSET';
  readonly kind: 'INTERNAL' | 'SERVER';
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

/** Callback that receives translated OTel spans. */
export type OtelExporter = (spans: readonly OtelSpan[]) => void | Promise<void>;

/** Configuration for the OTel connector. */
export interface OtelConnectorOptions {
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

/** Attribute mapping: record field → OTel attribute key + extractor. */
const ATTR_MAP: readonly {
  key: string;
  get: (r: TraceRecord) => string | undefined;
}[] = [
  { get: (r) => r.trailId, key: 'trails.trail.id' },
  { get: (r) => r.intent, key: 'trails.intent' },
  { get: (r) => r.trailhead, key: 'trails.trailhead' },
  { get: (r) => r.permit?.id, key: 'trails.permit.id' },
  { get: (r) => r.permit?.tenantId, key: 'trails.permit.tenant_id' },
];

/** Build the trails-namespaced attributes from a TraceRecord. */
const buildAttributes = (
  record: TraceRecord
): Record<string, string | number | boolean> => {
  const attrs: Record<string, string | number | boolean> = {};
  for (const { key, get } of ATTR_MAP) {
    const val = get(record);
    if (val !== undefined) {
      attrs[key] = val;
    }
  }
  for (const [key, val] of Object.entries(record.attrs)) {
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
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
  /** Flush any remaining buffered spans to the exporter. */
  readonly flush: () => Promise<void>;
}

/**
 * Create a TraceSink that translates Tracing to OTel spans.
 *
 * The connector maps Trails-native fields to OpenTelemetry span attributes
 * under a `trails.*` namespace. Pass any OTel-compatible exporter callback
 * to forward spans to your collector.
 *
 * Translates and exports spans on each write. Call `flush()` on shutdown
 * to send any remaining buffered spans.
 */
export const createOtelConnector = (
  options: OtelConnectorOptions
): OtelSink => {
  const batchSize = options.batchSize ?? 1;
  const buffer: OtelSpan[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer.splice(0);
    try {
      await options.exporter(batch);
    } catch (error) {
      // Restore batch on exporter failure so data is not lost
      buffer.unshift(...batch);
      throw error;
    }
  };

  return {
    flush,
    write: async (record: TraceRecord): Promise<void> => {
      buffer.push(toOtelSpan(record));
      if (buffer.length >= batchSize) {
        await flush();
      }
    },
  };
};
