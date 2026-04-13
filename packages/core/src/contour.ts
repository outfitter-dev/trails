import { z } from 'zod';

import type { Branded } from './branded.js';

/**
 * Runtime options for a contour declaration.
 */
export interface ContourOptions<
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
> {
  /** Field name that acts as the contour's primary identity. */
  readonly identity: TIdentity;
  /** Example instances validated against the contour schema at declaration time. */
  readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
}

/** Type-level brand name applied to a contour's identity schema. */
export type ContourIdBrand<TName extends string> = `${Capitalize<TName>}Id`;

type BrandedSchema<
  TSchema extends z.core.$ZodType,
  TBrand extends string,
> = TSchema & z.ZodType<Branded<z.output<TSchema>, TBrand>>;

type BrandableSchema<TSchema extends z.core.$ZodType> = TSchema & {
  brand<TBrand extends string>(): BrandedSchema<TSchema, TBrand>;
};

/** Output value of a branded contour identity schema. */
export type ContourIdValue<
  TSchema extends z.core.$ZodType,
  TName extends string,
> = Branded<z.output<TSchema>, ContourIdBrand<TName>>;

/** Runtime metadata attached to schemas returned from `contour.id()`. */
export interface ContourIdMetadata<
  TName extends string = string,
  TIdentity extends string = string,
> {
  readonly contour: TName;
  readonly identity: TIdentity;
}

/** A structural contour reference declared by another contour field schema. */
export interface ContourReference<
  TName extends string = string,
  TIdentity extends string = string,
> extends ContourIdMetadata<TName, TIdentity> {
  readonly field: string;
}

/** Symbol used to tag branded contour reference schemas at runtime. */
export const CONTOUR_ID_METADATA = Symbol.for('@ontrails/core/contour-id');

/**
 * Module-level WeakMap storing contour identity metadata keyed by schema object.
 *
 * First-write-wins: when multiple contours share the same underlying schema
 * (e.g. `contour('admin', { id: user.shape.id }, ...)`), the first contour to
 * brand the schema claims it. Subsequent calls skip the write to prevent
 * silent metadata corruption.
 */
const contourIdMetadata = new WeakMap<object, ContourIdMetadata>();

/**
 * A contour identity schema branded for one contour and tagged with runtime
 * metadata so the topo layer can recognize declared references later on.
 */
export type ContourIdSchema<
  TSchema extends z.core.$ZodType = z.core.$ZodType,
  TName extends string = string,
  TIdentity extends string = string,
> = BrandedSchema<TSchema, ContourIdBrand<TName>> & {
  readonly [CONTOUR_ID_METADATA]: ContourIdMetadata<TName, TIdentity>;
};

/**
 * A first-class domain object with schema, identity metadata, and examples.
 *
 * A contour behaves like the `ZodObject` it wraps, so standard Zod composition
 * helpers such as `.pick()`, `.extend()`, and `.array()` continue to work.
 */
export type Contour<
  TName extends string = string,
  TShape extends z.ZodRawShape = z.ZodRawShape,
  TIdentity extends keyof TShape & string = keyof TShape & string,
> = z.ZodObject<TShape> & {
  readonly kind: 'contour';
  readonly name: TName;
  readonly identity: TIdentity;
  readonly identitySchema: TShape[TIdentity];
  readonly id: () => ContourIdSchema<TShape[TIdentity], TName, TIdentity>;
  readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
};

const formatExampleIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

const assertIdentityField = <
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  name: string,
  shape: TShape,
  identity: TIdentity
): void => {
  if (!Object.hasOwn(shape, identity)) {
    throw new TypeError(
      `contour("${name}") identity "${identity}" must match a declared field`
    );
  }
};

const assertExamples = <TShape extends z.ZodRawShape>(
  name: string,
  schema: z.ZodObject<TShape>,
  examples: readonly z.output<z.ZodObject<TShape>>[]
): void => {
  for (const [index, example] of examples.entries()) {
    const parsed = schema.safeParse(example);
    if (!parsed.success) {
      throw new TypeError(
        `contour("${name}") example ${index} is invalid: ${formatExampleIssues(parsed.error.issues)}`
      );
    }
  }
};

const validateExamples = <TShape extends z.ZodRawShape>(
  name: string,
  schema: z.ZodObject<TShape>,
  examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined
): void => {
  if (examples) {
    assertExamples(name, schema, examples);
  }
};

const brandIdentitySchema = <
  TSchema extends z.core.$ZodType,
  TName extends string,
  TIdentity extends string,
>(
  contour: TName,
  identity: TIdentity,
  schema: TSchema
): ContourIdSchema<TSchema, TName, TIdentity> => {
  const branded = (schema as BrandableSchema<TSchema>).brand<
    ContourIdBrand<TName>
  >();

  // First-write-wins: if another contour already claimed this schema object
  // (possible when Zod v4 brand() returns `this`), preserve the original
  // metadata rather than silently overwriting it.
  if (!contourIdMetadata.has(branded)) {
    contourIdMetadata.set(branded, {
      contour,
      identity,
    } satisfies ContourIdMetadata<TName, TIdentity>);
  }

  return branded as ContourIdSchema<TSchema, TName, TIdentity>;
};

