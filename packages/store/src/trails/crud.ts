import type {
  Implementation,
  PermitRequirement,
  Resource,
  Trail,
} from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import type {
  DeriveTrailInput,
  DeriveTrailOutput,
} from '@ontrails/core/trails';
import type { z } from 'zod';

import type {
  AnyStoreTable,
  EntityOf,
  FiltersOf,
  InsertOf,
  StoreAccessor,
  StoreIdentifierOf,
  UpdateOf,
} from '../types.js';
import type { CrudOperation } from '../crud-doctrine.js';
import { assertCurrentEntityOption, createTableEntity } from './utils.js';
import type { TableEntity } from './utils.js';

type IdentityInputOf<TTable extends AnyStoreTable> = Readonly<
  Record<Extract<TTable['identity'], string>, StoreIdentifierOf<TTable>>
>;

type CrudConnection<TTable extends AnyStoreTable> = Readonly<
  Record<TTable['name'], StoreAccessor<TTable>>
>;

type TableEntityFieldKey<TTable extends AnyStoreTable> = Extract<
  keyof z.output<TableEntity<TTable>>,
  string
>;

type GeneratedFieldsOf<TTable extends AnyStoreTable> =
  TTable['generated'] extends readonly TableEntityFieldKey<TTable>[]
    ? TTable['generated']
    : readonly [];

/**
 * Input type `deriveTrail` derives for a given CRUD operation against a
 * store table. Uses `TableEntity<TTable>` so the derived input
 * structurally matches the entity-backed derivation path in
 * `@ontrails/core`'s `deriveTrail`.
 */
type DerivedInput<
  TTable extends AnyStoreTable,
  TOperation extends CrudOperation,
> = DeriveTrailInput<
  TableEntity<TTable>,
  TOperation,
  GeneratedFieldsOf<TTable>
>;

/**
 * Output type `deriveTrail` derives for a given CRUD operation against a
 * store table.
 */
type DerivedOutput<
  TTable extends AnyStoreTable,
  TOperation extends CrudOperation,
> = DeriveTrailOutput<TableEntity<TTable>, TOperation>;

type InternalCreateTrailOf<TTable extends AnyStoreTable> = Trail<
  DerivedInput<TTable, 'create'>,
  DerivedOutput<TTable, 'create'>
>;

type InternalReadTrailOf<TTable extends AnyStoreTable> = Trail<
  DerivedInput<TTable, 'read'>,
  DerivedOutput<TTable, 'read'>
>;

type InternalUpdateTrailOf<TTable extends AnyStoreTable> = Trail<
  DerivedInput<TTable, 'update'>,
  DerivedOutput<TTable, 'update'>
>;

type InternalDeleteTrailOf<TTable extends AnyStoreTable> = Trail<
  DerivedInput<TTable, 'delete'>,
  DerivedOutput<TTable, 'delete'>
>;

type InternalListTrailOf<TTable extends AnyStoreTable> = Trail<
  DerivedInput<TTable, 'list'>,
  DerivedOutput<TTable, 'list'>
>;

type InternalCrudBaseTrails<TTable extends AnyStoreTable> = Readonly<{
  createBase: InternalCreateTrailOf<TTable>;
  readBase: InternalReadTrailOf<TTable>;
  updateBase: InternalUpdateTrailOf<TTable>;
  deleteBase: InternalDeleteTrailOf<TTable>;
  listBase: InternalListTrailOf<TTable>;
}>;

type TrailExampleOf<TInput, TOutput> = NonNullable<
  Trail<TInput, TOutput>['examples']
>[number];

type CreateTrailOf<TTable extends AnyStoreTable> = Trail<
  InsertOf<TTable>,
  EntityOf<TTable>
>;

type ReadTrailOf<TTable extends AnyStoreTable> = Trail<
  IdentityInputOf<TTable>,
  EntityOf<TTable>
>;

type UpdateTrailOf<TTable extends AnyStoreTable> = Trail<
  IdentityInputOf<TTable> & UpdateOf<TTable>,
  EntityOf<TTable>
>;

type DeleteTrailOf<TTable extends AnyStoreTable> = Trail<
  IdentityInputOf<TTable>,
  undefined
>;

type ListTrailOf<TTable extends AnyStoreTable> = Trail<
  FiltersOf<TTable>,
  EntityOf<TTable>[]
>;

type InternalCrudTrails<TTable extends AnyStoreTable> = readonly [
  create: InternalCreateTrailOf<TTable>,
  read: InternalReadTrailOf<TTable>,
  update: InternalUpdateTrailOf<TTable>,
  remove: InternalDeleteTrailOf<TTable>,
  list: InternalListTrailOf<TTable>,
];

