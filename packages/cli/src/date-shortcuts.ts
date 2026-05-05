/**
 * CLI surface absorption for date-shortcut expansion.
 *
 * When a trail's `input` schema contains date-typed fields, the CLI
 * surface derivation pipeline accepts shortcut strings (`today`,
 * `yesterday`, `Nd`, `this-week`, `this-month`) on the corresponding
 * flags and expands them to UTC ISO 8601 datetimes before validation.
 *
 * This module is the CLI-package-local home of the detection and
 * expansion helpers. The legacy `dateShortcutsLayer` in `./layers.ts`
 * remains exported for apps that still register it explicitly; the
 * derivation pipeline performs the same job without requiring an
 * authored layer.
 *
 * All expansions are computed in UTC. The expander does not consult
 * the system locale, and time-of-day always pins to 00:00:00.000Z.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod internals access
// ---------------------------------------------------------------------------

interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
  };
}

const hasZodInternals = (value: unknown): value is ZodInternals => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { readonly _zod?: unknown };
  if (candidate._zod === null || typeof candidate._zod !== 'object') {
    return false;
  }
  const zod = candidate._zod as { readonly def?: unknown };
  return typeof zod.def === 'object' && zod.def !== null;
};

// ---------------------------------------------------------------------------
// Date-type detection
// ---------------------------------------------------------------------------

export type DateShortcutKind = 'date' | 'datetime' | 'native-date';

/**
 * Step through optional/nullable/default wrappers to reveal the
 * inner Zod node.
 */
const unwrapToInner = (node: ZodInternals): ZodInternals => {
  let current: ZodInternals = node;
  for (;;) {
    const defType = current._zod.def['type'];
    if (
      defType !== 'optional' &&
      defType !== 'nullable' &&
      defType !== 'default' &&
      defType !== 'readonly'
    ) {
      return current;
    }
    const inner = current._zod.def['innerType'];
    if (!hasZodInternals(inner)) {
      return current;
    }
    current = inner;
  }
};

/**
 * Return true when a Zod node represents a date-shaped value:
 *
 * - `z.date()` (`def.type === 'date'`)
 * - `z.iso.datetime()` / `z.iso.date()` (`def.type === 'string'`,
 *   `def.format === 'datetime' | 'date'`)
 * - `z.string().datetime()` / `.date()` (string with a format check
 *   pinned to `datetime` or `date`)
 *
 * Optional/nullable/default/readonly wrappers are unwrapped first.
 */
const readDateNodeKind = (node: ZodInternals): DateShortcutKind | undefined => {
  const inner = unwrapToInner(node);
  const defType = inner._zod.def['type'];
  if (defType === 'date') {
    return 'native-date';
  }
  if (defType !== 'string') {
    return undefined;
  }
  const { format } = inner._zod.def;
  if (format === 'datetime') {
    return 'datetime';
  }
  if (format === 'date') {
    return 'date';
  }
  // Detect `z.string().datetime()` style: a plain string with a
  // string_format check whose `format` is `datetime` or `date`.
  const { checks } = inner._zod.def;
  if (!Array.isArray(checks)) {
    return undefined;
  }
  for (const check of checks) {
    if (!hasZodInternals(check)) {
      continue;
    }
    const checkDef = check._zod.def;
    if (checkDef['check'] !== 'string_format') {
      continue;
    }
    const checkFormat = checkDef['format'];
    if (checkFormat === 'datetime') {
      return 'datetime';
    }
    if (checkFormat === 'date') {
      return 'date';
    }
  }
  return undefined;
};

/**
 * Detect the names of date-typed fields on a Zod object schema.
 *
 * Returns an empty list when the schema is not an object schema, when
 * its shape is missing, or when no field unwraps to a date-shaped
 * node. The detection is conservative: only schemas that statically
 * declare a date-shaped type qualify.
 */
export const detectDateFieldKinds = (
  schema: z.ZodType<unknown>
): Readonly<Record<string, DateShortcutKind>> => {
  if (!hasZodInternals(schema)) {
    return {};
  }
  const { def } = schema._zod;
  if (def['type'] !== 'object') {
    return {};
  }
  const { shape } = def;
  if (shape === null || typeof shape !== 'object') {
    return {};
  }
  const fieldKinds: Record<string, DateShortcutKind> = {};
  for (const [name, child] of Object.entries(
    shape as Record<string, unknown>
  )) {
    if (!hasZodInternals(child)) {
      continue;
    }
    const kind = readDateNodeKind(child);
    if (kind !== undefined) {
      fieldKinds[name] = kind;
    }
  }
  return fieldKinds;
};

export const detectDateFields = (
  schema: z.ZodType<unknown>
): readonly string[] => Object.keys(detectDateFieldKinds(schema));

// ---------------------------------------------------------------------------
// Expansion vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical set of recognized shortcut tokens. Mirrors the vocabulary
 * declared in the legacy `dateShortcutsLayer` so that switching from
 * the layer to the derivation pipeline is a no-op for users.
 */
export const DATE_SHORTCUT_NAMES = [
  'today',
  'yesterday',
  'this-week',
  'this-month',
] as const;

/**
 * Suggestion blurb returned with invalid-shortcut errors. Includes the
 * vocabulary tokens plus the `Nd` rolling-window form.
 */
const SHORTCUT_SUGGESTION = `Supported shortcuts: ${DATE_SHORTCUT_NAMES.join(
  ', '
)}, or 'Nd' (e.g. '7d', '30d'). Plain ISO 8601 dates are also accepted.`;

const NUMERIC_DAY_PATTERN = /^(\d+)d$/;
const MAX_ROLLING_DAY_SHORTCUT = 36_500;

