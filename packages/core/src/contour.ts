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

/** Symbol used to tag branded contour reference schemas at runtime. */
export const CONTOUR_ID_METADATA = Symbol.for('@ontrails/core/contour-id');

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
  Object.defineProperty(branded, CONTOUR_ID_METADATA, {
    enumerable: false,
    value: { contour, identity } satisfies ContourIdMetadata<TName, TIdentity>,
    writable: false,
  });
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

/** Read contour-reference metadata from a schema returned by `contour.id()`. */
export const getContourIdMetadata = (
  schema: unknown
): ContourIdMetadata | undefined => {
  if (typeof schema !== 'object' || schema === null) {
    return undefined;
  }
  return (
    schema as Partial<Record<typeof CONTOUR_ID_METADATA, ContourIdMetadata>>
  )[CONTOUR_ID_METADATA];
};

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
