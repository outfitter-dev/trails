import type { LogLevel, LogRecord, LogSink } from './index.js';

/**
 * Package identifier for the supported Pino adapter subpath.
 */
export const pinoPackageName = '@ontrails/observe/pino';

/**
 * Signature for a Pino-compatible logger method used when forwarding Trails
 * records.
 */
export type PinoLogMethod = (
  payload: Record<string, unknown>,
  message?: string
) => void;

/**
 * Structural subset of a Pino logger.
 */
export interface PinoLoggerLike {
  debug: PinoLogMethod;
  error: PinoLogMethod;
  fatal: PinoLogMethod;
  info: PinoLogMethod;
  trace: PinoLogMethod;
  warn: PinoLogMethod;
}

export interface PinoSinkOptions {
  /** Sink name exposed to Trails observe configuration. Defaults to `pino`. */
  readonly name?: string | undefined;
}

type ForwardMethod = Exclude<LogLevel, 'silent'>;

const LEVEL_MAP: Record<LogLevel, ForwardMethod | undefined> = {
  debug: 'debug',
  error: 'error',
  fatal: 'fatal',
  info: 'info',
  silent: undefined,
  trace: 'trace',
  warn: 'warn',
};

const buildPayload = (record: LogRecord): Record<string, unknown> => ({
  ...record.metadata,
  category: record.category,
  timestamp: record.timestamp.toISOString(),
});

const resolveLoggerMethod = (
  logger: PinoLoggerLike,
  method: ForwardMethod
): PinoLogMethod => {
  const loggerMethod = logger[method];
  if (typeof loggerMethod !== 'function') {
    throw new TypeError(`Pino logger is missing "${method}" method`);
  }
  return loggerMethod.bind(logger);
};

const resolveLoggerMethods = (
  logger: PinoLoggerLike
): Record<ForwardMethod, PinoLogMethod> => ({
  debug: resolveLoggerMethod(logger, 'debug'),
  error: resolveLoggerMethod(logger, 'error'),
  fatal: resolveLoggerMethod(logger, 'fatal'),
  info: resolveLoggerMethod(logger, 'info'),
  trace: resolveLoggerMethod(logger, 'trace'),
  warn: resolveLoggerMethod(logger, 'warn'),
});

/**
 * Create a Trails log sink that forwards records to a structural Pino logger.
 */
export const createPinoSink = (
  logger: PinoLoggerLike,
  options: PinoSinkOptions = {}
): LogSink => {
  const methods = resolveLoggerMethods(logger);

  return {
    name: options.name ?? 'pino',
    write(record: LogRecord): void {
      const method = LEVEL_MAP[record.level];
      if (method === undefined) {
        return;
      }

      methods[method](buildPayload(record), record.message);
    },
  };
};