/**
 * Pattern that captures shortcut-shaped values that should be flagged
 * as malformed rather than passed through to Zod. Matches strings that
 * begin with one or more digits followed only by letters. This catches
 * typo-shaped values such as `7day` while allowing compact ISO basic
 * datetimes such as `20250115T120000Z` to fall through to Zod.
 */
const SHORTCUT_LIKE_PATTERN = /^\d+[a-zA-Z]+$/;

const startOfUtcDay = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

const subtractDaysUtc = (now: Date, days: number): Date => {
  const base = startOfUtcDay(now);
  base.setUTCDate(base.getUTCDate() - days);
  return base;
};

const startOfUtcMonth = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Start-of-week treating Monday as the first day. Sundays are
 * considered the trailing end of the previous Monday-anchored week,
 * matching the behavior of the legacy layer.
 */
const startOfUtcIsoWeek = (now: Date): Date => {
  const dayOfWeek = now.getUTCDay();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return subtractDaysUtc(now, offset);
};

// ---------------------------------------------------------------------------
// Shortcut expansion
// ---------------------------------------------------------------------------

export interface ExpandSuccess {
  readonly ok: true;
  readonly value: Date | string;
}

export interface ExpandFailure {
  readonly ok: false;
  readonly message: string;
}

export type ExpandResult = ExpandSuccess | ExpandFailure;

const namedHandlers: Record<
  (typeof DATE_SHORTCUT_NAMES)[number],
  (now: Date) => Date
> = {
  'this-month': startOfUtcMonth,
  'this-week': startOfUtcIsoWeek,
  today: startOfUtcDay,
  yesterday: (now) => subtractDaysUtc(now, 1),
};

const isNamedShortcut = (
  value: string
): value is (typeof DATE_SHORTCUT_NAMES)[number] =>
  (DATE_SHORTCUT_NAMES as readonly string[]).includes(value);

const formatExpandedDate = (
  date: Date,
  kind: DateShortcutKind
): Date | string => {
  if (kind === 'native-date') {
    return date;
  }
  const iso = date.toISOString();
  return kind === 'date' ? iso.slice(0, 10) : iso;
};

/**
 * Expand a single shortcut value to a UTC ISO 8601 datetime string.
 *
 * - Recognized shortcuts (`today`, `yesterday`, `Nd`, `this-week`,
 *   `this-month`) are expanded to start-of-day UTC.
 * - Plain non-shortcut strings pass through unchanged. Validation is
 *   deferred to Zod.
 * - Strings that look like a shortcut (start with a digit) but do not
 *   match the `Nd` form return a validation error suggesting the
 *   supported vocabulary.
 *
 * `now` defaults to `new Date()`. Callers may pass a fixed instant for
 * deterministic behavior in tests.
 */
export const expandDateShortcut = (
  value: string,
  now: Date = new Date(),
  kind: DateShortcutKind = 'datetime'
): ExpandResult => {
  if (isNamedShortcut(value)) {
    return {
      ok: true,
      value: formatExpandedDate(namedHandlers[value](now), kind),
    };
  }
  const numericMatch = NUMERIC_DAY_PATTERN.exec(value);
  if (numericMatch?.[1]) {
    const days = Number(numericMatch[1]);
    if (
      !Number.isSafeInteger(days) ||
      days < 0 ||
      days > MAX_ROLLING_DAY_SHORTCUT
    ) {
      return {
        message: `Invalid date shortcut '${value}'. Rolling day shortcuts must be between 0d and ${MAX_ROLLING_DAY_SHORTCUT.toString()}d. ${SHORTCUT_SUGGESTION}`,
        ok: false,
      };
    }
    return {
      ok: true,
      value: formatExpandedDate(subtractDaysUtc(now, days), kind),
    };
  }
  // Anything that starts with a digit but did not match the `Nd` form
  // is almost certainly a typo of the rolling-window shortcut. Reject
  // with a helpful suggestion rather than passing it through to Zod
  // where the failure would be opaque.
  if (SHORTCUT_LIKE_PATTERN.test(value)) {
    return {
      message: `Invalid date shortcut '${value}'. ${SHORTCUT_SUGGESTION}`,
      ok: false,
    };
  }
  return { ok: true, value };
};

// ---------------------------------------------------------------------------
// Record-level transform
// ---------------------------------------------------------------------------

export interface ExpandRecordSuccess {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}

export interface ExpandRecordFailure {
  readonly ok: false;
  readonly field: string;
  readonly message: string;
}

export type ExpandRecordResult = ExpandRecordSuccess | ExpandRecordFailure;

/**
 * Apply shortcut expansion to the listed date fields of a merged input
 * record. Non-string values are left intact (a `Date`, `undefined`, or
 * `null` that survives this transform is handled later by Zod).
 *
 * Returns a `field`-tagged failure when any field's string value is a
 * shortcut-shaped token that does not match the supported vocabulary.
 */
export const expandDateShortcuts = (
  input: Readonly<Record<string, unknown>>,
  dateFields: readonly string[],
  now: Date = new Date(),
  dateFieldKinds: Readonly<Record<string, DateShortcutKind>> = {}
): ExpandRecordResult => {
  if (dateFields.length === 0) {
    return { ok: true, value: { ...input } };
  }
  const next: Record<string, unknown> = { ...input };
  for (const field of dateFields) {
    const raw = next[field];
    if (typeof raw !== 'string') {
      continue;
    }
    const expansion = expandDateShortcut(
      raw,
      now,
      dateFieldKinds[field] ?? 'datetime'
    );
    if (!expansion.ok) {
      return { field, message: expansion.message, ok: false };
    }
    next[field] = expansion.value;
  }
  return { ok: true, value: next };
};
