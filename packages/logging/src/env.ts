import { LEVEL_PRIORITY } from './levels.js';
import type { LogLevel } from './types.js';

// ---------------------------------------------------------------------------
// Valid log level set (for validation)
// ---------------------------------------------------------------------------

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_PRIORITY));

const isValidLogLevel = (value: string): value is LogLevel =>
  VALID_LEVELS.has(value);

// ---------------------------------------------------------------------------
// deriveLogLevel
// ---------------------------------------------------------------------------

/**
 * Resolve log level from environment variables.
 *
 * 1. `TRAILS_LOG_LEVEL` -- explicit override (if valid).
 * 2. `TRAILS_ENV` profile defaults:
 *    - `development` -> `"debug"`
 *    - `test` -> `undefined` (no logging by default)
 *    - `production` -> `undefined` (caller falls through to `"info"`)
 * 3. `undefined` -- no env-based level configured.
 */
export const deriveLogLevel = (
  env?: Record<string, string | undefined>
): LogLevel | undefined => {
  const source = env ?? process.env;

  // 1. Explicit override
  const explicit = source['TRAILS_LOG_LEVEL'];
  if (explicit !== undefined && isValidLogLevel(explicit)) {
    return explicit;
  }

  // 2. Profile defaults
  const profile = source['TRAILS_ENV'];
  if (profile === 'development') {
    return 'debug';
  }
  if (profile === 'test') {
    return undefined;
  }

  // production and everything else -- no opinion
  return undefined;
};
