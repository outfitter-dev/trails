import { z } from 'zod';

import type { AnyContour } from '../contour.js';
import {
  DerivationError,
  InternalError,
  isTrailsError,
  NotFoundError,
} from '../errors.js';
import { stripDefaultsFromShape } from '../internal/zod-wrappers.js';
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

type ContourInput<TContour extends AnyContour> = z.input<TContour>;
type ContourOutput<TContour extends AnyContour> = z.output<TContour>;
type ContourFieldKey<TContour extends AnyContour> = Extract<
  keyof ContourOutput<TContour>,
  string
>;
type IdentityKey<TContour extends AnyContour> = Extract<
  TContour['identity'],
  keyof ContourInput<TContour> & string
>;

type GeneratedKey<
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
> = TGenerated extends readonly ContourFieldKey<TContour>[]
  ? TGenerated[number]
  : never;

type CreateInputOf<
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
> = Omit<
  ContourInput<TContour>,
  Extract<GeneratedKey<TContour, TGenerated>, keyof ContourInput<TContour>>
>;

type ReadInputOf<TContour extends AnyContour> = Pick<
  ContourInput<TContour>,
  IdentityKey<TContour>
>;

type UpdateInputOf<
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
> = ReadInputOf<TContour> &
  Partial<Omit<CreateInputOf<TContour, TGenerated>, IdentityKey<TContour>>>;

type ListInputOf<TContour extends AnyContour> = Partial<ContourInput<TContour>>;

/**
 * Input shape derived for one operation against one contour.
 */
export type DeriveTrailInput<
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined =
    | readonly ContourFieldKey<TContour>[]
    | undefined,
> = TOperation extends 'create'
  ? CreateInputOf<TContour, TGenerated>
  : TOperation extends 'read' | 'delete'
    ? ReadInputOf<TContour>
    : TOperation extends 'update'
      ? UpdateInputOf<TContour, TGenerated>
      : ListInputOf<TContour>;

/**
 * Output shape derived for one operation against one contour.
 */
export type DeriveTrailOutput<
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
> = TOperation extends 'delete'
  ? undefined
  : TOperation extends 'list'
    ? ContourOutput<TContour>[]
    : ContourOutput<TContour>;

/**
 * Extra authored data accepted by `deriveTrail()` in addition to the
 * operation-derived contract pieces.
 *
 * `blaze` is optional for single-resource calls: when omitted, the helper
 * synthesizes a default blaze that delegates to the resource's accessor via
 * the structural {@link StoreAccessorProtocol}. When multiple resources are
 * declared, an explicit `blaze` is required.
 */
export interface DeriveTrailSpec<
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined =
    | readonly ContourFieldKey<TContour>[]
    | undefined,
> extends Omit<
  TrailSpec<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >,
  | 'blaze'
  | 'contours'
  | 'examples'
  | 'input'
  | 'intent'
  | 'output'
  | 'resources'
