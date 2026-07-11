import { z } from 'zod';

import type { AnyEntity } from '../entity.js';
import {
  DerivationError,
  InternalError,
  isTrailsError,
  NotFoundError,
} from '../errors.js';
import { stripDefaultsFromShape } from '../zod-wrappers.js';
import type { AnyResource } from '../resource.js';
import { Result } from '../result.js';
import type { StoreAccessorProtocol } from '../store/accessor-protocol.js';
import { trail } from '../trail.js';
import type { Trail, TrailExample, TrailSpec } from '../trail.js';
import type { Implementation, TrailContext } from '../types.js';

/**
 * CRUD-shaped operations the base trail derivation helper understands.
 */
export type DeriveTrailOperation =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list';

type EntityInput<TEntity extends AnyEntity> = z.input<TEntity>;
type EntityOutput<TEntity extends AnyEntity> = z.output<TEntity>;
type EntityFieldKey<TEntity extends AnyEntity> = Extract<
  keyof EntityOutput<TEntity>,
  string
>;
type IdentityKey<TEntity extends AnyEntity> = Extract<
  TEntity['identity'],
  keyof EntityInput<TEntity> & string
>;

type GeneratedKey<
  TEntity extends AnyEntity,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
> = TGenerated extends readonly EntityFieldKey<TEntity>[]
  ? TGenerated[number]
  : never;

type CreateInputOf<
  TEntity extends AnyEntity,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
> = Omit<
  EntityInput<TEntity>,
  Extract<GeneratedKey<TEntity, TGenerated>, keyof EntityInput<TEntity>>
>;

type ReadInputOf<TEntity extends AnyEntity> = Pick<
  EntityInput<TEntity>,
  IdentityKey<TEntity>
>;

type UpdateInputOf<
  TEntity extends AnyEntity,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
> = ReadInputOf<TEntity> &
  Partial<Omit<CreateInputOf<TEntity, TGenerated>, IdentityKey<TEntity>>>;

type ListInputOf<TEntity extends AnyEntity> = Partial<EntityInput<TEntity>>;

/**
 * Input shape derived for one operation against one entity.
 */
export type DeriveTrailInput<
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined =
    | readonly EntityFieldKey<TEntity>[]
    | undefined,
> = TOperation extends 'create'
  ? CreateInputOf<TEntity, TGenerated>
  : TOperation extends 'read' | 'delete'
    ? ReadInputOf<TEntity>
    : TOperation extends 'update'
      ? UpdateInputOf<TEntity, TGenerated>
      : ListInputOf<TEntity>;

/**
 * Output shape derived for one operation against one entity.
 */
export type DeriveTrailOutput<
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
> = TOperation extends 'delete'
  ? undefined
  : TOperation extends 'list'
    ? EntityOutput<TEntity>[]
    : EntityOutput<TEntity>;

/**
 * Extra authored data accepted by `deriveTrail()` in addition to the
 * operation-derived contract pieces.
 *
 * `implementation` is optional for single-resource calls: when omitted, the helper
 * synthesizes a default implementation that delegates to the resource's accessor via
 * the structural {@link StoreAccessorProtocol}. When multiple resources are
 * declared, an explicit `implementation` is required.
 */
export interface DeriveTrailSpec<
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined =
    | readonly EntityFieldKey<TEntity>[]
    | undefined,
> extends Omit<
  TrailSpec<
    DeriveTrailInput<TEntity, TOperation, TGenerated>,
    DeriveTrailOutput<TEntity, TOperation>
  >,
  | 'implementation'
  | 'entities'
  | 'examples'
  | 'input'
  | 'intent'
  | 'output'
  | 'resources'
