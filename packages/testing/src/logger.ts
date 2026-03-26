/**
 * Test logger that captures log records for assertion.
 */

import type { LogLevel, LogMetadata, LogRecord } from '@ontrails/logging';

import type { TestLogger } from './types.js';

// ---------------------------------------------------------------------------
// Level ordering for filtering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<string, number> = {
  debug: 1,
  error: 4,
  fatal: 5,
  info: 2,
  silent: 6,
  trace: 0,
  warn: 3,
};

// ---------------------------------------------------------------------------
// Internal factory (shared between root and child loggers)
// ---------------------------------------------------------------------------

const createTestLoggerInternal = (
  name: string,
  minLevel: LogLevel,
  sharedEntries: LogRecord[],
  baseMetadata: LogMetadata
): TestLogger => {
  const minOrder = LEVEL_ORDER[minLevel] ?? 0;

  const shouldLog = (level: LogLevel): boolean =>
    (LEVEL_ORDER[level] ?? 0) >= minOrder;

  const log = (
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): void => {
    if (!shouldLog(level)) {
      return;
    }
    const record: LogRecord = {
      category: name,
      level,
      message,
      metadata: { ...baseMetadata, ...metadata },
      timestamp: new Date(),
    };
    sharedEntries.push(record);
  };

  return {
    assertLogged(level: LogLevel, messageSubstring: string): void {
      const match = sharedEntries.find(
        (r) => r.level === level && r.message.includes(messageSubstring)
      );
      if (match === undefined) {
        throw new Error(
          `Expected a log entry with level="${level}" containing "${messageSubstring}", but none was found. ` +
            `Entries: ${JSON.stringify(sharedEntries.map((r) => ({ level: r.level, message: r.message })))}`
        );
      }
    },

    child(metadata: LogMetadata): TestLogger {
      const merged = { ...baseMetadata, ...metadata };
      return createTestLoggerInternal(name, minLevel, sharedEntries, merged);
    },

    clear(): void {
      sharedEntries.length = 0;
    },

    debug(message: string, metadata?: LogMetadata): void {
      log('debug', message, metadata);
    },

    get entries(): readonly LogRecord[] {
      return sharedEntries;
    },

    error(message: string, metadata?: LogMetadata): void {
      log('error', message, metadata);
    },

    fatal(message: string, metadata?: LogMetadata): void {
      log('fatal', message, metadata);
    },

    find(predicate: (record: LogRecord) => boolean): readonly LogRecord[] {
      return sharedEntries.filter(predicate);
    },

    info(message: string, metadata?: LogMetadata): void {
      log('info', message, metadata);
    },

    name,

    trace(message: string, metadata?: LogMetadata): void {
      log('trace', message, metadata);
    },

    warn(message: string, metadata?: LogMetadata): void {
      log('warn', message, metadata);
    },
  };
};

// ---------------------------------------------------------------------------
// createTestLogger
// ---------------------------------------------------------------------------

/**
 * Create a test logger that captures all log records in an array.
 *
 * Records are not printed. Use `entries`, `find()`, and `assertLogged()`
 * to inspect what was logged during a test.
 */
export const createTestLogger = (options?: { level?: LogLevel }): TestLogger =>
  createTestLoggerInternal('test', options?.level ?? 'trace', [], {});
