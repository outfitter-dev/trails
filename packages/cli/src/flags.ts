/**
 * Flag derivation from surface-agnostic fields and reusable flag presets.
 */

import type { Field } from '@ontrails/core';
import type { z } from 'zod';

import type { CliFlag } from './command.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert camelCase to kebab-case. */
const toKebab = (str: string): string =>
  str.replaceAll(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
  };
  readonly description?: string;
}

interface CliFlagShape {
  readonly choices?: string[] | undefined;
  readonly type: CliFlag['type'];
  readonly variadic: boolean;
}

const fieldTypeToCliFlag: Record<Field['type'], CliFlagShape> = {
  boolean: { type: 'boolean', variadic: false },
  enum: { type: 'string', variadic: false },
  multiselect: { type: 'string[]', variadic: true },
  number: { type: 'number', variadic: false },
  string: { type: 'string', variadic: false },
};

/** Convert a derived field into a CLI flag descriptor. */
const toCliFlag = (field: Field): CliFlag => {
  const shape = fieldTypeToCliFlag[field.type];
  return {
    choices: field.options?.map((option) => option.value),
    default: field.default,
    description: field.label,
    name: toKebab(field.name),
    required: field.required,
    type: shape.type,
    variadic: shape.variadic,
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert derived fields to CLI flags. */
export const toFlags = (fields: readonly Field[]): CliFlag[] =>
  fields.map(toCliFlag);

interface UnwrapState {
  defaultValue: unknown;
  description: string | undefined;
  required: boolean;
}

/** Get the inner type from an optional or default wrapper. */
const getInnerType = (current: ZodInternals): ZodInternals =>
  current._zod.def['innerType'] as ZodInternals;

/** Propagate description from an inner type. */
const propagateDescription = (
  inner: ZodInternals,
  state: UnwrapState
): void => {
  if (inner.description) {
    state.description = inner.description;
  }
};

/** Step one unwrap level for optional/default fields. */
const unwrapStep = (
  current: ZodInternals,
  state: UnwrapState
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

/** Unwrap optional/default wrappers, collecting metadata. */
const unwrap = (
  schema: ZodInternals
): {
  defaultValue: unknown;
  description: string | undefined;
  inner: ZodInternals;
  required: boolean;
} => {
  const state: UnwrapState = {
    defaultValue: undefined,
    description: schema.description,
    required: true,
  };
  let current = schema;

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

interface DerivedFlagShape {
  readonly choices?: string[] | undefined;
  readonly type: CliFlag['type'];
  readonly variadic: boolean;
}

const flagShapeByDef: Record<
  string,
  (schema: ZodInternals) => DerivedFlagShape
> = {
  array: (schema) => {
    const element = schema._zod.def['element'] as ZodInternals;
    const elementType = element._zod.def['type'] as string;
    if (elementType === 'number') {
      return { type: 'number[]', variadic: true };
    }
    return { type: 'string[]', variadic: true };
  },
  boolean: () => ({ type: 'boolean', variadic: false }),
  enum: (schema) => {
    const entries = schema._zod.def['entries'] as Record<string, string>;
    return {
      choices: Object.values(entries),
      type: 'string',
      variadic: false,
    };
  },
  number: () => ({ type: 'number', variadic: false }),
  string: () => ({ type: 'string', variadic: false }),
};

/** Derive the CLI flag shape for an unwrapped Zod field. */
const deriveFlagShape = (schema: ZodInternals): DerivedFlagShape => {
  const defType = schema._zod.def['type'] as string;
  const deriveShape = flagShapeByDef[defType];
  return deriveShape
    ? deriveShape(schema)
    : { type: 'string', variadic: false };
};

/** Derive a single CLI flag from an object shape entry. */
const deriveFlag = (key: string, value: ZodInternals): CliFlag => {
  const { inner, required, defaultValue, description } = unwrap(value);
  const { choices, type, variadic } = deriveFlagShape(inner);
  return {
    choices,
    default: defaultValue,
    description: description ?? inner.description,
    name: toKebab(key),
    required,
    type,
    variadic,
  };
};

/** Derive CLI flags from a Zod input schema. */
export const deriveFlags = (schema: z.ZodType): CliFlag[] => {
  const zod = schema as unknown as ZodInternals;
  if ((zod._zod.def['type'] as string) !== 'object') {
    return [];
  }
  const shape = zod._zod.def['shape'] as
    | Record<string, ZodInternals>
    | undefined;
  if (!shape) {
    return [];
  }
  return Object.entries(shape).map(([key, value]) => deriveFlag(key, value));
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Flags for output mode selection: --output, --json, --jsonl */
export const outputModePreset = (): CliFlag[] => [
  {
    choices: ['text', 'json', 'jsonl'],
    default: 'text',
    description: 'Output format',
    name: 'output',
    required: false,
    short: 'o',
    type: 'string',
    variadic: false,
  },
  {
    description: 'Shorthand for --output json',
    name: 'json',
    required: false,
    type: 'boolean',
    variadic: false,
  },
  {
    description: 'Shorthand for --output jsonl',
    name: 'jsonl',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];

/** Flag for working directory override: --cwd */
export const cwdPreset = (): CliFlag[] => [
  {
    description: 'Working directory override',
    name: 'cwd',
    required: false,
    type: 'string',
    variadic: false,
  },
];

/** Flag for dry-run mode: --dry-run */
export const dryRunPreset = (): CliFlag[] => [
  {
    default: false,
    description: 'Execute without side effects',
    name: 'dry-run',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];
