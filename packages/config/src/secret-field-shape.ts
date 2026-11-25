import { globalRegistry, z } from 'zod';
import { util as zodUtil } from 'zod/v4/core';

import type { ConfigFieldMeta } from './extensions.js';
import { zodDef } from './zod-utils.js';

const WRAPPERS = new Set(['optional', 'default', 'nullable', 'readonly']);
const SCALARS = new Set(['string', 'number', 'boolean', 'enum', 'null']);
const BUILTIN_VALIDATIONS = new Set([
  'bigint_format',
  'greater_than',
  'length_equals',
  'less_than',
  'max_length',
  'max_size',
  'mime_type',
  'min_length',
  'min_size',
  'multiple_of',
  'number_format',
  'size_equals',
  'string_format',
]);

const ownData = (target: unknown, key: PropertyKey): unknown =>
  target !== null && typeof target === 'object'
    ? Object.getOwnPropertyDescriptor(target, key)?.value
    : undefined;

const isOrdinaryArray = (value: unknown): value is unknown[] =>
  Array.isArray(value) &&
  Object.getPrototypeOf(value) === Array.prototype &&
  !Object.hasOwn(value, Symbol.iterator);

const isValidationCheck = (check: unknown): boolean => {
  const internals = ownData(check, '_zod');
  const def = ownData(internals, 'def');
  const kind = ownData(def, 'check');
  if (kind !== 'custom') {
    return typeof kind === 'string' && BUILTIN_VALIDATIONS.has(kind);
  }
  // Payload-level checks can rewrite parsed values; ordinary refine cannot
  // replace the payload. Its optional when callback does receive the payload.
  const traits = ownData(internals, 'traits');
  return (
    traits instanceof Set &&
    Set.prototype.has.call(traits, '$ZodCustom') &&
    def !== null &&
    typeof def === 'object' &&
    !('when' in def)
  );
};

const supportsChecks = (def: Record<string, unknown>): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(def, 'checks');
  if (!descriptor) {
    return !('checks' in def);
  }
  if ('value' in descriptor && descriptor.value === undefined) {
    return true;
  }
  const checks: unknown = descriptor.value;
  if (!isOrdinaryArray(checks)) {
    return false;
  }
  for (let index = 0; index < checks.length; index += 1) {
    if (!isValidationCheck(ownData(checks, index))) {
      return false;
    }
  }
  return true;
};

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
    if (raw === undefined) {
      continue;
    }
    if (raw === null || typeof raw !== 'object') {
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(raw);
    if (prototype !== null && prototype !== Object.prototype) {
      return;
    }
    for (const key of keys) {
      const descriptor =
        Object.getOwnPropertyDescriptor(raw, key) ??
        (!inherits && prototype === Object.prototype
          ? Object.getOwnPropertyDescriptor(Object.prototype, key)
          : undefined);
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
    const def = zodDef(base);
    if (!supportsChecks(def)) {
      return;
    }
    const own = readSecretFieldMeta(base);
    if (own === false) {
      return;
    }
    if (own) {
      meta = Object.assign(own, meta);
    }
    if (!WRAPPERS.has(def['type'] as string)) {
      return { base, defaulted, meta, nullable, optional };
    }
    optional ||= def['type'] === 'optional';
    defaulted ||= def['type'] === 'default';
    nullable ||= def['type'] === 'nullable';
    base = def['innerType'] as z.ZodType;
  }
};

const literalValues = (schema: z.ZodType): ReadonlySet<unknown> | undefined => {
  const def = zodDef(schema);
  if (def['type'] !== 'literal' || !supportsChecks(def)) {
    return;
  }
  // Zod records the values it actually accepts at construction, not on read.
  const values: unknown = Object.getOwnPropertyDescriptor(
    schema._zod,
    'values'
  )?.value;
  if (!(values instanceof Set) || values.size === 0) {
    return;
  }
  for (const value of values) {
    if (
      value !== null &&
      !['string', 'number', 'boolean'].includes(typeof value)
    ) {
      return;
    }
  }
  return values;
};

export const isSecretScalar = (schema: z.ZodType): boolean => {
  const def = zodDef(schema);
  if (def['coerce']) {
    return false;
  }
  if (SCALARS.has(def['type'] as string)) {
    return true;
  }
  return literalValues(schema) !== undefined;
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

const branchObject = (schema: z.ZodType): z.ZodType | undefined => {
  let branch = schema;
  let def = zodDef(branch);
  // Only readonly forwards an object's discriminator claims unchanged.
  while (def['type'] === 'readonly') {
    branch = def['innerType'] as z.ZodType;
    def = zodDef(branch);
  }
  return def['type'] === 'object' ? branch : undefined;
};

const readBranchOptions = (options: unknown): z.ZodType[] | undefined => {
  if (!isOrdinaryArray(options)) {
    return;
  }
  const branches: z.ZodType[] = [];
  const length: unknown = Object.getOwnPropertyDescriptor(
    options,
    'length'
  )?.value;
  if (typeof length !== 'number' || length === 0) {
    return;
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(options, index);
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !(descriptor.value instanceof z.ZodType)
    ) {
      return;
    }
    branches.push(descriptor.value);
  }
  return branches;
};

/** Inspect only branch discriminators, never fields from unselected branches. */
export const selectSecretBranch = (
  options: unknown,
  discriminator: string,
  value: unknown
): SecretBranchSelection => {
  const branches = readBranchOptions(options);
  if (!branches) {
    return { kind: 'unsupported' };
  }
  const claims = new Map<unknown, z.ZodType>();
  for (const option of branches) {
    const branch = branchObject(option);
    if (!branch) {
      return { kind: 'unsupported' };
    }
    const field = secretDiscriminator(branch, discriminator);
    if (!field) {
      return { kind: 'unsupported' };
    }
    const values = literalValues(field);
    const meta = readSecretFieldMeta(field);
    if (!values || meta === false || meta?.secret) {
      return { kind: 'unsupported' };
    }
    for (const literal of values) {
      if (claims.has(literal)) {
        return { kind: 'unsupported' };
      }
      claims.set(literal, option);
    }
  }
  const selected = claims.get(value);
  return selected
    ? { kind: 'selected', schema: selected }
    : { kind: 'invalid' };
};
