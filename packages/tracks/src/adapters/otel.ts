import type { TrackRecord } from '../record.js';
import type { TrackSink } from '../tracks-layer.js';

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
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

/** Callback that receives translated OTel spans. */
export type OtelExporter = (spans: readonly OtelSpan[]) => void | Promise<void>;

/** Configuration for the OTel adapter. */
export interface OtelAdapterOptions {
  readonly exporter: OtelExporter;
  readonly batchSize?: number;
}

/** Map from TrackRecord status to OTel status. */
const STATUS_MAP: Record<TrackRecord['status'], OtelSpan['status']> = {
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
  get: (r: TrackRecord) => string | undefined;
}[] = [
  { get: (r) => r.trailId, key: 'trails.trail.id' },
  { get: (r) => r.intent, key: 'trails.intent' },
  { get: (r) => r.surface, key: 'trails.surface' },
  { get: (r) => r.permit?.id, key: 'trails.permit.id' },
  { get: (r) => r.permit?.tenantId, key: 'trails.permit.tenant_id' },
];

/** Build the trails-namespaced attributes from a TrackRecord. */
const buildAttributes = (
  record: TrackRecord
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

/** Translate a TrackRecord into an OTel span. */
const toOtelSpan = (record: TrackRecord): OtelSpan => ({
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

/** A TrackSink extended with an explicit flush for shutdown. */
export interface OtelSink extends TrackSink {
  /** Flush any remaining buffered spans to the exporter. */
  readonly flush: () => Promise<void>;
}

/**
 * Create a TrackSink that translates TrackRecords to OTel spans.
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
    write: async (record: TrackRecord): Promise<void> => {
      buffer.push(toOtelSpan(record));
      if (buffer.length >= batchSize) {
        await flush();
      }
    },
  };
};
