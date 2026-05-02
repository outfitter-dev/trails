import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LogFormatter, LogRecord, LogSink } from '@ontrails/core';
import { createJsonFormatter } from './formatters.js';

export interface ConsoleSinkOptions {
  /** Formatter to use. Defaults to newline-delimited JSON. */
  readonly formatter?: LogFormatter | undefined;
  /** Send every record to stderr. Defaults to false. */
  readonly stderr?: boolean | undefined;
}

export interface FileSinkOptions {
  /** Formatter to use. Defaults to newline-delimited JSON. */
  readonly formatter?: LogFormatter | undefined;
}

export interface FileSinkConfig extends FileSinkOptions {
  /** Path to the append-only log file. */
  readonly path: string;
}

export interface FileLogSink extends LogSink {
  /** Flush pending bytes to disk. */
  flush(): Promise<void>;
  /** Flush pending bytes and close the underlying file handle. */
  close(): Promise<void>;
}

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error';

const CONSOLE_METHOD: Record<string, ConsoleMethod | undefined> = {
  debug: 'debug',
  error: 'error',
  fatal: 'error',
  info: 'info',
  silent: undefined,
  trace: 'debug',
  warn: 'warn',
};

/**
 * Create a log sink that writes records to console methods by level.
 *
 * Trace/debug records use `console.debug`, info uses `console.info`, warn uses
 * `console.warn`, and error/fatal use `console.error`. Set `stderr: true` to
 * route every record to `console.error`.
 */
export const createConsoleSink = (
  options: ConsoleSinkOptions = {}
): LogSink => {
  const formatter = options.formatter ?? createJsonFormatter();
  const allStderr = options.stderr === true;

  return {
    name: 'console',
    write(record: LogRecord): void {
      // Always consult the level mapping first so `silent` records are dropped
      // regardless of stderr routing. Falling back to `error` when stderr
      // routing is enabled preserves the documented behavior for every other
      // level while keeping `silent` semantics intact.
      const levelMethod = CONSOLE_METHOD[record.level];
      if (levelMethod === undefined) {
        return;
      }
      const method = allStderr ? 'error' : levelMethod;
      console[method](formatter.format(record));
    },
  };
};

const normalizeFileConfig = (
  pathOrOptions: string | FileSinkConfig,
  options: FileSinkOptions | undefined
): FileSinkConfig => {
  if (typeof pathOrOptions === 'string') {
    return {
      ...options,
      path: pathOrOptions,
    };
  }
  return pathOrOptions;
};

const ensureFileParentDirectory = (path: string): void => {
  const parent = dirname(path);
  if (parent === '.' || parent === '') {
    return;
  }
  mkdirSync(parent, { recursive: true });
};

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/**
 * Create an append-only log sink backed by `Bun.file().writer()`.
 *
 * @remarks
 * This zero-dependency sink does not rotate log files. Pair it with external
 * log rotation or use a production connector when retention policy matters.
 */
export function createFileSink(
  path: string,
  options?: FileSinkOptions
): FileLogSink;
export function createFileSink(options: FileSinkConfig): FileLogSink;
export function createFileSink(
  pathOrOptions: string | FileSinkConfig,
  options?: FileSinkOptions
): FileLogSink {
  const config = normalizeFileConfig(pathOrOptions, options);
  const formatter = config.formatter ?? createJsonFormatter();
  ensureFileParentDirectory(config.path);
  const fileDescriptor = openSync(config.path, 'a');
  const writer = Bun.file(fileDescriptor).writer();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) {
      throw new Error('Cannot write to a closed file sink');
    }
  };

  return {
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      // `writer.end()` may throw (e.g. write-back failures on a backing fd).
      // We still need to release the file descriptor, but `closeSync` itself
      // can throw too (EBADF, EIO). The original `writer.end()` failure is
      // the more useful diagnostic, so capture it first and surface it as the
      // primary error; any cleanup failure becomes a `cause` annotation.
      try {
        await writer.end();
      } catch (endError) {
        // writer.end() failed. Still attempt to release the descriptor; if
        // that also fails, attach it as `cause` so the original error wins
        // but the cleanup failure is not silently swallowed.
        const primary = toError(endError);
        try {
          closeSync(fileDescriptor);
        } catch (closeError) {
          if (primary.cause === undefined) {
            try {
              (primary as { cause?: unknown }).cause = toError(closeError);
            } catch {
              // Some Error subclasses freeze `cause`; best-effort attachment.
            }
          }
        }
        throw primary;
      }
      // writer.end() succeeded; surface any closeSync failure directly.
      closeSync(fileDescriptor);
    },
    async flush(): Promise<void> {
      if (closed) {
        return;
      }
      await writer.flush();
    },
    name: 'file',
    write(record: LogRecord): void {
      assertOpen();
      // Bun's `FileSink.write()` returns the number of bytes written and
      // throws synchronously on failure (e.g. EBADF). Discarding the byte
      // count is intentional — it is not a backpressure signal and not an
      // error code. Synchronous failures propagate to the caller naturally.
      writer.write(`${formatter.format(record)}\n`);
    },
  };
}
