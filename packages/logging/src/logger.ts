import {
  createRedactor,
  DEFAULT_PATTERNS,
  DEFAULT_SENSITIVE_KEYS,
} from '@ontrails/core/redaction';

import type { Logger } from '@ontrails/core';

import { resolveLogLevel } from './env.js';
import { resolveCategory, shouldLog } from './levels.js';
import { createConsoleSink } from './sinks.js';
import type {
  LogLevel,
  LogMetadata,
  LoggerConfig,
  LogRecord,
  LogSink,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal instance builder
// ---------------------------------------------------------------------------

interface RedactorLike {
  redact(value: string): string;
  redactObject<T extends Record<string, unknown>>(obj: T): T;
}

interface BuildInstanceConfig {
  readonly baseLevel: LogLevel;
  readonly levels: Record<string, LogLevel> | undefined;
}

const buildInstance = (
  name: string,
  effectiveLevel: LogLevel,
  redactor: RedactorLike,
  sinks: readonly LogSink[],
  // oxlint-disable-next-line only-used-in-recursion
  config: BuildInstanceConfig,
  baseMetadata: Record<string, unknown>
): Logger => {
  const log = (
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): void => {
    if (!shouldLog(level, effectiveLevel)) {
      return;
    }

    const mergedMeta: Record<string, unknown> = {
      ...baseMetadata,
      ...metadata,
    };

    const record: LogRecord = {
      category: name,
      level,
      message: redactor.redact(message),
      metadata:
        Object.keys(mergedMeta).length > 0
          ? redactor.redactObject(mergedMeta)
          : {},
      timestamp: new Date(),
    };

    for (const sink of sinks) {
      sink.write(record);
    }
  };

  return {
    child(metadata: LogMetadata): Logger {
      return buildInstance(name, effectiveLevel, redactor, sinks, config, {
        ...baseMetadata,
        ...metadata,
      });
    },
    debug(message: string, metadata?: LogMetadata): void {
      log('debug', message, metadata);
    },
    error(message: string, metadata?: LogMetadata): void {
      log('error', message, metadata);
    },
    fatal(message: string, metadata?: LogMetadata): void {
      log('fatal', message, metadata);
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
// createLogger
// ---------------------------------------------------------------------------

/**
 * Create a structured logger with hierarchical category filtering,
 * automatic redaction, and pluggable sinks.
 *
 * This is the **only** API for creating loggers in `@ontrails/logging`.
 */
export const createLogger = (config: LoggerConfig): Logger => {
  const envLevel = resolveLogLevel();
  const baseLevel: LogLevel = config.level ?? envLevel ?? 'info';
  const effectiveLevel = resolveCategory(config.name, config.levels, baseLevel);

  const redactor = createRedactor({
    patterns: [...DEFAULT_PATTERNS, ...(config.redaction?.patterns ?? [])],
    sensitiveKeys: [
      ...DEFAULT_SENSITIVE_KEYS,
      ...(config.redaction?.sensitiveKeys ?? []),
    ],
  });

  const sinks: readonly LogSink[] = config.sinks ?? [createConsoleSink()];

  return buildInstance(
    config.name,
    effectiveLevel,
    redactor,
    sinks,
    { baseLevel, levels: config.levels },
    {}
  );
};
