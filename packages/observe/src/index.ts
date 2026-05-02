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
export { createJsonFormatter, createPrettyFormatter } from './formatters.js';
export { createBoundedMemorySink, createMemorySink } from './memory.js';
export { createConsoleSink, createFileSink } from './sinks.js';
export type { CombinedSink } from './combine.js';
export type { PrettyFormatterOptions } from './formatters.js';
export type { MemorySinkOptions, MemoryTraceSink } from './memory.js';
export type {
  ConsoleSinkOptions,
  FileLogSink,
  FileSinkConfig,
  FileSinkOptions,
} from './sinks.js';

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