> {
  /**
   * Implementation of the trail. Optional for single-resource calls: when
   * omitted, the helper derives a default implementation from the resource accessor
   * for standard CRUD operations.
   */
  readonly implementation?: Implementation<
    DeriveTrailInput<TEntity, TOperation, TGenerated>,
    DeriveTrailOutput<TEntity, TOperation>
  >;
  /**
   * Server-managed fields that should not be writable through derived create
   * and update inputs.
   */
  readonly generated?: TGenerated;
  /**
   * Resource dependency declared on the derived trail. Pass a single
   * resource for default-implementation synthesis, or an array for multi-resource
   * trails that must provide an explicit `implementation`.
   */
  readonly resource: AnyResource | readonly AnyResource[];
}

const operationIntent = {
  create: 'write',
  delete: 'destroy',
  list: 'read',
  read: 'read',
  update: 'write',
} as const;

const describeDeriveTrailResourceDeclaration = (
  resourceCount: number
): string =>
  resourceCount === 0
    ? 'no resources are declared'
    : 'multiple resources are declared';

const titleCase = (value: string): string =>
  value.length === 0 ? value : value.slice(0, 1).toUpperCase() + value.slice(1);

const uniqueStrings = (
  values: readonly string[] | undefined
): readonly string[] =>
  Object.freeze([...(values === undefined ? [] : new Set(values))]);

const buildFieldMask = (fields: readonly string[]): Record<string, true> =>
  Object.fromEntries(fields.map((field) => [field, true] as const)) as Record<
    string,
    true
  >;

type AnyObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

const asObjectSchema = (schema: z.ZodType): AnyObjectSchema =>
  schema as unknown as AnyObjectSchema;

const unsupportedOperation = (operation: never): never => {
  throw new DerivationError(
    `Unsupported deriveTrail() operation: ${String(operation)}`
  );
};

const omitFields = (
  schema: z.ZodType,
  fields: readonly string[]
): AnyObjectSchema => {
  const objectSchema = asObjectSchema(schema);

  return fields.length === 0
    ? objectSchema
    : (objectSchema.omit(buildFieldMask(fields)) as unknown as AnyObjectSchema);
};

const pickFields = (
  schema: z.ZodType,
  fields: readonly string[]
): AnyObjectSchema =>
  asObjectSchema(schema).pick(
    buildFieldMask(fields)
  ) as unknown as AnyObjectSchema;

const toPartialSchema = (schema: z.ZodType): AnyObjectSchema =>
  asObjectSchema(schema)
    .extend(stripDefaultsFromShape(schema))
    .partial() as unknown as AnyObjectSchema;

const normalizeResources = (
  resource: AnyResource | readonly AnyResource[]
): readonly AnyResource[] =>
  Object.freeze(Array.isArray(resource) ? [...resource] : [resource]);

const identityInputSchema = <TEntity extends AnyEntity>(
  entity: TEntity
): z.ZodType<ReadInputOf<TEntity>> =>
  pickFields(entity, [entity.identity]) as unknown as z.ZodType<
    ReadInputOf<TEntity>
  >;

const createInputSchema = <
  TEntity extends AnyEntity,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
>(
  entity: TEntity,
  generated: readonly string[]
): z.ZodType<CreateInputOf<TEntity, TGenerated>> =>
  omitFields(entity, generated) as unknown as z.ZodType<
    CreateInputOf<TEntity, TGenerated>
  >;

const updateInputSchema = <
  TEntity extends AnyEntity,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
>(
  entity: TEntity,
  generated: readonly string[]
): z.ZodType<UpdateInputOf<TEntity, TGenerated>> => {
  const mutableSchema = omitFields(entity, [...generated, entity.identity]);
  const identitySchema = asObjectSchema(identityInputSchema(entity));

  return identitySchema.extend(
    toPartialSchema(mutableSchema).shape
  ) as unknown as z.ZodType<UpdateInputOf<TEntity, TGenerated>>;
};

const listInputSchema = <TEntity extends AnyEntity>(
  entity: TEntity
): z.ZodType<ListInputOf<TEntity>> =>
  toPartialSchema(entity) as unknown as z.ZodType<ListInputOf<TEntity>>;

