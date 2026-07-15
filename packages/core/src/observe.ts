import { ValidationError } from './errors.js';
import type { TraceSink } from './tracing.js';
import type { Layer } from './layer.js';
import { safeStringify } from './serialization.js';
import type { Logger, LogLevel, LogRecord, LogSink } from './types.js';

export interface ObserveConfig {
  readonly log?: Logger | LogSink | undefined;
  readonly trace?: TraceSink | undefined;
}

export interface ObserveCapabilities {
  readonly log?: true | undefined;
  readonly trace?: true | undefined;
}

interface ObserveCapable {
  readonly observes?: ObserveCapabilities | undefined;
}

export type ObserveInput = Logger | LogSink | TraceSink | ObserveConfig;

export interface TopoOptions {
  readonly observe?: ObserveInput | undefined;
  /**
   * Typed layers attached at topo scope.
   *
   * Layers declared here wrap every trail invoked through this topo, on every
   * surface. The execution pipeline composes topo-scope layers outermost —
   * around surface-scope and trail-scope layers — so the final order is
   * `topo → surface → trail → implementation` (outermost-first).
   */
  readonly layers?: readonly Layer[] | undefined;
}

const OBSERVE_CONFIG_KEYS = new Set(['log', 'trace']);
export const OBSERVE_LOGGER_CONTEXT_KEY = '__trails_observe_logger';

/**
 * Context extension key that carries metadata accumulated on the observe
 * logger across rebindings (e.g. signal fan-out metadata such as `consumerId`
 * and `signalId`). When `applyTopoObserveContext` rebinds the logger for a
 * new trail, it merges this metadata into the freshly built observe logger
 * so consumer log records retain provenance back to the triggering signal.
 */
export const OBSERVE_LOGGER_METADATA_KEY = '__trails_observe_logger_metadata';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasFunction = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'function';

export const isLogger = (value: unknown): value is Logger =>
  isObject(value) &&
  hasFunction(value, 'child') &&
  hasFunction(value, 'debug') &&
  hasFunction(value, 'error') &&
  hasFunction(value, 'fatal') &&
  hasFunction(value, 'info') &&
  hasFunction(value, 'trace') &&
  hasFunction(value, 'warn');

export const isLogSink = (value: unknown): value is LogSink =>
  isObject(value) &&
  typeof value['name'] === 'string' &&
  hasFunction(value, 'write');

const readObserveCapabilities = (
  value: unknown
): ObserveCapabilities | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const capabilities = (value as ObserveCapable).observes;
  if (!isObject(capabilities)) {
    return undefined;
  }
  const log = capabilities['log'] === true;
  const trace = capabilities['trace'] === true;
  if (!log && !trace) {
    return undefined;
  }
  return Object.freeze({
    ...(log ? { log: true as const } : {}),
    ...(trace ? { trace: true as const } : {}),
  });
};

export const isTraceSink = (value: unknown): value is TraceSink =>
  isObject(value) && hasFunction(value, 'write');

const isObserveConfigShape = (value: unknown): value is ObserveConfig => {
  if (!isObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => OBSERVE_CONFIG_KEYS.has(key)) &&
    ('log' in value || 'trace' in value)
  );
};

/**
 * Type guard for the `ObserveInput` union. Returns `true` only for shapes
 * that {@link normalizeObserve} will accept without throwing — i.e. a
 * `Logger`, an explicit `ObserveConfig`, or a `TraceSink`. Capability-only
 * payloads (`{ observes: { trace: true } }` without an accompanying
 * `write` method) and bare `LogSink` shorthand are intentionally rejected:
 * the former is metadata about a missing implementation, and the latter
 * is ambiguous between a `LogSink` and a `TraceSink` and is rejected by
 * `normalizeObserve` accordingly. Keeping the guard tighter than the
 * runtime accepts would let callers narrow to `ObserveInput` and then
 * see `normalizeObserve` throw at runtime.
 */
export const isObserveInput = (
  value: unknown
): value is ObserveInput | undefined => {
  if (value === undefined) {
    return true;
  }
  if (isLogger(value)) {
    return true;
  }
  if (isObserveConfigShape(value)) {
    return true;
  }
  if (isTraceSink(value) && !isLogSink(value)) {
    // A bare TraceSink (no `name`) is unambiguous — `normalizeObserve`
    // accepts it via the `isTraceSink` fallthrough. A LogSink shape is
    // ambiguous (matches both guards) and would be rejected by
    // `normalizeObserve`, so the guard rejects it here too.
    return true;
  }
  return false;
};

/**
 * Returns true when `value` carries explicit observe capabilities via the
 * `observes` discriminator. Used by the topo classifier to distinguish
 * an `ObserveCapable` sink (clearly options) from a bare sink (ambiguous
 * with a module export named `observe`).
 */
export const hasObserveCapabilities = (value: unknown): boolean =>
  readObserveCapabilities(value) !== undefined;

/**
 * Returns true when `value` is shaped like the explicit `{ log?, trace? }`
 * `ObserveConfig` payload. Exposed for the topo classifier so a config-style
 * trailing argument is unambiguously classified as options.
 */
export const isObserveConfig = (value: unknown): value is ObserveConfig =>
  isObserveConfigShape(value);

const normalizeLogTarget = (
  target: ObserveConfig['log']
): ObserveConfig['log'] => {
  if (target === undefined || isLogger(target) || isLogSink(target)) {
    return target;
  }
  throw new ValidationError('topo observe.log must be a Logger or LogSink');
};

const normalizeTraceTarget = (
  target: ObserveConfig['trace']
): ObserveConfig['trace'] => {
  if (target === undefined || isTraceSink(target)) {
    return target;
  }
  throw new ValidationError('topo observe.trace must be a TraceSink');
};

