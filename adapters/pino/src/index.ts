import pino from 'pino';
import type { DestinationStream, Logger, LoggerOptions } from 'pino';

import type { LogLevel, LogRecord, LogSink } from '@ontrails/observability';

export interface PinoSinkOptions {
  /** Destination used only when this adapter constructs the Pino logger itself. */
  readonly destination?: DestinationStream | undefined;
  /** Existing configured Pino logger to receive Trails records. */
  readonly logger?: Logger | undefined;
  /** Options used only when this adapter constructs the Pino logger itself. */
  readonly pinoOptions?: LoggerOptions | undefined;
  /** Sink name exposed to Trails observe configuration. Defaults to `pino`. */
  readonly name?: string | undefined;
}

export interface PinoLogSink extends LogSink {
  /** Flush an asynchronously buffered Pino destination, when one is present. */
  flush(): Promise<void>;
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

/* oxlint-disable eslint-plugin-promise/avoid-new, eslint-plugin-promise/prefer-await-to-callbacks -- Pino exposes callback-only flush completion; the Trails sink contract is promise-based. */
const flush = (logger: Logger): Promise<void> =>
  new Promise((resolve, reject) => {
    logger.flush((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
/* oxlint-enable eslint-plugin-promise/avoid-new, eslint-plugin-promise/prefer-await-to-callbacks */

const resolveLogger = (options: PinoSinkOptions): Logger => {
  if (options.logger !== undefined) {
    return options.logger;
  }
  if (options.destination !== undefined) {
    return pino(options.pinoOptions ?? {}, options.destination);
  }
  return options.pinoOptions === undefined ? pino() : pino(options.pinoOptions);
};

/**
 * Create a Trails sink backed by a real Pino logger. If no logger is supplied,
 * the adapter constructs one from `pinoOptions`; applications remain free to
 * own destinations, transports, and richer Pino configuration directly.
 */
export const createPinoSink = (options: PinoSinkOptions = {}): PinoLogSink => {
  const logger = resolveLogger(options);

  return {
    flush: async (): Promise<void> => await flush(logger),
    name: options.name ?? 'pino',
    write(record: LogRecord): void {
      const method = LEVEL_MAP[record.level];
      if (method === undefined) {
        return;
      }
      logger[method](buildPayload(record), record.message);
    },
  };
};