const deriveInputSchema = <
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
>(
  entity: TEntity,
  operation: TOperation,
  generated: readonly string[]
): z.ZodType<DeriveTrailInput<TEntity, TOperation, TGenerated>> => {
  switch (operation) {
    case 'create': {
      return createInputSchema<TEntity, TGenerated>(
        entity,
        generated
      ) as z.ZodType<DeriveTrailInput<TEntity, TOperation, TGenerated>>;
    }
    case 'read':
    case 'delete': {
      return identityInputSchema(entity) as z.ZodType<
        DeriveTrailInput<TEntity, TOperation, TGenerated>
      >;
    }
    case 'update': {
      return updateInputSchema<TEntity, TGenerated>(
        entity,
        generated
      ) as z.ZodType<DeriveTrailInput<TEntity, TOperation, TGenerated>>;
    }
    case 'list': {
      return listInputSchema(entity) as z.ZodType<
        DeriveTrailInput<TEntity, TOperation, TGenerated>
      >;
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveOutputSchema = <
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
>(
  entity: TEntity,
  operation: TOperation
): z.ZodType<DeriveTrailOutput<TEntity, TOperation>> => {
  switch (operation) {
    case 'delete': {
      return z.void() as unknown as z.ZodType<
        DeriveTrailOutput<TEntity, TOperation>
      >;
    }
    case 'list': {
      return entity.array() as unknown as z.ZodType<
        DeriveTrailOutput<TEntity, TOperation>
      >;
    }
    case 'create':
    case 'read':
    case 'update': {
      return entity as unknown as z.ZodType<
        DeriveTrailOutput<TEntity, TOperation>
      >;
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

type ExampleRecord = Readonly<Record<string, unknown>>;

const pickValueFields = (
  example: ExampleRecord,
  fields: readonly string[]
): Record<string, unknown> =>
  Object.fromEntries(
    fields.flatMap((field) =>
      Object.hasOwn(example, field) ? [[field, example[field]]] : []
    )
  );

const omitValueFields = (
  example: ExampleRecord,
  fields: readonly string[]
): Record<string, unknown> => {
  const omitted = new Set(fields);

  return Object.fromEntries(
    Object.entries(example).filter(([field]) => !omitted.has(field))
  );
};

const formatExampleName = (
  entity: AnyEntity,
  operation: DeriveTrailOperation,
  example: ExampleRecord,
  index: number
): string => {
  const identifier = example[entity.identity];
  const suffix =
    identifier === undefined ? String(index + 1) : String(identifier);
  return `${titleCase(operation)} ${entity.name} ${suffix}`;
};

/**
 * Derive a single trail example from a entity fixture.
 *
 * @remarks
 * For `list` operations, each derived example wraps a single fixture in an
 * array (`expected: [example]`) and uses the fixture's identity as input
 * filters. This means the expected output is always a one-element array,
 * which may not match the real accessor behavior when multiple fixtures
 * share the same filter. A custom `implementation` with hand-authored examples is
 * required for multi-result list assertions.
 */
const deriveExample = (
  entity: AnyEntity,
  operation: DeriveTrailOperation,
  example: ExampleRecord,
  index: number,
  generated: readonly string[]
): TrailExample<unknown, unknown> => {
  const name = formatExampleName(entity, operation, example, index);
  const identity = pickValueFields(example, [entity.identity]);

  switch (operation) {
    case 'create': {
      return {
        expected: example,
        input: omitValueFields(example, generated),
        name,
      };
    }
    case 'read': {
      return {
        expected: example,
        input: identity,
        name,
      };
    }
    case 'update': {
      return {
        expected: example,
        input: {
          ...omitValueFields(example, [...generated, entity.identity]),
          ...identity,
        },
        name,
      };
    }
    case 'delete': {
      return {
        input: identity,
        name,
      };
    }
    case 'list': {
      return {
        expected: [example],
        input: {},
        name,
      };
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveExamples = (
  entity: AnyEntity,
  operation: DeriveTrailOperation,
  generated: readonly string[]
): readonly TrailExample<unknown, unknown>[] | undefined => {
  if (entity.examples === undefined || entity.examples.length === 0) {
    return undefined;
  }

  // List examples use a single example with all fixtures in expected,
  // since input: {} returns the full set from a seeded mock. Expected
  // values keep generated fields (createdAt, etc.) because the mock
  // populates them — stripping them would fail output schema validation.
  if (operation === 'list') {
    return Object.freeze([
      {
        expected: entity.examples,
        input: {},
        name: `${entity.name} list example`,
      },
    ]);
  }

  return Object.freeze(
    entity.examples.map((example, index) =>
      deriveExample(
        entity,
        operation,
        example as ExampleRecord,
        index,
        generated
      )
    )
  );
};

// ---------------------------------------------------------------------------
// Default-implementation synthesis
// ---------------------------------------------------------------------------

type GenericAccessor = StoreAccessorProtocol<
  unknown,
  unknown,
  unknown,
  unknown
>;

const wrapUnexpected = (
  entityName: string,
  operation: DeriveTrailOperation,
  error: unknown
): Error => {
  if (isTrailsError(error)) {
    return error;
  }
  const cause = error instanceof Error ? error : new Error(String(error));
  return new InternalError(
    `deriveTrail("${entityName}.${operation}") synthesized implementation failed: ${cause.message}`,
    { cause }
  );
};

const notFoundError = (entityName: string, id: unknown): NotFoundError =>
  new NotFoundError(
    `deriveTrail("${entityName}"): entity "${String(id)}" not found`
  );

const resolveAccessor = (
  entity: AnyEntity,
  operation: DeriveTrailOperation,
  resource: AnyResource,
  ctx: TrailContext
): GenericAccessor | Error => {
  try {
    const connection = resource.from(ctx) as
      | Readonly<Record<string, GenericAccessor>>
      | undefined;
    if (connection === undefined || connection === null) {
      return new InternalError(
        `deriveTrail("${entity.name}.${operation}"): resource "${resource.id}" produced no connection`
      );
    }
    const accessor = connection[entity.name];
    if (accessor === undefined) {
      return new InternalError(
        `deriveTrail("${entity.name}.${operation}"): resource "${resource.id}" does not expose an accessor for "${entity.name}"`
      );
    }
    return accessor;
  } catch (error) {
    return wrapUnexpected(entity.name, operation, error);
  }
};

const extractIdentity = (entity: AnyEntity, input: unknown): unknown => {
  const record = input as Record<string, unknown>;
  return record[entity.identity];
};

const callRead = async (
  entity: AnyEntity,
  accessor: GenericAccessor,
  input: unknown
): Promise<Result<unknown, Error>> => {
  if (typeof accessor.get !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${entity.name}.read"): accessor is missing a \`get\` method`
      )
    );
  }
  try {
    const id = extractIdentity(entity, input);
    const foundEntity = await accessor.get(id);
    if (foundEntity === null || foundEntity === undefined) {
      return Result.err(notFoundError(entity.name, id));
    }
    return Result.ok(foundEntity);
  } catch (error) {
    return Result.err(wrapUnexpected(entity.name, 'read', error));
  }
};

const callCreate = async (
  entity: AnyEntity,
  accessor: GenericAccessor,
  input: unknown,
  ctx: TrailContext
): Promise<Result<unknown, Error>> => {
  try {
    if (typeof accessor.insert === 'function') {
      const created = await accessor.insert(input);
      return Result.ok(created);
    }

    // Fallback: tabular contract allows `upsert` when `insert` is absent.
    // The warden flags this at build time via a pattern rule (trl-251).
    if (typeof accessor.upsert !== 'function') {
      return Result.err(
        new InternalError(
          `deriveTrail("${entity.name}.create"): accessor is missing both \`insert\` and \`upsert\``
        )
      );
    }
    ctx.logger?.debug(
      `deriveTrail("${entity.name}.create"): accessor has no \`insert\`; falling back to \`upsert\``
    );
    const created = await accessor.upsert(input);
    return Result.ok(created);
  } catch (error) {
    return Result.err(wrapUnexpected(entity.name, 'create', error));
  }
};

/**
 * Strip framework-managed generated fields from a merged payload so that
 * the update-via-upsert fallback doesn't carry stale managed values.
 *
 * Only strips fields that appear in the `generated` array — user-defined
 * fields with the same name (e.g. an API `version` string) are preserved.
 */
const stripGeneratedFields = (
  payload: Record<string, unknown>,
  generated: readonly string[],
  identity: string
): Record<string, unknown> => {
  if (generated.length === 0) {
    return payload;
  }
  const managedKeys = new Set(generated);
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => key === identity || !managedKeys.has(key)
    )
  );
};

/**
 * Fallback for accessors that lack a native `update`: read the current
 * entity, merge the patch, strip any `version` field so versioned tables
 * keep `update`'s "does not participate in optimistic concurrency" semantic,
 * then `upsert`.
 */
const updateViaReadAndUpsert = async (
  entity: AnyEntity,
  accessor: GenericAccessor,
  id: unknown,
  patch: Record<string, unknown>,
  generated: readonly string[]
): Promise<Result<unknown, Error>> => {
  if (typeof accessor.get !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${entity.name}.update"): accessor is missing both \`update\` and \`get\``
      )
    );
  }
  if (typeof accessor.upsert !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${entity.name}.update"): accessor is missing both \`update\` and \`upsert\``
      )
    );
  }
  const current = await accessor.get(id);
  if (current === null || current === undefined) {
    return Result.err(notFoundError(entity.name, id));
  }
  const merged = stripGeneratedFields(
    { ...(current as Record<string, unknown>), ...patch },
    generated,
    entity.identity
  );
  const updated = await accessor.upsert(merged);
  return Result.ok(updated);
};

const callUpdate = async (
  entity: AnyEntity,
  accessor: GenericAccessor,
  input: unknown,
  generated: readonly string[]
): Promise<Result<unknown, Error>> => {
  const id = extractIdentity(entity, input);
  const patch = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([field]) => field !== entity.identity
    )
  );

  try {
    if (typeof accessor.update === 'function') {
      const updated = await accessor.update(id, patch);
      if (updated === null || updated === undefined) {
        return Result.err(notFoundError(entity.name, id));
      }
      return Result.ok(updated);
    }
    return await updateViaReadAndUpsert(entity, accessor, id, patch, generated);
  } catch (error) {
    return Result.err(wrapUnexpected(entity.name, 'update', error));
  }
};

