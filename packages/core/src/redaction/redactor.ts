/**
 * Redactor — strips sensitive data from strings and objects.
 *
 * @example
 * ```ts
 * const r = createRedactor();
 * r.redact("token: Bearer abc123");         // "token: [REDACTED]"
 * r.redactObject({ password: "s3cret" });   // { password: "[REDACTED]" }
 * ```
 */

import { DEFAULT_PATTERNS, DEFAULT_SENSITIVE_KEYS } from './patterns.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactorConfig {
  readonly patterns?: RegExp[];
  readonly sensitiveKeys?: string[];
  readonly replacement?: string;
}

export interface Redactor {
  /** Replace all pattern matches in a string with the replacement. */
  redact(value: string): string;

  /**
   * Deep-clone `obj` and redact:
   * 1. Values whose key matches a sensitive key (case-insensitive).
   * 2. All remaining string values that match a pattern.
   */
  redactObject<T extends Record<string, unknown>>(obj: T): T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetPatterns = (patterns: RegExp[]): void => {
  for (const p of patterns) {
    p.lastIndex = 0;
  }
};

const applyPatterns = (
  value: string,
  patterns: RegExp[],
  replacement: string
): string => {
  let result = value;
  for (const pattern of patterns) {
    // Reset in case the regex is stateful (global flag)
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
};

const isSensitiveKey = (
  key: string | undefined,
  sensitiveKeysLower: ReadonlySet<string>
): boolean => key !== undefined && sensitiveKeysLower.has(key.toLowerCase());

type DeepRedact = (
  value: unknown,
  sensitiveKeysLower: ReadonlySet<string>,
  patterns: RegExp[],
  replacement: string,
  currentKey?: string,
  seen?: WeakSet<object>
) => unknown;

const mapObjectValues = (
  value: object,
  visit: (item: unknown, key: string) => unknown
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = visit(item, key);
  }
  return result;
};

/** Track and guard against circular references in object graphs. */
const trackOrCircular = (
  value: object,
  seen: WeakSet<object>
): '[Circular]' | null => {
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  return null;
};

/* oxlint-disable no-use-before-define -- mutual recursion between redactCompound and deepRedact */

/** Redact a compound value (array or object), delegating scalars back to deepRedact. */
const redactCompound = (
  value: unknown[] | object,
  sensitiveKeysLower: ReadonlySet<string>,
  patterns: RegExp[],
  replacement: string,
  seen: WeakSet<object>
): unknown => {
  const circular = trackOrCircular(value, seen);
  if (circular) {
    return circular;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      deepRedact(
        item,
        sensitiveKeysLower,
        patterns,
        replacement,
        undefined,
        seen
      )
    );
  }
  return mapObjectValues(value, (item, key) =>
    deepRedact(item, sensitiveKeysLower, patterns, replacement, key, seen)
  );
};

const deepRedact: DeepRedact = (
  value,
  sensitiveKeysLower,
  patterns,
  replacement,
  currentKey?,
  seen = new WeakSet<object>()
) => {
  if (isSensitiveKey(currentKey, sensitiveKeysLower)) {
    return replacement;
  }
  if (typeof value === 'string') {
    return applyPatterns(value, patterns, replacement);
  }
  if (value !== null && typeof value === 'object') {
    return redactCompound(
      value,
      sensitiveKeysLower,
      patterns,
      replacement,
      seen
    );
  }
  return value;
};

/* oxlint-enable no-use-before-define */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createRedactor = (config?: RedactorConfig): Redactor => {
  const patterns = config?.patterns ?? DEFAULT_PATTERNS;
  const sensitiveKeys = config?.sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS;
  const replacement = config?.replacement ?? '[REDACTED]';

  const sensitiveKeysLower = new Set(sensitiveKeys.map((k) => k.toLowerCase()));

  return {
    redact(value: string): string {
      resetPatterns(patterns);
      return applyPatterns(value, patterns, replacement);
    },

    redactObject<T extends Record<string, unknown>>(obj: T): T {
      resetPatterns(patterns);
      return deepRedact(obj, sensitiveKeysLower, patterns, replacement) as T;
    },
  };
};
