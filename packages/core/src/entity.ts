import { z } from 'zod';

import type { Branded } from './branded.js';

/**
 * Runtime options for an entity declaration.
 */
export interface EntityOptions<
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
> {
  /** Field name that acts as the entity's primary identity. */
  readonly identity: TIdentity;
  /** Example instances validated against the entity schema at declaration time. */
  readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
  /** Reserved for future entity-specific design; trail versioning is trail-only. */
  readonly version?: never;
}

/** Type-level brand name applied to an entity's identity schema. */
export type EntityIdBrand<TName extends string> = `${Capitalize<TName>}Id`;

type BrandedSchema<
  TSchema extends z.core.$ZodType,
  TBrand extends string,
> = TSchema & z.ZodType<Branded<z.output<TSchema>, TBrand>>;

type BrandableSchema<TSchema extends z.core.$ZodType> = TSchema & {
  brand<TBrand extends string>(): BrandedSchema<TSchema, TBrand>;
};

/** Output value of a branded entity identity schema. */
export type EntityIdValue<
  TSchema extends z.core.$ZodType,
  TName extends string,
> = Branded<z.output<TSchema>, EntityIdBrand<TName>>;

/** Runtime metadata attached to schemas returned from `entity.id()`. */
export interface EntityIdMetadata<
  TName extends string = string,
  TIdentity extends string = string,
> {
  readonly entity: TName;
  readonly identity: TIdentity;
}

/** A structural entity reference declared by another entity field schema. */
export interface EntityReference<
  TName extends string = string,
  TIdentity extends string = string,
> extends EntityIdMetadata<TName, TIdentity> {
  readonly field: string;
}

/** Symbol used to tag branded entity reference schemas at runtime. */
export const ENTITY_ID_METADATA = Symbol.for('@ontrails/core/entity-id');

/**
 * Module-level WeakMap storing entity identity metadata keyed by schema object.
 *
 * First-write-wins: when multiple entities share the same underlying schema
 * (e.g. `entity('admin', { id: user.shape.id }, ...)`), the first entity to
 * brand the schema claims it. Subsequent calls skip the write to prevent
 * silent metadata corruption.
 */
const entityIdMetadata = new WeakMap<object, EntityIdMetadata>();

/**
 * An entity identity schema branded for one entity and tagged with runtime
 * metadata so the topo layer can recognize declared references later on.
 */
export type EntityIdSchema<
  TSchema extends z.core.$ZodType = z.core.$ZodType,
  TName extends string = string,
  TIdentity extends string = string,
> = BrandedSchema<TSchema, EntityIdBrand<TName>> & {
  /** @deprecated Use `getEntityIdMetadata()` — metadata lives in a WeakMap, not on the schema. */
  readonly [ENTITY_ID_METADATA]?: EntityIdMetadata<TName, TIdentity>;
};

/**
 * A first-class domain object with schema, identity metadata, and examples.
 *
 * An entity behaves like the `ZodObject` it wraps, so standard Zod composition
 * helpers such as `.pick()`, `.extend()`, and `.array()` continue to work.
 */
export type Entity<
  TName extends string = string,
  TShape extends z.ZodRawShape = z.ZodRawShape,
  TIdentity extends keyof TShape & string = keyof TShape & string,
> = z.ZodObject<TShape> & {
  readonly kind: 'entity';
  readonly name: TName;
  readonly identity: TIdentity;
  readonly identitySchema: TShape[TIdentity];
  readonly id: () => EntityIdSchema<TShape[TIdentity], TName, TIdentity>;
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
      `entity("${name}") identity "${identity}" must match a declared field`
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
        `entity("${name}") example ${index} is invalid: ${formatExampleIssues(parsed.error.issues)}`
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
  entity: TName,
  identity: TIdentity,
  schema: TSchema
): EntityIdSchema<TSchema, TName, TIdentity> => {
  const branded = (schema as BrandableSchema<TSchema>).brand<
    EntityIdBrand<TName>
  >();

  // First-write-wins: if another entity already claimed this schema object
  // (possible when Zod v4 brand() returns `this`), preserve the original
  // metadata rather than silently overwriting it.
  if (!entityIdMetadata.has(branded)) {
    entityIdMetadata.set(branded, {
      entity,
      identity,
    } satisfies EntityIdMetadata<TName, TIdentity>);
  }

  return branded as EntityIdSchema<TSchema, TName, TIdentity>;
};