> {
  /**
   * Implementation of the trail. Optional for single-resource calls: when
   * omitted, the helper derives a default blaze from the resource accessor
   * for standard CRUD operations.
   */
  readonly blaze?: Implementation<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;
  /**
   * Server-managed fields that should not be writable through derived create
   * and update inputs.
   */
  readonly generated?: TGenerated;
  /**
   * Resource dependency declared on the derived trail. Pass a single
   * resource for default-blaze synthesis, or an array for multi-resource
   * trails that must provide an explicit `blaze`.
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

const identityInputSchema = <TContour extends AnyContour>(
  contour: TContour
): z.ZodType<ReadInputOf<TContour>> =>
  pickFields(contour, [contour.identity]) as unknown as z.ZodType<
    ReadInputOf<TContour>
  >;

const createInputSchema = <
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  generated: readonly string[]
): z.ZodType<CreateInputOf<TContour, TGenerated>> =>
  omitFields(contour, generated) as unknown as z.ZodType<
    CreateInputOf<TContour, TGenerated>
  >;

const updateInputSchema = <
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  generated: readonly string[]
): z.ZodType<UpdateInputOf<TContour, TGenerated>> => {
  const mutableSchema = omitFields(contour, [...generated, contour.identity]);
  const identitySchema = asObjectSchema(identityInputSchema(contour));

  return identitySchema.extend(
    toPartialSchema(mutableSchema).shape
  ) as unknown as z.ZodType<UpdateInputOf<TContour, TGenerated>>;
};

const listInputSchema = <TContour extends AnyContour>(
  contour: TContour
): z.ZodType<ListInputOf<TContour>> =>
  toPartialSchema(contour) as unknown as z.ZodType<ListInputOf<TContour>>;

const deriveInputSchema = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  operation: TOperation,
  generated: readonly string[]
): z.ZodType<DeriveTrailInput<TContour, TOperation, TGenerated>> => {
  switch (operation) {
    case 'create': {
      return createInputSchema<TContour, TGenerated>(
        contour,
        generated
      ) as z.ZodType<DeriveTrailInput<TContour, TOperation, TGenerated>>;
    }
    case 'read':
    case 'delete': {
      return identityInputSchema(contour) as z.ZodType<
        DeriveTrailInput<TContour, TOperation, TGenerated>
      >;
    }
    case 'update': {
      return updateInputSchema<TContour, TGenerated>(
        contour,
        generated
      ) as z.ZodType<DeriveTrailInput<TContour, TOperation, TGenerated>>;
    }
    case 'list': {
      return listInputSchema(contour) as z.ZodType<
        DeriveTrailInput<TContour, TOperation, TGenerated>
      >;
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveOutputSchema = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
>(
  contour: TContour,
  operation: TOperation
): z.ZodType<DeriveTrailOutput<TContour, TOperation>> => {
  switch (operation) {
    case 'delete': {
      return z.void() as unknown as z.ZodType<
        DeriveTrailOutput<TContour, TOperation>
      >;
    }
    case 'list': {
      return contour.array() as unknown as z.ZodType<
        DeriveTrailOutput<TContour, TOperation>
      >;
    }
    case 'create':
    case 'read':
    case 'update': {
      return contour as unknown as z.ZodType<
        DeriveTrailOutput<TContour, TOperation>
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
  contour: AnyContour,
  operation: DeriveTrailOperation,
  example: ExampleRecord,
  index: number
): string => {
  const identifier = example[contour.identity];
  const suffix =
    identifier === undefined ? String(index + 1) : String(identifier);
  return `${titleCase(operation)} ${contour.name} ${suffix}`;
};

/**
 * Derive a single trail example from a contour fixture.
 *
 * @remarks
 * For `list` operations, each derived example wraps a single fixture in an
 * array (`expected: [example]`) and uses the fixture's identity as input
 * filters. This means the expected output is always a one-element array,
 * which may not match the real accessor behavior when multiple fixtures
 * share the same filter. A custom `blaze` with hand-authored examples is
 * required for multi-result list assertions.
 */
const deriveExample = (
  contour: AnyContour,
  operation: DeriveTrailOperation,
  example: ExampleRecord,
  index: number,
  generated: readonly string[]
): TrailExample<unknown, unknown> => {
  const name = formatExampleName(contour, operation, example, index);
  const identity = pickValueFields(example, [contour.identity]);

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
          ...omitValueFields(example, [...generated, contour.identity]),
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
  contour: AnyContour,
  operation: DeriveTrailOperation,
  generated: readonly string[]
): readonly TrailExample<unknown, unknown>[] | undefined => {
  if (contour.examples === undefined || contour.examples.length === 0) {
    return undefined;
  }

  // List examples use a single example with all fixtures in expected,
  // since input: {} returns the full set from a seeded mock. Expected
  // values keep generated fields (createdAt, etc.) because the mock
  // populates them — stripping them would fail output schema validation.
  if (operation === 'list') {
    return Object.freeze([
      {
        expected: contour.examples,
        input: {},
        name: `${contour.name} list example`,
      },
    ]);
  }

  return Object.freeze(
    contour.examples.map((example, index) =>
      deriveExample(
        contour,
        operation,
        example as ExampleRecord,
        index,
        generated
      )
    )
  );
};

// ---------------------------------------------------------------------------
// Default-blaze synthesis
// ---------------------------------------------------------------------------

type GenericAccessor = StoreAccessorProtocol<
  unknown,
  unknown,
  unknown,
  unknown
>;

const wrapUnexpected = (
  contourName: string,
  operation: DeriveTrailOperation,
  error: unknown
): Error => {
  if (isTrailsError(error)) {
    return error;
  }
  const cause = error instanceof Error ? error : new Error(String(error));
  return new InternalError(
    `deriveTrail("${contourName}.${operation}") synthesized blaze failed: ${cause.message}`,
    { cause }
  );
};

const notFoundError = (contourName: string, id: unknown): NotFoundError =>
  new NotFoundError(
    `deriveTrail("${contourName}"): entity "${String(id)}" not found`
  );

const resolveAccessor = (
  contour: AnyContour,
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
        `deriveTrail("${contour.name}.${operation}"): resource "${resource.id}" produced no connection`
      );
    }
    const accessor = connection[contour.name];
    if (accessor === undefined) {
      return new InternalError(
        `deriveTrail("${contour.name}.${operation}"): resource "${resource.id}" does not expose an accessor for "${contour.name}"`
      );
    }
    return accessor;
  } catch (error) {
    return wrapUnexpected(contour.name, operation, error);
  }
};

