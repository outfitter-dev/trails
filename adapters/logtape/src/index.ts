import { getLogger } from '@logtape/logtape';
import type { Logger } from '@logtape/logtape';

import type { LogLevel, LogRecord, LogSink } from '@ontrails/observability';

export interface LogtapeSinkOptions {
  /** Existing configured LogTape logger. The application owns LogTape setup. */
  readonly logger?: Logger | undefined;
  /** Sink name exposed to Trails observe configuration. Defaults to `logtape`. */
  readonly name?: string | undefined;
}

type ForwardMethod = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

const LEVEL_MAP: Record<LogLevel, ForwardMethod | undefined> = {
  debug: 'debug',
  error: 'error',
  fatal: 'fatal',
  info: 'info',
  silent: undefined,
  trace: 'trace',
  warn: 'warning',
};

const buildProperties = (record: LogRecord): Record<string, unknown> => ({
  ...record.metadata,
  category: record.category,
  timestamp: record.timestamp.toISOString(),
});

/**
 * Create a Trails sink backed by LogTape. The adapter deliberately never calls
 * `configure()`: libraries read the application-owned logger configuration.
 */
export const createLogtapeSink = (
  options: LogtapeSinkOptions = {}
): LogSink => {
  const configuredLogger = options.logger;

  return {
    name: options.name ?? 'logtape',
    write(record: LogRecord): void {
      const method = LEVEL_MAP[record.level];
      if (method === undefined) {
        return;
      }
      const logger =
        configuredLogger ??
        getLogger(record.category.split('.').filter(Boolean));
      logger.emit({
        level: method,
        message: [record.message],
        properties: buildProperties(record),
        rawMessage: record.message,
        timestamp: record.timestamp.getTime(),
      });
    },
  };
};
