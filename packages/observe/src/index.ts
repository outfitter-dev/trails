/**
 * Primitive observability API for Trails.
 *
 * `@ontrails/observe` is the public package for log and trace sink contracts.
 * Connector packages should build on these types instead of importing
 * framework internals directly.
 *
 * @see {@link https://github.com/outfitter-dev/trails/blob/main/docs/adr/0041-unified-observability.md | ADR-0041 Unified Observability}
 */
export { combine } from './combine.js';
export type { CombinedSink } from './combine.js';

export type {
  Logger,
  LogFormatter,
  LogLevel,
  LogRecord,
  LogSink,
  ObserveCapabilities,
  ObserveConfig,
  ObserveInput,
  TraceContext,
  TraceRecord,
  TraceSink,
} from '@ontrails/core';
