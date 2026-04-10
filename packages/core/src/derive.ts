/**
 * Schema-driven field derivation for @ontrails/core
 *
 * Introspects Zod v4 schemas to produce a runtime-agnostic Field[] descriptor
 * that UI consumers (CLI prompts, web forms, etc.) can consume.
 */

import type { z } from 'zod';

import { ValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A runtime-agnostic field descriptor derived from a Zod schema. */
export interface Field {
  readonly name: string;
  readonly type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'multiselect'
    | 'string[]'
    | 'number[]';
  readonly label: string;
  readonly required: boolean;
  readonly default?: unknown | undefined;
  readonly options?:
    | readonly {
        value: string;
        label?: string | undefined;
        hint?: string | undefined;
      }[]
    | undefined;
}

/** Per-field overrides supplied by trail authors. */
export interface FieldOverride {
  readonly label?: string | undefined;
  readonly message?: string | undefined;
  readonly hint?: string | undefined;
  readonly options?:
    | readonly {
        value: string;
        label: string;
        hint?: string | undefined;
      }[]
    | undefined;
  /** Mark this field as a CLI positional argument instead of a flag. */
  readonly positional?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Zod v4 internals accessor
// ---------------------------------------------------------------------------

interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
    readonly traits: ReadonlySet<string>;
  };
  readonly description?: string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert camelCase / PascalCase to "Title Case" label. */
const humanize = (str: string): string =>
  str
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (ch) => ch.toUpperCase());

interface UnwrapResult {
  defaultValue: unknown;
  description: string | undefined;
  inner: ZodInternals;
  required: boolean;
}

/** Get the inner type from an optional or default wrapper. */
const getInnerType = (current: ZodInternals): ZodInternals =>
  current._zod.def['innerType'] as ZodInternals;

/** Propagate description from inner to state if present. */
const propagateDescription = (
  inner: ZodInternals,
  state: { description: string | undefined }
): void => {
  if (inner.description) {
    state.description = inner.description;
  }
};

/** Step one level of optional/default unwrapping. Returns null if not a wrapper type. */
const unwrapStep = (
  current: ZodInternals,
  state: {
    defaultValue: unknown;
    description: string | undefined;
    required: boolean;
  }
): ZodInternals | null => {
  const defType = current._zod.def['type'] as string;
  if (defType !== 'optional' && defType !== 'default') {
    return null;
  }
  state.required = false;
  if (defType === 'default') {
    state.defaultValue = current._zod.def['defaultValue'];
  }
  const inner = getInnerType(current);
  propagateDescription(inner, state);
  return inner;
};

/** Unwrap optional / default wrappers, collecting metadata. */
const unwrap = (s: ZodInternals): UnwrapResult => {
  const state = {
    defaultValue: undefined as unknown,
    description: s.description,
    required: true,
  };
  let current = s;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = unwrapStep(current, state);
    if (next === null) {
      break;
    }
    current = next;
  }

  return { ...state, inner: current };
};

interface DerivedFieldType {
  options: string[] | undefined;
  type: Field['type'];
}

const fieldTypeByDef: Record<
  string,
  (s: ZodInternals) => DerivedFieldType | null
> = {
  array: (s) => {
    const element = s._zod.def['element'] as unknown as ZodInternals;
    const { inner } = unwrap(element);
    const elementType = inner._zod.def['type'] as string;
    if (elementType === 'enum') {
      const entries = inner._zod.def['entries'] as Record<string, string>;
      return { options: Object.values(entries), type: 'multiselect' };
    }
    if (elementType !== 'number' && elementType !== 'string') {
      return null;
    }
    return {
      options: undefined,
      type: elementType === 'number' ? 'number[]' : 'string[]',
    };
  },
  boolean: () => ({ options: undefined, type: 'boolean' }),
  enum: (s) => {
    const entries = s._zod.def['entries'] as Record<string, string>;
    return { options: Object.values(entries), type: 'enum' };
  },
  number: () => ({ options: undefined, type: 'number' }),
  string: () => ({ options: undefined, type: 'string' }),
};

/** Derive field type and raw options from the unwrapped Zod def. */
const deriveFieldType = (s: ZodInternals): DerivedFieldType | null => {
  const defType = s._zod.def['type'] as string;
  const derive = fieldTypeByDef[defType];
  return derive ? derive(s) : null;
};

/** Build options array, merging with overrides when present. */
const buildOptions = (
  rawOptions: string[] | undefined,
  overrideOptions: FieldOverride['options'] | undefined
): Field['options'] | undefined => {
  if (!rawOptions) {
    return undefined;
  }

  if (!overrideOptions) {
    return rawOptions.map((v) => ({ value: v }));
  }

  const overrideMap = new Map(overrideOptions.map((o) => [o.value, o]));
  return rawOptions.map((v) => {
    const ov = overrideMap.get(v);
    return ov ? { hint: ov.hint, label: ov.label, value: v } : { value: v };
  });
};

/**
 * Derive the canonical ordered CLI path from a trail ID.
 *
 * @throws {ValidationError} if the trail ID contains empty segments (e.g. consecutive dots).
 */
export const deriveCliPath = (trailId: string): string[] => {
  const segments = trailId.split('.');
  const emptyIndex = segments.findIndex((s) => s.length === 0);
  if (emptyIndex !== -1) {
    throw new ValidationError(
      `Trail ID "${trailId}" contains an empty segment at position ${emptyIndex}`
    );
  }
  return segments;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Derive a single field from a shape entry. */
const deriveField = (
  key: string,
  value: ZodInternals,
  overrides?: Record<string, FieldOverride>
): Field | null => {
  const { inner, required, defaultValue, description } = unwrap(value);
  const derived = deriveFieldType(inner);
  if (!derived) {
    return null;
  }
  const { type, options: rawOptions } = derived;
  const override = overrides?.[key];
  const label = override?.label ?? description ?? humanize(key);
  const options = buildOptions(rawOptions, override?.options);
  return { default: defaultValue, label, name: key, options, required, type };
};

/**
 * Derive a runtime-agnostic Field[] from a Zod object schema.
 *
 * Uses Zod v4's `_zod.def` for introspection. Returns fields sorted by name.
 */
export const deriveFields = (
  schema: z.ZodType,
  overrides?: Record<string, FieldOverride>
): Field[] => {
  const s = schema as unknown as ZodInternals;
  if ((s._zod.def['type'] as string) !== 'object') {
    return [];
  }

  const shape = s._zod.def['shape'] as Record<string, ZodInternals> | undefined;
  if (!shape) {
    return [];
  }

  const fields = Object.entries(shape).map(([key, value]) =>
    deriveField(key, value, overrides)
  );
  return fields
    .filter((field): field is Field => field !== null)
    .toSorted((a, b) => a.name.localeCompare(b.name));
};
