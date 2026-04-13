import type { Implementation, Resource, Trail } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
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

type IdentityInputOf<TTable extends AnyStoreTable> = Readonly<
  Record<Extract<TTable['identity'], string>, StoreIdentifierOf<TTable>>
>;

type CrudConnection<TTable extends AnyStoreTable> = Readonly<
  Record<TTable['name'], StoreAccessor<TTable>>
>;

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

type CrudBaseTrails<TTable extends AnyStoreTable> = Readonly<{
  createBase: CreateTrailOf<TTable>;
  readBase: ReadTrailOf<TTable>;
  updateBase: UpdateTrailOf<TTable>;
  deleteBase: DeleteTrailOf<TTable>;
  listBase: ListTrailOf<TTable>;
}>;

type TrailExampleOf<TInput, TOutput> = NonNullable<
  Trail<TInput, TOutput>['examples']
>[number];

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
  }) as Trail<TInput, TOutput>;

const deriveCrudBaseTrails = <
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>
): CrudBaseTrails<TTable> => {
  const entityContour = createTableContour(table);
  const generated = table.generated as readonly string[];

  return {
    createBase: deriveTrail(entityContour, 'create', {
      generated,
      resource,
    }) as unknown as CreateTrailOf<TTable>,
    deleteBase: deriveTrail(entityContour, 'delete', {
      resource,
    }) as unknown as DeleteTrailOf<TTable>,
    listBase: deriveTrail(entityContour, 'list', {
      resource,
    }) as unknown as ListTrailOf<TTable>,
    readBase: deriveTrail(entityContour, 'read', {
      resource,
    }) as unknown as ReadTrailOf<TTable>,
    // The `update` blaze synthesized by `deriveTrail` handles the partial-patch
    // concern: when the accessor lacks a native `update`, the fallback path in
    // `derive-trail.ts` (`updateViaReadAndUpsert`) reads the current entity,
    // merges the patch, strips the `version` field, then calls `upsert` with
    // the full merged payload — so no fields are silently lost.
    updateBase: deriveTrail(entityContour, 'update', {
      generated,
      resource,
    }) as unknown as UpdateTrailOf<TTable>,
  };
};

const buildCrudTrails = <TTable extends AnyStoreTable>(
  baseTrails: CrudBaseTrails<TTable>,
  overrides: CrudBlazeOverrides<TTable>,
  entityOutput: z.ZodType<EntityOf<TTable>>,
  listOutput: z.ZodType<EntityOf<TTable>[]>
): CrudTrails<TTable> =>
  Object.freeze([
    finalizeTrail(baseTrails.createBase, {
      ...(overrides.create === undefined ? {} : { blaze: overrides.create }),
      output: entityOutput,
    }),
    finalizeTrail(baseTrails.readBase, {
      ...(overrides.read === undefined ? {} : { blaze: overrides.read }),
      output: entityOutput,
    }),
    finalizeTrail(baseTrails.updateBase, {
      ...(overrides.update === undefined ? {} : { blaze: overrides.update }),
      output: entityOutput,
    }),
    overrides.delete === undefined
      ? finalizeTrail(baseTrails.deleteBase)
      : finalizeTrail(baseTrails.deleteBase, { blaze: overrides.delete }),
    finalizeTrail(baseTrails.listBase, {
      ...(overrides.list === undefined ? {} : { blaze: overrides.list }),
      output: listOutput,
    }),
  ]) as CrudTrails<TTable>;

/**
 * Produce the standard CRUD trail tuple for one normalized store table.
 *
 * The factory derives schemas, examples, resources, and contour linkage from
 * the table metadata. Blazes default to the connector-agnostic store accessor
 * contract via `deriveTrail()`'s single-resource synthesis path. Per-operation
 * blaze overrides stay available for callers that need custom persistence
 * behavior and are layered onto the derived trails in a single pass.
 */
export const crud = <
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  options: CrudOptions<TTable> = {}
): CrudTrails<TTable> => {
  const overrides = options.blaze ?? {};
  const baseTrails = deriveCrudBaseTrails(table, resource);
  const entityOutput = table.schema as unknown as z.ZodType<EntityOf<TTable>>;
  const listOutput = table.schema.array() as unknown as z.ZodType<
    EntityOf<TTable>[]
  >;

  return buildCrudTrails(baseTrails, overrides, entityOutput, listOutput);
};