const callDelete = async (
  entity: AnyEntity,
  accessor: GenericAccessor,
  input: unknown
): Promise<Result<undefined, Error>> => {
  if (typeof accessor.remove !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${entity.name}.delete"): accessor is missing a \`remove\` method`
      )
    );
  }
  try {
    const id = extractIdentity(entity, input);
    await accessor.remove(id);
    // `{ deleted: false }` is a no-op on an absent row, not an error —
    // matches the accessor's documented semantic.
    return Result.ok();
  } catch (error) {
    return Result.err(wrapUnexpected(entity.name, 'delete', error));
  }
};

/**
 * Default `list` synthesis passes the entire input as the filter bag. The
 * derived input type is `Partial<EntityInput>` which matches the accessor's
 * filter shape field-for-field. Pagination controls are not derived — callers
 * that need pagination must provide an explicit implementation.
 */
const callList = async (
  entity: AnyEntity,
  accessor: GenericAccessor,
  input: unknown
): Promise<Result<unknown[], Error>> => {
  if (typeof accessor.list !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${entity.name}.list"): accessor is missing a \`list\` method`
      )
    );
  }
  try {
    const listed = await accessor.list(input);
    return Result.ok([...listed]);
  } catch (error) {
    return Result.err(wrapUnexpected(entity.name, 'list', error));
  }
};

