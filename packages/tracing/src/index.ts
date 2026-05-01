// Core tracing primitives — re-exported from @ontrails/core so existing
// imports of these symbols from @ontrails/tracing keep working.
export {
  type TraceContext,
  type TraceFn,
  type TraceRecord,
  type TraceSink,
  clearTraceSink,
  createTraceRecord,
  getTraceContext,
  getTraceSink,
  NOOP_SINK,
  registerTraceSink,
  TRACE_CONTEXT_KEY,
} from '@ontrails/core';

export {
  type SignalTraceRecordName,
  createSignalTraceRecord,
  writeSignalTraceRecord,
} from './signal-trace.js';

// Tracing-package-owned utilities
export { createMemorySink } from './memory-sink.js';
export { createChildTraceContext } from './trace-context.js';
export {
  shouldSample,
  DEFAULT_SAMPLING,
  type SamplingConfig,
} from './sampling.js';

// Public resource + trails
export { tracingResource } from './tracing-resource.js';
export { tracingStatus } from './trails/tracing-status.js';
export { tracingQuery } from './trails/tracing-query.js';

// Bootstrap state registry
export {
  clearTraceStore,
  clearTracingState,
  getTraceStore,
  getTracingState,
  registerTraceStore,
  registerTracingState,
  type TracingState,
} from './tracing-state.js';

// Dev store
export {
  createDevStore,
  type DevStore,
  type DevStoreOptions,
  type DevStoreQueryOptions,
  type TraceStore,
  toTraceStore,
} from './stores/dev.js';
export {
  applyTraceCleanup,
  countTraceRecords,
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_RECORDS,
  ensureTraceSchema,
  previewTraceCleanup,
  withTraceStoreDb,
} from './internal/dev-state.js';
export type { TraceCleanupReport } from './internal/dev-state.js';

// OTel connector
export {
  createOtelConnector,
  type OtelConnectorOptions,
  type OtelExporter,
  type OtelSink,
  type OtelSpan,
} from './connectors/otel.js';
