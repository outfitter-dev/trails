import type { LogRecord, LogSink } from './index.js';

/**
 * Subset of the LogTape logger interface that we forward records to.
 * Accepts any object that provides the standard log-level methods.
 */
export interface LogtapeLoggerLike {
  trace(message: string, props?: Record<string, unknown>): void;
  debug(message: string, props?: Record<string, unknown>): void;
  info(message: string, props?: Record<string, unknown>): void;
  warn(message: string, props?: Record<string, unknown>): void;
  error(message: string, props?: Record<string, unknown>): void;
  fatal(message: string, props?: Record<string, unknown>): void;
}

export interface LogtapeSinkOptions {
  /** An existing LogTape logger (or compatible object) to forward records to. */
  readonly logger: LogtapeLoggerLike;
}

type ForwardMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_MAP: Record<string, ForwardMethod> = {
  debug: 'debug',
  error: 'error',
  fatal: 'fatal',
  info: 'info',
  trace: 'trace',
  warn: 'warn',
};

/**
 * Sink adapter that forwards `LogRecord` instances to an existing LogTape
 * logger. Redaction runs before the sink receives records, so sensitive data is
 * scrubbed regardless of the backend.
 */
export const createLogtapeSink = (options: LogtapeSinkOptions): LogSink => {
  const { logger } = options;

  return {
    name: 'logtape',
    write(record: LogRecord): void {
      const method = LEVEL_MAP[record.level];
      if (method === undefined) {
        return;
      }

      const props: Record<string, unknown> = {
        category: record.category,
        ...record.metadata,
      };

      logger[method](record.message, props);
    },
  };
};
