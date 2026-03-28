/**
 * Schema-driven field derivation for @ontrails/core
 *
 * Introspects Zod v4 schemas to produce a surface-agnostic Field[] descriptor
 * that UI layers (CLI prompts, web forms, etc.) can consume.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A surface-agnostic field descriptor derived from a Zod schema. */
export interface Field {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'enum' | 'multiselect';
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

const fieldTypeByDef: Record<string, (s: ZodInternals) => DerivedFieldType> = {
  array: (s) => {
    const element = s._zod.def['element'] as unknown as ZodInternals;
    const elementType = element._zod.def['type'] as string;
    if (elementType === 'enum') {
      const entries = element._zod.def['entries'] as Record<string, string>;
      return { options: Object.values(entries), type: 'multiselect' };
    }
    return { options: undefined, type: 'string' };
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
const deriveFieldType = (s: ZodInternals): DerivedFieldType => {
  const defType = s._zod.def['type'] as string;
  const derive = fieldTypeByDef[defType];
  return derive ? derive(s) : { options: undefined, type: 'string' };
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a surface-agnostic Field[] from a Zod object schema.
 *
 * Uses Zod v4's `_zod.def` for introspection. Returns fields sorted by name.
 */
/** Derive a single field from a shape entry. */
const deriveField = (
  key: string,
  value: ZodInternals,
  overrides?: Record<string, FieldOverride>
): Field => {
  const { inner, required, defaultValue, description } = unwrap(value);
  const { type, options: rawOptions } = deriveFieldType(inner);
  const override = overrides?.[key];
  const label = override?.label ?? description ?? humanize(key);
  const options = buildOptions(rawOptions, override?.options);
  return { default: defaultValue, label, name: key, options, required, type };
};

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
  return fields.toSorted((a, b) => a.name.localeCompare(b.name));
};
