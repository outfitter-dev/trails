import type { Implementation, Resource, Trail } from '@ontrails/core';
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
import { createTableContour } from './utils.js';
import type { TableContour } from './utils.js';

type IdentityInputOf<TTable extends AnyStoreTable> = Readonly<
  Record<Extract<TTable['identity'], string>, StoreIdentifierOf<TTable>>
>;

type CrudConnection<TTable extends AnyStoreTable> = Readonly<
  Record<TTable['name'], StoreAccessor<TTable>>
>;

type TableContourFieldKey<TTable extends AnyStoreTable> = Extract<
  keyof z.output<TableContour<TTable>>,
  string
>;

type GeneratedFieldsOf<TTable extends AnyStoreTable> =
  readonly TableContourFieldKey<TTable>[];

/**
 * Input type `deriveTrail` projects for a given CRUD operation against a
 * store table. Routes through `TableContour<TTable>` so the projected input
 * structurally matches the contour-backed derivation path in
 * `@ontrails/core`'s `deriveTrail`.
 */
type DerivedInput<
  TTable extends AnyStoreTable,
  TOperation extends 'create' | 'read' | 'update' | 'delete' | 'list',
> = DeriveTrailInput<
  TableContour<TTable>,
  TOperation,
  GeneratedFieldsOf<TTable>
>;

/**
 * Output type `deriveTrail` projects for a given CRUD operation against a
 * store table.
 */
type DerivedOutput<
  TTable extends AnyStoreTable,
  TOperation extends 'create' | 'read' | 'update' | 'delete' | 'list',
> = DeriveTrailOutput<TableContour<TTable>, TOperation>;

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
];

export interface CrudBlazeOverrides<TTable extends AnyStoreTable> {
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
  readonly blaze?: CrudBlazeOverrides<TTable>;
}

interface InternalCrudBlazeOverrides<TTable extends AnyStoreTable> {
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
  readonly blaze?: InternalCrudBlazeOverrides<TTable>;
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
    readonly blaze?: Implementation<TInput, TOutput> | undefined;
    readonly output?: z.ZodType<TOutput> | undefined;
    readonly pattern?: string | undefined;
  } = {}
): Trail<TInput, TOutput> =>
  Object.freeze({
    ...base,
    ...(options.blaze === undefined ? {} : { blaze: options.blaze }),
    ...(options.output === undefined
      ? {}
      : {
          examples: normalizeExamplesForOutput(base, options.output),
          output: options.output,
        }),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
  }) as Trail<TInput, TOutput>;

const deriveCrudBaseTrails = <
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>
): InternalCrudBaseTrails<TTable> => {
  const entityContour = createTableContour(table);
  // Narrow the store's `readonly string[]` to the contour's typed field-key
  // array so `deriveTrail`'s `TGenerated` generic picks up the precise
  // key-of shape that `CreateInputOf<Contour, TGenerated>` expects. The
  // runtime value is unchanged — the names in `table.generated` are already
  // keys of `table.schema.shape` by construction in `store()`.
  const generated = table.generated as GeneratedFieldsOf<TTable>;

  return {
    createBase: deriveTrail(entityContour, 'create', {
      generated,
      resource,
    }),
    deleteBase: deriveTrail(entityContour, 'delete', {
      resource,
    }),
    listBase: deriveTrail(entityContour, 'list', {
      resource,
    }),
    readBase: deriveTrail(entityContour, 'read', {
      resource,
    }),
    // The `update` blaze synthesized by `deriveTrail` handles the partial-patch
    // concern: when the accessor lacks a native `update`, the fallback path in
    // `derive-trail.ts` (`updateViaReadAndUpsert`) reads the current entity,
    // merges the patch, strips the `version` field, then calls `upsert` with
    // the full merged payload — so no fields are silently lost.
    updateBase: deriveTrail(entityContour, 'update', {
      generated,
      resource,
    }),
  };
};

const buildCrudTrails = <TTable extends AnyStoreTable>(
  baseTrails: InternalCrudBaseTrails<TTable>,
  overrides: InternalCrudBlazeOverrides<TTable>,
  entityOutput: z.ZodType<DerivedOutput<TTable, 'create'>>,
  listOutput: z.ZodType<DerivedOutput<TTable, 'list'>>
): InternalCrudTrails<TTable> =>
  Object.freeze([
    finalizeTrail(baseTrails.createBase, {
      ...(overrides.create === undefined ? {} : { blaze: overrides.create }),
      output: entityOutput,
      pattern: 'crud',
    }),
    finalizeTrail(baseTrails.readBase, {
      ...(overrides.read === undefined ? {} : { blaze: overrides.read }),
      output: entityOutput,
      pattern: 'crud',
    }),
    finalizeTrail(baseTrails.updateBase, {
      ...(overrides.update === undefined ? {} : { blaze: overrides.update }),
      output: entityOutput,
      pattern: 'crud',
    }),
    overrides.delete === undefined
      ? finalizeTrail(baseTrails.deleteBase, { pattern: 'crud' })
      : finalizeTrail(baseTrails.deleteBase, {
          blaze: overrides.delete,
          pattern: 'crud',
        }),
    finalizeTrail(baseTrails.listBase, {
      ...(overrides.list === undefined ? {} : { blaze: overrides.list }),
      output: listOutput,
      pattern: 'crud',
    }),
  ]) as InternalCrudTrails<TTable>;

/**
 * Produce the standard CRUD trail tuple for one normalized store table.
 *
 * The factory derives schemas, examples, resources, and contour linkage from
 * the table metadata. Blazes default to the connector-agnostic store accessor
 * contract via `deriveTrail()`'s single-resource synthesis path. Per-operation
 * blaze overrides stay available for callers that need custom persistence
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
  const overrides = options.blaze ?? {};
  const baseTrails = deriveCrudBaseTrails(table, resource);
  // Narrow `table.schema` (typed `StoreObjectSchema`, which is
  // `z.ZodObject<Record<string, z.ZodType>>`) to a ZodObject keyed by the
  // concrete shape so its `z.output` unifies with the contour-derived
  // output. Structurally `table.schema` already has `shape:
  // TTable['schema']['shape']` — this only refines the generic parameter.
  const entitySchema = table.schema as z.ZodObject<TTable['schema']['shape']>;
  const entityOutput: z.ZodType<DerivedOutput<TTable, 'create'>> = entitySchema;
  const listOutput: z.ZodType<DerivedOutput<TTable, 'list'>> =
    entitySchema.array();

  return buildCrudTrails(baseTrails, overrides, entityOutput, listOutput);
}