const extractIdentity = (contour: AnyContour, input: unknown): unknown => {
  const record = input as Record<string, unknown>;
  return record[contour.identity];
};

const callRead = async (
  contour: AnyContour,
  accessor: GenericAccessor,
  input: unknown
): Promise<Result<unknown, Error>> => {
  if (typeof accessor.get !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${contour.name}.read"): accessor is missing a \`get\` method`
      )
    );
  }
  try {
    const id = extractIdentity(contour, input);
    const entity = await accessor.get(id);
    if (entity === null || entity === undefined) {
      return Result.err(notFoundError(contour.name, id));
    }
    return Result.ok(entity);
  } catch (error) {
    return Result.err(wrapUnexpected(contour.name, 'read', error));
  }
};

const callCreate = async (
  contour: AnyContour,
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
          `deriveTrail("${contour.name}.create"): accessor is missing both \`insert\` and \`upsert\``
        )
      );
    }
    ctx.logger?.debug(
      `deriveTrail("${contour.name}.create"): accessor has no \`insert\`; falling back to \`upsert\``
    );
    const created = await accessor.upsert(input);
    return Result.ok(created);
  } catch (error) {
    return Result.err(wrapUnexpected(contour.name, 'create', error));
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
  contour: AnyContour,
  accessor: GenericAccessor,
  id: unknown,
  patch: Record<string, unknown>,
  generated: readonly string[]
): Promise<Result<unknown, Error>> => {
  if (typeof accessor.get !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${contour.name}.update"): accessor is missing both \`update\` and \`get\``
      )
    );
  }
  if (typeof accessor.upsert !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${contour.name}.update"): accessor is missing both \`update\` and \`upsert\``
      )
    );
  }
  const current = await accessor.get(id);
  if (current === null || current === undefined) {
    return Result.err(notFoundError(contour.name, id));
  }
  const merged = stripGeneratedFields(
    { ...(current as Record<string, unknown>), ...patch },
    generated,
    contour.identity
  );
  const updated = await accessor.upsert(merged);
  return Result.ok(updated);
};

const callUpdate = async (
  contour: AnyContour,
  accessor: GenericAccessor,
  input: unknown,
  generated: readonly string[]
): Promise<Result<unknown, Error>> => {
  const id = extractIdentity(contour, input);
  const patch = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([field]) => field !== contour.identity
    )
  );

  try {
    if (typeof accessor.update === 'function') {
      const updated = await accessor.update(id, patch);
      if (updated === null || updated === undefined) {
        return Result.err(notFoundError(contour.name, id));
      }
      return Result.ok(updated);
    }
    return await updateViaReadAndUpsert(
      contour,
      accessor,
      id,
      patch,
      generated
    );
  } catch (error) {
    return Result.err(wrapUnexpected(contour.name, 'update', error));
  }
};

const callDelete = async (
  contour: AnyContour,
  accessor: GenericAccessor,
  input: unknown
): Promise<Result<undefined, Error>> => {
  if (typeof accessor.remove !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${contour.name}.delete"): accessor is missing a \`remove\` method`
      )
    );
  }
  try {
    const id = extractIdentity(contour, input);
    await accessor.remove(id);
    // `{ deleted: false }` is a no-op on an absent row, not an error —
    // matches the accessor's documented semantic.
    return Result.ok();
  } catch (error) {
    return Result.err(wrapUnexpected(contour.name, 'delete', error));
  }
};