export type CrudTrails<TTable extends AnyStoreTable> = readonly [
  create: CreateTrailOf<TTable>,
  read: ReadTrailOf<TTable>,
  update: UpdateTrailOf<TTable>,
  remove: DeleteTrailOf<TTable>,
  list: ListTrailOf<TTable>,
] & {
  /**
   * The table entity the factory registered on its trails. Pass it to
   * `reconcile({ entity })` (or other factories over the same table) so
   * the topo sees one shared entity instance instead of rejecting two
   * same-named rebuilds as duplicates.
   */
  readonly entity: TableEntity<TTable>;
};

export interface CrudImplementationOverrides<TTable extends AnyStoreTable> {
  readonly create?: Implementation<InsertOf<TTable>, EntityOf<TTable>>;
  readonly read?: Implementation<IdentityInputOf<TTable>, EntityOf<TTable>>;
  readonly update?: Implementation<
    IdentityInputOf<TTable> & UpdateOf<TTable>,
    EntityOf<TTable>
  >;
  readonly delete?: Implementation<IdentityInputOf<TTable>, undefined>;
  readonly list?: Implementation<FiltersOf<TTable>, EntityOf<TTable>[]>;
}

export interface CrudOptions<TTable extends AnyStoreTable> {
  readonly implementation?: CrudImplementationOverrides<TTable>;
  /**
   * Existing table entity to register on the produced trails. When
   * omitted, the factory builds one from the table. Pass a shared
   * instance when another factory (e.g. `reconcile()`) covers the same
   * table so `topo()` sees a single entity registration.
   */
  readonly entity?: TableEntity<TTable>;
  /**
   * Permit requirement declared on every produced trail. Factory trails
   * carry authored defaults like any hand-written trail; per-operation
   * entries in `permits` override this baseline.
   */
  readonly permit?: PermitRequirement;
  /**
   * Per-operation permit overrides. At minimum, destroy-intent trails
   * (`delete`) need a declaration to satisfy permit governance.
   */
  readonly permits?: Partial<Record<CrudOperation, PermitRequirement>>;
}

interface InternalCrudImplementationOverrides<TTable extends AnyStoreTable> {
  readonly create?: Implementation<
    DerivedInput<TTable, 'create'>,
    DerivedOutput<TTable, 'create'>
  >;
  readonly read?: Implementation<
    DerivedInput<TTable, 'read'>,
    DerivedOutput<TTable, 'read'>
  >;
  readonly update?: Implementation<
    DerivedInput<TTable, 'update'>,
    DerivedOutput<TTable, 'update'>
  >;
  readonly delete?: Implementation<
    DerivedInput<TTable, 'delete'>,
    DerivedOutput<TTable, 'delete'>
  >;
  readonly list?: Implementation<
    DerivedInput<TTable, 'list'>,
    DerivedOutput<TTable, 'list'>
  >;
}

interface InternalCrudOptions<TTable extends AnyStoreTable> {
  readonly implementation?: InternalCrudImplementationOverrides<TTable>;
  readonly entity?: TableEntity<TTable>;
  readonly permit?: PermitRequirement;
  readonly permits?: Partial<Record<CrudOperation, PermitRequirement>>;
}

const normalizeExampleForOutput = <TInput, TOutput>(
  example: TrailExampleOf<TInput, TOutput>,
  output: z.ZodType<TOutput>
): TrailExampleOf<TInput, TOutput> | undefined => {
  if (example.expected === undefined) {
    return example;
  }

  const parsed = output.safeParse(example.expected);
  return parsed.success
    ? {
        ...example,
        expected: parsed.data,
      }
    : undefined;
};

const normalizeExamplesForOutput = <TInput, TOutput>(
  base: Trail<TInput, TOutput>,
  output: z.ZodType<TOutput>
): Trail<TInput, TOutput>['examples'] => {
  const { examples } = base;
  if (examples === undefined || examples.length === 0) {
    return undefined;
  }

  const next = examples
    .map((example) => normalizeExampleForOutput(example, output))
    .filter(
      (example): example is TrailExampleOf<TInput, TOutput> =>
        example !== undefined
    );

  return next.length === 0
    ? undefined
    : (Object.freeze(next) as Trail<TInput, TOutput>['examples']);
};

const finalizeTrail = <TInput, TOutput>(
  base: Trail<TInput, TOutput>,
  options: {
    readonly implementation?: Implementation<TInput, TOutput> | undefined;
    readonly output?: z.ZodType<TOutput> | undefined;
    readonly pattern?: string | undefined;
    readonly permit?: PermitRequirement | undefined;
  } = {}
): Trail<TInput, TOutput> =>
  Object.freeze({
    ...base,
    ...(options.implementation === undefined
      ? {}
      : { implementation: options.implementation }),
    ...(options.output === undefined
      ? {}
      : {
          examples: normalizeExamplesForOutput(base, options.output),
          output: options.output,
        }),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
    ...(options.permit === undefined ? {} : { permit: options.permit }),
  }) as Trail<TInput, TOutput>;

