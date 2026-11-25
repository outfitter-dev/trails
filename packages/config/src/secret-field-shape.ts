import { globalRegistry } from 'zod';
import type { z } from 'zod';
import { util as zodUtil } from 'zod/v4/core';

import type { ConfigFieldMeta } from './extensions.js';
import { zodDef } from './zod-utils.js';

const WRAPPERS = new Set(['optional', 'default', 'nullable', 'readonly']);
const SCALARS = new Set(['string', 'number', 'boolean', 'enum', 'null']);

const readMetadataDescriptors = (schema: z.ZodType) => {
  // Registry.get spreads cloned metadata, which reads even unrelated getters.
  const map = Object.getOwnPropertyDescriptor(globalRegistry, '_map')?.value;
  if (!(map instanceof WeakMap)) {
    return;
  }
  const keys = ['env', 'secret', 'deprecationMessage'] as const;
  const descriptors: Partial<
    Record<(typeof keys)[number], PropertyDescriptor>
  > = {};
  const inherits = schema._zod.parent !== undefined;
  for (
    let node: typeof schema._zod.parent = schema;
    node;
    node = node._zod.parent
  ) {
    const raw: unknown = map.get(node);
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (descriptor && (!inherits || descriptor.enumerable)) {
        descriptors[key] ??= descriptor;
      }
    }
  }
  return descriptors;
};

const readSecretFieldMeta = (
  schema: z.ZodType
): ConfigFieldMeta | undefined | false => {
  const descriptors = readMetadataDescriptors(schema);
  if (!descriptors) {
    return false;
  }
  const { env, secret, deprecationMessage } = descriptors;
  if ((env && !('value' in env)) || (secret && !('value' in secret))) {
    return false;
  }
  const envName: unknown = env?.value;
  const sensitive = secret?.value === true;
  const hasDeprecation =
    deprecationMessage !== undefined &&
    (!('value' in deprecationMessage) ||
      typeof deprecationMessage.value === 'string');
  if (typeof envName === 'string' || sensitive || hasDeprecation) {
    return {
      ...(typeof envName === 'string' ? { env: envName } : {}),
      ...(sensitive ? { secret: true } : {}),
    };
  }
  return undefined;
};

/** Presence facts only; never reads a default value or evaluates a schema. */
export const unwrapSecretField = (schema: z.ZodType) => {
  let base = schema;
  let optional = false;
  let defaulted = false;
  let nullable = false;
  let meta: ConfigFieldMeta | undefined;
  for (;;) {
    const own = readSecretFieldMeta(base);
    if (own === false) {
      return;
    }
    if (own) {
      meta = Object.assign(own, meta);
    }
    const def = zodDef(base);
    if (!WRAPPERS.has(def['type'] as string)) {
      return { base, defaulted, meta, nullable, optional };
    }
    optional ||= def['type'] === 'optional';
    defaulted ||= def['type'] === 'default';
    nullable ||= def['type'] === 'nullable';
    base = def['innerType'] as z.ZodType;
  }
};

export const isSecretScalar = (schema: z.ZodType): boolean => {
  const def = zodDef(schema);
  if (def['coerce']) {
    return false;
  }
  if (SCALARS.has(def['type'] as string)) {
    return true;
  }
  return (
    def['type'] === 'literal' &&
    Array.isArray(def['values']) &&
    def['values'].every(
      (value: unknown) =>
        value === null || ['string', 'number', 'boolean'].includes(typeof value)
    )
  );
};

/** Scalar arrays are inspectable leaves only when their elements add no secrets. */
export const isInspectableSecretArray = (schema: z.ZodType): boolean => {
  const element = zodDef(schema)['element'] as z.ZodType;
  const shape = unwrapSecretField(element);
  return (
    shape !== undefined &&
    isSecretScalar(shape.base) &&
    shape.meta === undefined
  );
};

type RawShapeReader = (
  def: Record<string, unknown>
) => Record<PropertyKey, unknown> | undefined;

const rawSecretShape = (
  schema: z.ZodType
): Record<PropertyKey, unknown> | undefined => {
  // The utility is absent on the declared Zod floor; never evaluate shape getters.
  const reader = Reflect.get(zodUtil, 'rawShape') as RawShapeReader | undefined;
  return typeof reader === 'function' ? reader(zodDef(schema)) : undefined;
};

export const secretObjectShape = (
  schema: z.ZodType
): Record<string, z.ZodType> | undefined => {
  // Dynamic-key schemas cannot be enumerated; even annotated never is metadata.
  const catchall = Object.getOwnPropertyDescriptor(zodDef(schema), 'catchall');
  if (catchall && (!('value' in catchall) || catchall.value !== undefined)) {
    return undefined;
  }
  // Reading `.shape` resolves authored getters; Zod's raw view does not.
  const shape = rawSecretShape(schema);
  if (!shape) {
    return undefined;
  }
  const fields = Object.entries(Object.getOwnPropertyDescriptors(shape)).filter(
    ([, descriptor]) => descriptor.enumerable
  );
  if (fields.some(([, descriptor]) => !('value' in descriptor))) {
    return undefined;
  }
  return Object.fromEntries(
    fields.map(([key, descriptor]) => [key, descriptor.value as z.ZodType])
  );
};

const secretDiscriminator = (
  schema: z.ZodType,
  key: string
): z.ZodType | undefined => {
  const shape = rawSecretShape(schema);
  if (!shape) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(shape, key);
  return descriptor?.enumerable && 'value' in descriptor
    ? (descriptor.value as z.ZodType)
    : undefined;
};

export type SecretBranchSelection =
  | { readonly kind: 'selected'; readonly schema: z.ZodType }
  | { readonly kind: 'invalid' | 'unsupported' };

/** Inspect only branch discriminators, never fields from unselected branches. */
export const selectSecretBranch = (
  options: readonly z.ZodType[],
  discriminator: string,
  value: unknown
): SecretBranchSelection => {
  const matches: z.ZodType[] = [];
  for (const option of options) {
    const branch = unwrapSecretField(option);
    if (!branch || zodDef(branch.base)['type'] !== 'object') {
      return { kind: 'unsupported' };
    }
    const field = secretDiscriminator(branch.base, discriminator);
    if (!field) {
      return { kind: 'unsupported' };
    }
    const shape = unwrapSecretField(field);
    if (!shape) {
      return { kind: 'unsupported' };
    }
    const literal = zodDef(shape.base);
    if (shape.meta?.secret) {
      return { kind: 'unsupported' };
    }
    if (literal['type'] !== 'literal' || !Array.isArray(literal['values'])) {
      return { kind: 'unsupported' };
    }
    if (literal['values'].includes(value)) {
      matches.push(option);
    }
  }
  const [selected] = matches;
  if (matches.length > 1) {
    return { kind: 'unsupported' };
  }
  return selected
    ? { kind: 'selected', schema: selected }
    : { kind: 'invalid' };
};
