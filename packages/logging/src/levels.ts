import type { LogLevel } from './types.js';

// ---------------------------------------------------------------------------
// Level Priority
// ---------------------------------------------------------------------------

export const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 1,
  error: 4,
  fatal: 5,
  info: 2,
  silent: 6,
  trace: 0,
  warn: 3,
};

// ---------------------------------------------------------------------------
// shouldLog
// ---------------------------------------------------------------------------

/**
 * Returns true if a message at `messageLevel` should be emitted given the
 * configured threshold `configuredLevel`.
 */
export const shouldLog = (
  messageLevel: LogLevel,
  configuredLevel: LogLevel
): boolean => LEVEL_PRIORITY[messageLevel] >= LEVEL_PRIORITY[configuredLevel];

// ---------------------------------------------------------------------------
// resolveCategory
// ---------------------------------------------------------------------------

/**
 * Walk up the dot-separated category hierarchy to find the most specific
 * configured level.
 *
 * Example: "app.db.queries" -> "app.db" -> "app" -> fallback
 */
/** Walk up the dot-separated hierarchy looking for a configured level. */
const findLevel = (
  name: string,
  levels: Record<string, LogLevel>
): LogLevel | undefined => {
  let prefix = name;
  while (prefix.length > 0) {
    const level = levels[prefix];
    if (level !== undefined) {
      return level;
    }
    const lastDot = prefix.lastIndexOf('.');
    if (lastDot === -1) {
      break;
    }
    prefix = prefix.slice(0, lastDot);
  }
  return undefined;
};

export const resolveCategory = (
  name: string,
  levels: Record<string, LogLevel> | undefined,
  fallback: LogLevel
): LogLevel => {
  if (!levels) {
    return fallback;
  }
  return findLevel(name, levels) ?? fallback;
};