const attachEntityMetadata = <
  TName extends string,
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  schema: z.ZodObject<TShape>,
  metadata: {
    readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
    readonly idSchema: EntityIdSchema<TShape[TIdentity], TName, TIdentity>;
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
      value: 'entity',
      writable: false,
    },
    name: {
      enumerable: true,
      value: metadata.name,
      writable: false,
    },
  });
};

/** Read entity identity metadata from the module-level WeakMap, if present. */
const readMetadata = (schema: unknown): EntityIdMetadata | undefined =>
  typeof schema === 'object' && schema !== null
    ? entityIdMetadata.get(schema)
    : undefined;

/** Resolve the inner schema from a Zod wrapper (ZodOptional, ZodNullable, etc.). */
const unwrapInner = (schema: unknown): unknown => {
  const def = (schema as { _def?: Record<string, unknown> })._def;
  return (def?.['innerType'] ?? def?.['schema']) as unknown;
};

/**
 * Walk through Zod wrapper layers searching for `ENTITY_ID_METADATA`.
 *
 * `.nullish()` produces `ZodOptional<ZodNullable<T>>` — two wrapper levels —
 * so a single-step unwrap is insufficient. This iterates until it finds the
 * metadata or exhausts all wrapper layers.
 */
const unwrapToMetadata = (schema: unknown): EntityIdMetadata | undefined => {
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
 * Read entity-reference metadata from a schema returned by `entity.id()`.
 *
 * When the schema is wrapped by Zod combinators (`.optional()`, `.nullable()`,
 * `.default()`, `.nullish()`, etc.) the `ENTITY_ID_METADATA` symbol lives on
 * the inner schema, not on the wrapper. The unwrap handles arbitrarily nested
 * wrapper levels.
 */
export const getEntityIdMetadata = (
  schema: unknown
): EntityIdMetadata | undefined =>
  readMetadata(schema) ?? unwrapToMetadata(schema);

/** Inspect an entity schema for fields that reference other entities via `.id()`. */
export const getEntityReferences = (
  entity: AnyEntity
): readonly EntityReference[] =>
  Object.entries(entity.shape)
    .flatMap(([field, schema]) => {
      if (field === entity.identity) {
        return [];
      }
      const metadata = getEntityIdMetadata(schema);
      if (metadata === undefined) {
        return [];
      }

      return [{ field, ...metadata }];
    })
    .toSorted((left, right) =>
      left.field === right.field
        ? left.entity.localeCompare(right.entity)
        : left.field.localeCompare(right.field)
    );

/**
 * Create an entity definition from a raw Zod object shape.
 *
 * @example
 * ```typescript
 * const user = entity(
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
export const entity = <
  TName extends string,
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  name: TName,
  shape: TShape,
  options: EntityOptions<TShape, TIdentity>
): Entity<TName, TShape, TIdentity> => {
  assertIdentityField(name, shape, options.identity);

  const schema = z.object(shape);
  validateExamples(name, schema, options.examples);

  const identitySchema = shape[options.identity];
  if (!identitySchema) {
    throw new TypeError(
      `entity("${name}") identity "${options.identity}" must resolve to a schema`
    );
  }

  const idSchema = brandIdentitySchema(name, options.identity, identitySchema);
  const examples = options.examples
    ? Object.freeze([...options.examples])
    : undefined;

  attachEntityMetadata(schema, {
    examples,
    idSchema,
    identity: options.identity,
    identitySchema,
    name,
  });

  return schema as Entity<TName, TShape, TIdentity>;
};

/** Existential type for heterogeneous entity collections. */
export type AnyEntity = Entity<string, z.ZodRawShape, string>;