/**
 * Maps observe log levels to the `console` method that should receive the
 * formatted record. `silent` is intentionally absent — records at that level
 * are dropped before reaching `console`.
 */
const DEFAULT_SINK_CONSOLE_METHOD: Record<
  LogLevel,
  'debug' | 'error' | 'info' | 'warn' | undefined
> = {
  debug: 'debug',
  error: 'error',
  fatal: 'error',
  info: 'info',
  silent: undefined,
  trace: 'debug',
  warn: 'warn',
};

const stringifyDefaultConsoleRecord = (record: LogRecord): string => {
  const serialized = safeStringify({
    category: record.category,
    level: record.level,
    message: record.message,
    metadata: record.metadata,
    timestamp: record.timestamp.toISOString(),
  });
  if (serialized.isOk()) {
    return serialized.value;
  }
  return JSON.stringify({
    category: record.category,
    level: record.level,
    message: record.message,
    metadata: '[unserializable]',
    timestamp: record.timestamp.toISOString(),
  });
};

/**
 * In-core mirror of `@ontrails/observability`'s `createConsoleSink` shape, kept
 * minimal and private to avoid a reverse dependency from `@ontrails/core`
 * onto `@ontrails/observability`. It mirrors the console level mapping in
 * `packages/observability/src/sinks.ts:50` and emits each record as a single-line
 * JSON object written to the matching `console.{debug|info|warn|error}` method.
 *
 * @remarks
 * Used as the default `observe.log` target when `topo()` is called without an
 * explicit `observe` option, so every app gets a non-null `ctx.logger` with
 * structured stdout output and zero configuration. Apps that want richer
 * formatting, file destinations, or custom sink behavior should pass an explicit
 * `observe` option, which fully replaces this default.
 */
const createDefaultConsoleSink = (): LogSink => ({
  name: 'console',
  write(record): void {
    const method = DEFAULT_SINK_CONSOLE_METHOD[record.level];
    if (method === undefined) {
      return;
    }
    const payload = stringifyDefaultConsoleRecord(record);
    // oxlint-disable-next-line trails-local/no-console-in-packages -- ADR 0041 mandates a default console logger in core; this is the single sanctioned console boundary, mirroring `@ontrails/observability`'s `createConsoleSink`.
    console[method](payload);
  },
});

/**
 * The default observe configuration applied when `topo()` receives no
 * `observe` option. Frozen so callers cannot mutate the shared default; the
 * sink itself is shared across topos because it has no per-topo state.
 */
const DEFAULT_OBSERVE_CONFIG: ObserveConfig = Object.freeze({
  log: createDefaultConsoleSink(),
});

export const normalizeObserve = (
  observe: ObserveInput | undefined
): ObserveConfig | undefined => {
  if (observe === undefined) {
    // ADR 0041 promises a non-null `ctx.logger` with zero configuration.
    // Returning the default config here lets the existing topo → adapter
    // path renders this log sink into `ctx.logger` without a second
    // resolution point or a reverse dependency on `@ontrails/observability`.
    return DEFAULT_OBSERVE_CONFIG;
  }

  const capabilities = readObserveCapabilities(observe);
  if (capabilities !== undefined) {
    const log =
      capabilities.log === true
        ? normalizeLogTarget(observe as Logger | LogSink)
        : undefined;
    const trace =
      capabilities.trace === true
        ? normalizeTraceTarget(observe as TraceSink)
        : undefined;
    return Object.freeze({
      ...(log === undefined ? {} : { log }),
      ...(trace === undefined ? {} : { trace }),
    });
  }

  if (isLogger(observe)) {
    return Object.freeze({ log: observe });
  }

  if (isObserveConfigShape(observe)) {
    const log = normalizeLogTarget(observe.log);
    const trace = normalizeTraceTarget(observe.trace);
    if (log === undefined && trace === undefined) {
      return undefined;
    }
    return Object.freeze({
      ...(log === undefined ? {} : { log }),
      ...(trace === undefined ? {} : { trace }),
    });
  }

  if (isLogSink(observe)) {
    throw new ValidationError(
      'topo observe shorthand is ambiguous for named sinks; use { log: sink } or { trace: sink }'
    );
  }

  if (isTraceSink(observe)) {
    return Object.freeze({ trace: observe });
  }

  throw new ValidationError(
    'topo observe must be a Logger, LogSink, TraceSink, or { log, trace } object'
  );
};

const createLogSinkLogger = (
  sink: LogSink,
  category: string,
  baseMetadata: Record<string, unknown>
): Logger => {
  const write = (
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ): void => {
    sink.write({
      category,
      level,
      message,
      metadata: { ...baseMetadata, ...metadata },
      timestamp: new Date(),
    });
  };

  return {
    child(metadata: Record<string, unknown>): Logger {
      return createLogSinkLogger(sink, category, {
        ...baseMetadata,
        ...metadata,
      });
    },
    debug(message, metadata): void {
      write('debug', message, metadata);
    },
    error(message, metadata): void {
      write('error', message, metadata);
    },
    fatal(message, metadata): void {
      write('fatal', message, metadata);
    },
    info(message, metadata): void {
      write('info', message, metadata);
    },
    name: category,
    trace(message, metadata): void {
      write('trace', message, metadata);
    },
    warn(message, metadata): void {
      write('warn', message, metadata);
    },
  };
};

export const createObserveLogger = (
  log: Logger | LogSink,
  category: string,
  metadata: Record<string, unknown>
): Logger =>
  isLogger(log)
    ? log.child(metadata)
    : createLogSinkLogger(log, category, metadata);