const synthesizeDefaultImplementation = <
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined,
>(
  entity: TEntity,
  operation: TOperation,
  resource: AnyResource,
  generated: readonly string[]
): Implementation<
  DeriveTrailInput<TEntity, TOperation, TGenerated>,
  DeriveTrailOutput<TEntity, TOperation>
> => {
  const impl: Implementation<unknown, unknown> = (input, ctx) => {
    const accessor = resolveAccessor(entity, operation, resource, ctx);
    if (accessor instanceof Error) {
      return Promise.resolve(Result.err(accessor));
    }
    switch (operation) {
      case 'create': {
        return callCreate(entity, accessor, input, ctx);
      }
      case 'read': {
        return callRead(entity, accessor, input);
      }
      case 'update': {
        return callUpdate(entity, accessor, input, generated);
      }
      case 'delete': {
        return callDelete(entity, accessor, input);
      }
      case 'list': {
        return callList(entity, accessor, input);
      }
      default: {
        return unsupportedOperation(operation);
      }
    }
  };

  return impl as Implementation<
    DeriveTrailInput<TEntity, TOperation, TGenerated>,
    DeriveTrailOutput<TEntity, TOperation>
  >;
};

/**
 * Mechanically project one CRUD-shaped trail from a entity declaration.
 *
 * When `spec.implementation` is omitted and the call declares a single resource, the
 * helper derives a default implementation that dispatches to the resource accessor
 * through the structural {@link StoreAccessorProtocol}. Multi-resource calls
 * must supply an explicit implementation and are rejected with {@link DerivationError}
 * at construction time when they do not.
 */