const attachContourMetadata = <
  TName extends string,
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  schema: z.ZodObject<TShape>,
  metadata: {
    readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
    readonly idSchema: ContourIdSchema<TShape[TIdentity], TName, TIdentity>;
    readonly identity: TIdentity;
    readonly identitySchema: TShape[TIdentity];
    readonly name: TName;
  }
): void => {
  Object.defineProperties(schema, {
    examples: {
      enumerable: true,
      value: metadata.examples,
      writable: false,
    },
    id: {
      enumerable: true,
      value: () => metadata.idSchema,
      writable: false,
    },
    identity: {
      enumerable: true,
      value: metadata.identity,
      writable: false,
    },
    identitySchema: {
      enumerable: true,
      value: metadata.identitySchema,
      writable: false,
    },
    kind: {
      enumerable: true,
      value: 'contour',
      writable: false,
    },
    name: {
      enumerable: true,
      value: metadata.name,
      writable: false,
    },
  });
};

/** Read contour identity metadata from the module-level WeakMap, if present. */
const readMetadata = (schema: unknown): ContourIdMetadata | undefined =>
  typeof schema === 'object' && schema !== null
    ? contourIdMetadata.get(schema)
    : undefined;

/** Resolve the inner schema from a Zod wrapper (ZodOptional, ZodNullable, etc.). */
const unwrapInner = (schema: unknown): unknown => {
  const def = (schema as { _def?: Record<string, unknown> })._def;
  return (def?.['innerType'] ?? def?.['schema']) as unknown;
};

/**
 * Walk through Zod wrapper layers searching for `CONTOUR_ID_METADATA`.
 *
 * `.nullish()` produces `ZodOptional<ZodNullable<T>>` — two wrapper levels —
 * so a single-step unwrap is insufficient. This iterates until it finds the
 * metadata or exhausts all wrapper layers.
 */
const unwrapToMetadata = (schema: unknown): ContourIdMetadata | undefined => {
  let current: unknown = schema;
  while (typeof current === 'object' && current !== null) {
    const inner = unwrapInner(current);
    if (typeof inner !== 'object' || inner === null) {
      return undefined;
    }
    const metadata = readMetadata(inner);
    if (metadata !== undefined) {
      return metadata;
    }
    current = inner;
  }
  return undefined;
};

/**
 * Read contour-reference metadata from a schema returned by `contour.id()`.
 *
 * When the schema is wrapped by Zod combinators (`.optional()`, `.nullable()`,
 * `.default()`, `.nullish()`, etc.) the `CONTOUR_ID_METADATA` symbol lives on
 * the inner schema, not on the wrapper. The unwrap handles arbitrarily nested
 * wrapper levels.
 */
export const getContourIdMetadata = (
  schema: unknown
): ContourIdMetadata | undefined =>
  readMetadata(schema) ?? unwrapToMetadata(schema);

/** Inspect a contour schema for fields that reference other contours via `.id()`. */
export const getContourReferences = (
  contour: AnyContour
): readonly ContourReference[] =>
  Object.entries(contour.shape)
    .flatMap(([field, schema]) => {
      if (field === contour.identity) {
        return [];
      }
      const metadata = getContourIdMetadata(schema);
      if (metadata === undefined) {
        return [];
      }

      return [{ field, ...metadata }];
    })
    .toSorted((left, right) =>
      left.field === right.field
        ? left.contour.localeCompare(right.contour)
        : left.field.localeCompare(right.field)
    );

/**
 * Create a contour definition from a raw Zod object shape.
 *
 * @example
 * ```typescript
 * const user = contour(
 *   'user',
 *   {
 *     id: z.string().uuid(),
 *     email: z.string().email(),
 *     name: z.string(),
 *   },
 *   { identity: 'id' }
 * );
 * ```
 */
export const contour = <
  TName extends string,
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  name: TName,
  shape: TShape,
  options: ContourOptions<TShape, TIdentity>
): Contour<TName, TShape, TIdentity> => {
  assertIdentityField(name, shape, options.identity);

  const schema = z.object(shape);
  validateExamples(name, schema, options.examples);

  const identitySchema = shape[options.identity];
  if (!identitySchema) {
    throw new TypeError(
      `contour("${name}") identity "${options.identity}" must resolve to a schema`
    );
  }

  const idSchema = brandIdentitySchema(name, options.identity, identitySchema);
  const examples = options.examples
    ? Object.freeze([...options.examples])
    : undefined;

  attachContourMetadata(schema, {
    examples,
    idSchema,
    identity: options.identity,
    identitySchema,
    name,
  });

  return schema as Contour<TName, TShape, TIdentity>;
};

/** Existential type for heterogeneous contour collections. */
export type AnyContour = Contour<string, z.ZodRawShape, string>;
