import type {
  LogFormatter,
  LogRecord,
  PrettyFormatterOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// JSON Formatter
// ---------------------------------------------------------------------------

/**
 * One JSON object per log record, newline-delimited.
 * Metadata fields are flattened into the top-level object.
 */
export const createJsonFormatter = (): LogFormatter => ({
  format(record: LogRecord): string {
    const { level, message, category, timestamp, metadata } = record;
    const obj: Record<string, unknown> = {
      category,
      level,
      message,
      timestamp: timestamp.toISOString(),
      ...metadata,
    };
    return JSON.stringify(obj);
  },
});

// ---------------------------------------------------------------------------
// Pretty Formatter
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<string, string> = {
  debug: '\u001B[36m',
  error: '\u001B[31m',
  fatal: '\u001B[35m',
  info: '\u001B[32m',
  trace: '\u001B[90m',
  warn: '\u001B[33m',
};

const RESET = '\u001B[0m';

const formatMetadata = (metadata: Record<string, unknown>): string => {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return '';
  }
  return `  ${entries
    .map(([k, v]) => {
      const display = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${display}`;
    })
    .join(' ')}`;
};

/**
 * Human-readable formatter.
 *
 * Output: `10:00:00 INFO  [app.entity] Entity created  requestId=abc-123`
 */
const formatTimestamp = (timestamp: Date): string =>
  `${timestamp.toISOString().slice(11, 19)} `;

const formatLevelAndMessage = (
  level: string,
  levelLabel: string,
  category: string,
  message: string,
  useColors: boolean
): string => {
  if (useColors) {
    const color = LEVEL_COLORS[level] ?? '';
    return `${color}${levelLabel}${RESET} [${category}] ${message}`;
  }
  return `${levelLabel} [${category}] ${message}`;
};

export const createPrettyFormatter = (
  options?: PrettyFormatterOptions
): LogFormatter => {
  const showTimestamps = options?.timestamps !== false;
  const useColors = options?.colors ?? process.stdout?.isTTY === true;

  return {
    format(record: LogRecord): string {
      const { level, message, category, timestamp, metadata } = record;
      const levelLabel = level.toUpperCase().padEnd(5);
      const meta = formatMetadata(metadata);
      const prefix = showTimestamps ? formatTimestamp(timestamp) : '';
      const body = formatLevelAndMessage(
        level,
        levelLabel,
        category,
        message,
        useColors
      );
      return meta.length > 0 ? `${prefix}${body}${meta}` : `${prefix}${body}`;
    },
  };
};