const deriveCrudBaseTrails = <
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  tableEntity: TableEntity<TTable>
): InternalCrudBaseTrails<TTable> => {
  // Narrow the store's `readonly string[]` to the entity's typed field-key
  // array so `deriveTrail`'s `TGenerated` generic picks up the precise
  // key-of shape that `CreateInputOf<Entity, TGenerated>` expects. The
  // runtime value is unchanged — the names in `table.generated` are already
  // keys of `table.schema.shape` by construction in `store()`.
  const generated = table.generated as GeneratedFieldsOf<TTable>;

  return {
    createBase: deriveTrail(tableEntity, 'create', {
      generated,
      resource,
    }),
    deleteBase: deriveTrail(tableEntity, 'delete', {
      resource,
    }),
    listBase: deriveTrail(tableEntity, 'list', {
      resource,
    }),
    readBase: deriveTrail(tableEntity, 'read', {
      resource,
    }),
    // The `update` implementation synthesized by `deriveTrail` handles the partial-patch
    // concern: when the accessor lacks a native `update`, the fallback path in
    // `derive-trail.ts` (`updateViaReadAndUpsert`) reads the current entity,
    // merges the patch, strips the `version` field, then calls `upsert` with
    // the full merged payload — so no fields are silently lost.
    updateBase: deriveTrail(tableEntity, 'update', {
      generated,
      resource,
    }),
  };
};

const buildCrudTrails = <TTable extends AnyStoreTable>(
  baseTrails: InternalCrudBaseTrails<TTable>,
  options: InternalCrudOptions<TTable>,
  entityOutput: z.ZodType<DerivedOutput<TTable, 'create'>>,
  listOutput: z.ZodType<DerivedOutput<TTable, 'list'>>
): InternalCrudTrails<TTable> => {
  const overrides = options.implementation ?? {};
  const permitFor = (operation: CrudOperation): PermitRequirement | undefined =>
    options.permits?.[operation] ?? options.permit;

  return Object.freeze([
    finalizeTrail(baseTrails.createBase, {
      ...(overrides.create === undefined
        ? {}
        : { implementation: overrides.create }),
      output: entityOutput,
      pattern: 'crud',
      permit: permitFor('create'),
    }),
    finalizeTrail(baseTrails.readBase, {
      ...(overrides.read === undefined
        ? {}
        : { implementation: overrides.read }),
      output: entityOutput,
      pattern: 'crud',
      permit: permitFor('read'),
    }),
    finalizeTrail(baseTrails.updateBase, {
      ...(overrides.update === undefined
        ? {}
        : { implementation: overrides.update }),
      output: entityOutput,
      pattern: 'crud',
      permit: permitFor('update'),
    }),
    overrides.delete === undefined
      ? finalizeTrail(baseTrails.deleteBase, {
          pattern: 'crud',
          permit: permitFor('delete'),
        })
      : finalizeTrail(baseTrails.deleteBase, {
          implementation: overrides.delete,
          pattern: 'crud',
          permit: permitFor('delete'),
        }),
    finalizeTrail(baseTrails.listBase, {
      ...(overrides.list === undefined
        ? {}
        : { implementation: overrides.list }),
      output: listOutput,
      pattern: 'crud',
      permit: permitFor('list'),
    }),
  ]) as InternalCrudTrails<TTable>;
};

/**
 * Produce the standard CRUD trail tuple for one normalized store table.
 *
 * The factory derives schemas, examples, resources, and entity linkage from
 * the table metadata. Implementations default to the backend-agnostic store accessor
 * contract via `deriveTrail()`'s single-resource synthesis path. Per-operation
 * implementation overrides stay available for callers that need custom persistence
 * behavior and are layered onto the derived trails in a single pass.
 */
export function crud<
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  options?: CrudOptions<TTable>
): CrudTrails<TTable>;
export function crud<
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  options: InternalCrudOptions<TTable> = {}
) {
  assertCurrentEntityOption(options, 'crud() options');
  const tableEntity = options.entity ?? createTableEntity(table);
  const baseTrails = deriveCrudBaseTrails(table, resource, tableEntity);
  // Narrow `table.schema` (typed `StoreObjectSchema`, which is
  // `z.ZodObject<Record<string, z.ZodType>>`) to a ZodObject keyed by the
  // concrete shape so its `z.output` unifies with the entity-derived
  // output. Structurally `table.schema` already has `shape:
  // TTable['schema']['shape']` — this only refines the generic parameter.
  const entitySchema = table.schema as z.ZodObject<TTable['schema']['shape']>;
  const entityOutput: z.ZodType<DerivedOutput<TTable, 'create'>> = entitySchema;
  const listOutput: z.ZodType<DerivedOutput<TTable, 'list'>> =
    entitySchema.array();

  const trails = buildCrudTrails(baseTrails, options, entityOutput, listOutput);
  // Expose the registered entity so other factories over the same table
  // (reconcile, sync) can share the instance instead of rebuilding it.
  return Object.freeze(
    Object.assign([...trails], { entity: tableEntity })
  ) as unknown as InternalCrudTrails<TTable> & {
    readonly entity: TableEntity<TTable>;
  };
}
