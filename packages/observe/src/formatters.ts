import type { LogFormatter, LogRecord } from '@ontrails/core';

export interface PrettyFormatterOptions {
  /** Show timestamps. Defaults to true. */
  readonly timestamps?: boolean | undefined;
  /** Use ANSI colors. Defaults to false for deterministic output. */
  readonly colors?: boolean | undefined;
}

/**
 * Build a JSON.stringify replacer that:
 *  - serializes BigInt as a decimal string,
 *  - replaces functions/symbols with a tagged sentinel,
 *  - breaks circular references with a sentinel rather than throwing.
 *
 * Circular detection tracks the *ancestor path* from root to the current
 * value rather than the set of all previously visited objects. This lets
 * a metadata payload reuse the same nested object in multiple sibling
 * positions (for example `{ a: shared, b: shared }`) without the second
 * occurrence being mislabelled as `[Circular]`. JSON.stringify invokes
 * the replacer with `this` bound to the immediate parent, so we can
 * maintain a path stack by popping entries until the top matches the
 * current parent before deciding whether the new value is on that path.
 *
 * The replacer is created per `JSON.stringify` invocation so the path
 * stack does not leak across log records or between metadata entries.
 */
const createSafeReplacer = (): ((
  this: unknown,
  key: string,
  value: unknown
) => unknown) => {
  const path: object[] = [];
  return function safeReplacer(
    this: unknown,
    _key: string,
    value: unknown
  ): unknown {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return '[Function]';
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (typeof value !== 'object' || value === null) {
      return value;
    }
    // Pop entries that are no longer ancestors of the current value.
    // JSON.stringify's depth-first walk binds `this` to the immediate
    // parent, so anything above `this` on the stack has been left.
    while (path.length > 0 && path.at(-1) !== this) {
      path.pop();
    }
    if (path.includes(value)) {
      return '[Circular]';
    }
    path.push(value);
    return value;
  };
};

/**
 * Format log records as newline-delimited JSON objects.
 *
 * Metadata values that JSON.stringify cannot natively serialize are sanitized
 * to safe representations: `BigInt` becomes its decimal string, functions and
 * symbols are tagged sentinels, and circular references are replaced with
 * `"[Circular]"` rather than throwing. The formatter never throws on a
 * structurally valid `LogRecord`.
 */
export const createJsonFormatter = (): LogFormatter => ({
  format(record: LogRecord): string {
    const { category, level, message, metadata, timestamp } = record;
    return JSON.stringify(
      {
        ...metadata,
        category,
        level,
        message,
        timestamp: timestamp.toISOString(),
      },
      createSafeReplacer()
    );
  },
});

const LEVEL_COLORS: Record<string, string> = {
  debug: '\u001B[36m',
  error: '\u001B[31m',
  fatal: '\u001B[35m',
  info: '\u001B[32m',
  trace: '\u001B[90m',
  warn: '\u001B[33m',
};

const RESET = '\u001B[0m';

const formatTimestamp = (timestamp: Date): string =>
  `${timestamp.toISOString().slice(11, 19)} `;

const formatMetadata = (metadata: Record<string, unknown>): string => {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return '';
  }
  // Use the same safe replacer as the JSON formatter so BigInt, functions,
  // symbols, and circular references never throw from the pretty path.
  // The replacer is created per `format` call so the ancestor path stack
  // does not leak across log records. The stack self-resets at the start
  // of each `JSON.stringify` invocation because the new call's wrapper is
  // a fresh object that does not match anything left on the stack, so the
  // pop-loop drains it before the first value is inspected. Wrapping each
  // value in an array ensures the replacer observes top-level BigInt,
  // function, and symbol values, which `JSON.stringify` would otherwise
  // drop or throw on before invoking it.
  const replacer = createSafeReplacer();
  return `  ${entries
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}=${value}`;
      }
      const wrapped = JSON.stringify([value], replacer);
      // Strip the surrounding `[` and `]` from the wrapped array form.
      const display = wrapped.slice(1, -1);
      return `${key}=${display}`;
    })
    .join(' ')}`;
};

const formatLevel = (level: string, useColors: boolean): string => {
  const label = level.toUpperCase().padEnd(5);
  if (!useColors) {
    return label;
  }
  const color = LEVEL_COLORS[level] ?? '';
  return `${color}${label}${RESET}`;
};

/** Format log records for human-readable local output. */
export const createPrettyFormatter = (
  options: PrettyFormatterOptions = {}
): LogFormatter => {
  const showTimestamps = options.timestamps !== false;
  const useColors = options.colors === true;

  return {
    format(record: LogRecord): string {
      const prefix = showTimestamps ? formatTimestamp(record.timestamp) : '';
      const level = formatLevel(record.level, useColors);
      const metadata = formatMetadata(record.metadata);
      const body = `${level} [${record.category}] ${record.message}`;
      return metadata.length > 0
        ? `${prefix}${body}${metadata}`
        : `${prefix}${body}`;
    },
  };
};