/**
 * Default `list` synthesis passes the entire input as the filter bag. The
 * derived input type is `Partial<ContourInput>` which matches the accessor's
 * filter shape field-for-field. Pagination controls are not derived — callers
 * that need pagination must provide an explicit blaze.
 */
const callList = async (
  contour: AnyContour,
  accessor: GenericAccessor,
  input: unknown
): Promise<Result<unknown[], Error>> => {
  if (typeof accessor.list !== 'function') {
    return Result.err(
      new InternalError(
        `deriveTrail("${contour.name}.list"): accessor is missing a \`list\` method`
      )
    );
  }
  try {
    const listed = await accessor.list(input);
    return Result.ok([...listed]);
  } catch (error) {
    return Result.err(wrapUnexpected(contour.name, 'list', error));
  }
};

const synthesizeDefaultBlaze = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  operation: TOperation,
  resource: AnyResource,
  generated: readonly string[]
): Implementation<
  DeriveTrailInput<TContour, TOperation, TGenerated>,
  DeriveTrailOutput<TContour, TOperation>
> => {
  const impl: Implementation<unknown, unknown> = (input, ctx) => {
    const accessor = resolveAccessor(contour, operation, resource, ctx);
    if (accessor instanceof Error) {
      return Promise.resolve(Result.err(accessor));
    }
    switch (operation) {
      case 'create': {
        return callCreate(contour, accessor, input, ctx);
      }
      case 'read': {
        return callRead(contour, accessor, input);
      }
      case 'update': {
        return callUpdate(contour, accessor, input, generated);
      }
      case 'delete': {
        return callDelete(contour, accessor, input);
      }
      case 'list': {
        return callList(contour, accessor, input);
      }
      default: {
        return unsupportedOperation(operation);
      }
    }
  };

  return impl as Implementation<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;
};

/**
 * Mechanically project one CRUD-shaped trail from a contour declaration.
 *
 * When `spec.blaze` is omitted and the call declares a single resource, the
 * helper derives a default blaze that dispatches to the resource accessor
 * through the structural {@link StoreAccessorProtocol}. Multi-resource calls
 * must supply an explicit blaze and are rejected with {@link DerivationError}
 * at construction time when they do not.
 */
export const deriveTrail = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined =
    | readonly ContourFieldKey<TContour>[]
    | undefined,
>(
  contour: TContour,
  operation: TOperation,
  spec: DeriveTrailSpec<TContour, TOperation, TGenerated>
): Trail<
  DeriveTrailInput<TContour, TOperation, TGenerated>,
  DeriveTrailOutput<TContour, TOperation>
> => {
  const resources = normalizeResources(spec.resource);
  const generated = uniqueStrings(
    spec.generated as readonly string[] | undefined
  );

  let blaze: Implementation<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;
  if (typeof spec.blaze === 'function') {
    ({ blaze } = spec);
  } else if (resources.length === 1) {
    blaze = synthesizeDefaultBlaze<TContour, TOperation, TGenerated>(
      contour,
      operation,
      resources[0] as AnyResource,
      generated
    );
  } else {
    throw new DerivationError(
      `deriveTrail("${contour.name}.${operation}") requires an explicit \`blaze\` when ${describeDeriveTrailResourceDeclaration(resources.length)} — default synthesis is single-resource only`
    );
  }
  const {
    blaze: _blaze,
    resource: _resource,
    generated: _generated,
    ...trailSpec
  } = spec;
  const derivedSpec = {
    ...trailSpec,
    blaze,
    contours: [contour],
    examples: deriveExamples(contour, operation, generated),
    input: deriveInputSchema<TContour, TOperation, TGenerated>(
      contour,
      operation,
      generated
    ),
    intent: operationIntent[operation],
    output: deriveOutputSchema(contour, operation),
    resources,
  } as unknown as TrailSpec<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;

  return trail(`${contour.name}.${operation}`, derivedSpec) as unknown as Trail<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;
};
