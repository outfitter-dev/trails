import { createJsonFormatter, createPrettyFormatter } from './formatters.js';
import type {
  ConsoleSinkOptions,
  FileSinkOptions,
  LogRecord,
  LogSink,
} from './types.js';

// ---------------------------------------------------------------------------
// Console Sink
// ---------------------------------------------------------------------------

const CONSOLE_METHOD: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  error: 'error',
  fatal: 'error',
  info: 'info',
  trace: 'debug',
  warn: 'warn',
};

/**
 * Sink that writes to `console.*` methods.
 *
 * By default, uses `createPrettyFormatter()` when `TRAILS_ENV` is
 * `"development"` and `createJsonFormatter()` otherwise.
 */
export const createConsoleSink = (options?: ConsoleSinkOptions): LogSink => {
  const isDev = process.env['TRAILS_ENV'] === 'development';
  const formatter =
    options?.formatter ??
    (isDev ? createPrettyFormatter() : createJsonFormatter());
  const allStderr = options?.stderr === true;

  return {
    name: 'console',
    write(record: LogRecord): void {
      const output = formatter.format(record);
      const method = CONSOLE_METHOD[record.level] ?? 'info';

      if (allStderr) {
        console.error(output);
      } else {
        console[method](output);
      }
    },
  };
};

// ---------------------------------------------------------------------------
// File Sink
// ---------------------------------------------------------------------------

/**
 * Sink that appends log records to a file using `Bun.file()`.
 */
export const createFileSink = (options: FileSinkOptions): LogSink => {
  const formatter = options.formatter ?? createJsonFormatter();
  const writer = Bun.file(options.path).writer();

  return {
    async flush(): Promise<void> {
      await writer.flush();
    },
    name: 'file',
    write(record: LogRecord): void {
      const output = formatter.format(record);
      writer.write(`${output}\n`);
    },
  };
};
