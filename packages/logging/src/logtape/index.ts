import type { LogRecord, LogSink } from '../types.js';

// ---------------------------------------------------------------------------
// Minimal logtape logger interface (avoids importing @logtape/logtape)
// ---------------------------------------------------------------------------

/**
 * Subset of the logtape Logger interface that we forward records to.
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LogtapeSinkOptions {
  /** An existing logtape logger (or compatible object) to forward records to. */
  readonly logger: LogtapeLoggerLike;
}

// ---------------------------------------------------------------------------
// logtapeSink
// ---------------------------------------------------------------------------

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
 * Sink adapter that forwards `LogRecord` instances to an existing logtape
 * logger. Redaction runs _before_ the sink receives records, so sensitive
 * data is scrubbed regardless of the backend.
 */
export const logtapeSink = (options: LogtapeSinkOptions): LogSink => {
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
