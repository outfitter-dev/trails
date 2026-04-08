export { type TraceRecord, createTraceRecord } from './trace-record.js';
export {
  clearTraceSink,
  getTraceSink,
  registerTraceSink,
  type TraceSinkLike,
} from '@ontrails/core';
export {
  createTracingLayer,
  type TracingLayerOptions,
  type TraceSink,
} from './tracing-layer.js';
export { createMemorySink } from './memory-sink.js';
export {
  type TraceContext,
  getTraceContext,
  childTraceContext,
  TRACE_CONTEXT_KEY,
} from './trace-context.js';
export {
  shouldSample,
  DEFAULT_SAMPLING,
  type SamplingConfig,
} from './sampling.js';
export {
  createTracingApi,
  TRACING_API_KEY,
  type TracingApi,
  type TracingApiWithState,
} from './tracing-api.js';
export { tracing } from './tracing-accessor.js';
export { tracingResource } from './tracing-resource.js';
export { tracingStatus } from './trails/tracing-status.js';
export { tracingQuery } from './trails/tracing-query.js';
export {
  clearTraceStore,
  clearTracingState,
  getTraceStore,
  getTracingState,
  registerTraceStore,
  registerTracingState,
  type TracingState,
} from './tracing-state.js';
export {
  createDevStore,
  type DevStore,
  type DevStoreOptions,
  type DevStoreQueryOptions,
  type TraceStore,
  toTraceStore,
} from './stores/dev.js';
export {
  createOtelConnector,
  type OtelConnectorOptions,
  type OtelExporter,
  type OtelSink,
  type OtelSpan,
} from './connectors/otel.js';