export const deriveTrail = <
  TEntity extends AnyEntity,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly EntityFieldKey<TEntity>[] | undefined =
    | readonly EntityFieldKey<TEntity>[]
    | undefined,
>(
  entity: TEntity,
  operation: TOperation,
  spec: DeriveTrailSpec<TEntity, TOperation, TGenerated>
): Trail<
  DeriveTrailInput<TEntity, TOperation, TGenerated>,
  DeriveTrailOutput<TEntity, TOperation>
> => {
  const resources = normalizeResources(spec.resource);
  const generated = uniqueStrings(
    spec.generated as readonly string[] | undefined
  );

  let implementation: Implementation<
    DeriveTrailInput<TEntity, TOperation, TGenerated>,
    DeriveTrailOutput<TEntity, TOperation>
  >;
  if (typeof spec.implementation === 'function') {
    ({ implementation } = spec);
  } else if (resources.length === 1) {
    implementation = synthesizeDefaultImplementation<
      TEntity,
      TOperation,
      TGenerated
    >(entity, operation, resources[0] as AnyResource, generated);
  } else {
    throw new DerivationError(
      `deriveTrail("${entity.name}.${operation}") requires an explicit \`implementation\` when ${describeDeriveTrailResourceDeclaration(resources.length)} — default synthesis is single-resource only`
    );
  }
  const {
    implementation: _implementation,
    resource: _resource,
    generated: _generated,
    ...trailSpec
  } = spec;
  const derivedSpec = {
    ...trailSpec,
    entities: [entity],
    examples: deriveExamples(entity, operation, generated),
    implementation,
    input: deriveInputSchema<TEntity, TOperation, TGenerated>(
      entity,
      operation,
      generated
    ),
    intent: operationIntent[operation],
    output: deriveOutputSchema(entity, operation),
    resources,
  } as unknown as TrailSpec<
    DeriveTrailInput<TEntity, TOperation, TGenerated>,
    DeriveTrailOutput<TEntity, TOperation>
  >;

  return trail(`${entity.name}.${operation}`, derivedSpec) as unknown as Trail<
    DeriveTrailInput<TEntity, TOperation, TGenerated>,
    DeriveTrailOutput<TEntity, TOperation>
  >;
};
