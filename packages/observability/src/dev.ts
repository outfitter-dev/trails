/**
 * Developer-state observability tools.
 *
 * This subpath owns local trace storage, query trails, and sampling state.
 * Core retains the runtime trace record and sink registry contracts.
 */
export { DEFAULT_SAMPLING, shouldSample } from './dev/sampling.js';
export type { SamplingConfig } from './dev/sampling.js';
export { tracingResource } from './dev/tracing-resource.js';
export { tracingQuery } from './dev/trails/tracing-query.js';
export { tracingStatus } from './dev/trails/tracing-status.js';
export {
  clearTraceStore,
  clearTracingState,
  getTraceStore,
  getTracingState,
  registerTraceStore,
  registerTracingState,
} from './dev/tracing-state.js';
export type { TracingState } from './dev/tracing-state.js';
export { createDevStore, toTraceStore } from './dev/store.js';
export type {
  DevStore,
  DevStoreOptions,
  DevStoreQueryOptions,
  TraceStore,
} from './dev/store.js';
export {
  applyTraceCleanup,
  countTraceRecords,
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_RECORDS,
  ensureTraceSchema,
  previewTraceCleanup,
  withTraceStoreDb,
} from './dev/internal/dev-state.js';
export type { TraceCleanupReport } from './dev/internal/dev-state.js';
