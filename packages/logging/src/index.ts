// Logger
export { createLogger } from './logger.js';

// Re-exports from core
export type { Logger } from '@ontrails/core';

// Sinks and formatters
export { createConsoleSink, createFileSink } from './sinks.js';
export { createJsonFormatter, createPrettyFormatter } from './formatters.js';

// Level resolution
export { resolveLogLevel } from './env.js';

// Levels
export { LEVEL_PRIORITY, shouldLog, resolveCategory } from './levels.js';

// Types
export type {
  LogLevel,
  LogMetadata,
  LogRecord,
  LoggerConfig,
  LogSink,
  LogFormatter,
  ConsoleSinkOptions,
  FileSinkOptions,
  PrettyFormatterOptions,
} from './types.js';
