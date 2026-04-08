// Core tracing primitives — re-exported from @ontrails/core so existing
// imports of these symbols from @ontrails/tracing keep working.
export {
  TRACE_CONTEXT_KEY,
  type TraceContext,
  type TraceFn,
  type TraceRecord,
  type TraceSink,
  type TraceSinkLike,
  clearTraceSink,
  createTraceRecord,
  getTraceContext,
  getTraceSink,
  registerTraceSink,
} from '@ontrails/core';

// Tracing-package-owned utilities
export { createMemorySink } from './memory-sink.js';
export { childTraceContext } from './trace-context.js';
export {
  shouldSample,
  DEFAULT_SAMPLING,
  type SamplingConfig,
} from './sampling.js';

// Public provision + trails
export { tracingProvision } from './tracing-provision.js';
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

// OTel connector
export {
  createOtelConnector,
  type OtelConnectorOptions,
  type OtelExporter,
  type OtelSink,
  type OtelSpan,
} from './connectors/otel.js';
