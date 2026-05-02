import { ValidationError } from './errors.js';
import type { TraceSink } from './internal/tracing.js';
import type { Logger, LogLevel, LogSink } from './types.js';

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
    // routes it via the `isTraceSink` fallthrough. A LogSink shape is
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
 * trailing argument is unambiguously routed to options.
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

export const normalizeObserve = (
  observe: ObserveInput | undefined
): ObserveConfig | undefined => {
  if (observe === undefined) {
    return undefined;
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
