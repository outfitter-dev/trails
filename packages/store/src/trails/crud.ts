import {
  contour,
  InternalError,
  isTrailsError,
  NotFoundError,
  Result,
} from '@ontrails/core';
import type {
  AnyContour,
  Implementation,
  Resource,
  Trail,
} from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import type { z } from 'zod';

import type {
  AnyStoreTable,
  EntityOf,
  FiltersOf,
  InsertOf,
  StoreAccessor,
  StoreIdentifierOf,
  StoreTableAccessor,
  UpdateOf,
  UpsertOf,
} from '../types.js';

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

const contourCache = new WeakMap<AnyStoreTable, AnyContour>();

const createTableContour = <TTable extends AnyStoreTable>(
  table: TTable
): AnyContour => {
  const cached = contourCache.get(table);
  if (cached) {
    return cached;
  }

  const derived = contour(
    table.name,
    table.schema.shape as unknown as Record<string, z.ZodType>,
    {
      examples: table.fixtures as readonly Record<string, unknown>[],
      identity: table.identity,
    }
  ) as AnyContour;

  contourCache.set(table, derived);
  return derived;
};

const resolveAccessor = <
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  ctx: Parameters<Resource<TConnection>['from']>[0]
): StoreAccessor<TTable> => {
  const connection = resource.from(ctx);
  return connection[table.name as keyof TConnection] as StoreAccessor<TTable>;
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const mapCrudError = (
  tableName: string,
  operation: 'create' | 'delete' | 'list' | 'read' | 'update',
  error: unknown
): Error => {
  if (isTrailsError(error)) {
    return error;
  }

  const resolved = asError(error);
  return new InternalError(
    `crud("${tableName}").${operation} failed: ${resolved.message}`,
    { cause: resolved }
  );
};

const missingEntityError = <TTable extends AnyStoreTable>(
  table: TTable,
  id: StoreIdentifierOf<TTable>
): NotFoundError =>
  new NotFoundError(
    `Store table "${table.name}" could not find entity "${String(id)}"`
  );

const hasInsert = <TTable extends AnyStoreTable>(
  accessor: StoreAccessor<TTable>
): accessor is StoreTableAccessor<TTable> =>
  'insert' in accessor && typeof accessor.insert === 'function';

const hasUpdate = <TTable extends AnyStoreTable>(
  accessor: StoreAccessor<TTable>
): accessor is StoreTableAccessor<TTable> =>
  'update' in accessor && typeof accessor.update === 'function';

const splitUpdateInput = <TTable extends AnyStoreTable>(
  table: TTable,
  input: IdentityInputOf<TTable> & UpdateOf<TTable>
): {
  readonly id: StoreIdentifierOf<TTable>;
  readonly patch: UpdateOf<TTable>;
} => {
  const record = input as Record<string, unknown>;
  const id = record[table.identity] as StoreIdentifierOf<TTable>;
  const patch = Object.fromEntries(
    Object.entries(record).filter(([field]) => field !== table.identity)
  );

  return {
    id,
    patch: patch as UpdateOf<TTable>,
  };
};

const defaultCreateBlaze =
  <TTable extends AnyStoreTable, TConnection extends CrudConnection<TTable>>(
    table: TTable,
    resource: Resource<TConnection>
  ): Implementation<InsertOf<TTable>, EntityOf<TTable>> =>
  async (input, ctx) => {
    try {
      const accessor = resolveAccessor(table, resource, ctx);
      const created = hasInsert(accessor)
        ? await accessor.insert(input)
        : await accessor.upsert(input as unknown as UpsertOf<TTable>);

      return Result.ok(created);
    } catch (error) {
      return Result.err(mapCrudError(table.name, 'create', error));
    }
  };

const defaultReadBlaze =
  <TTable extends AnyStoreTable, TConnection extends CrudConnection<TTable>>(
    table: TTable,
    resource: Resource<TConnection>
  ): Implementation<IdentityInputOf<TTable>, EntityOf<TTable>> =>
  async (input, ctx) => {
    try {
      const id = input[
        table.identity as keyof typeof input
      ] as StoreIdentifierOf<TTable>;
      const entity = await resolveAccessor(table, resource, ctx).get(id);

      return entity === null
        ? Result.err(missingEntityError(table, id))
        : Result.ok(entity);
    } catch (error) {
      return Result.err(mapCrudError(table.name, 'read', error));
    }
  };

const defaultUpdateBlaze =
  <TTable extends AnyStoreTable, TConnection extends CrudConnection<TTable>>(
    table: TTable,
    resource: Resource<TConnection>
  ): Implementation<
    IdentityInputOf<TTable> & UpdateOf<TTable>,
    EntityOf<TTable>
  > =>
  async (input, ctx) => {
    try {
      const accessor = resolveAccessor(table, resource, ctx);
      if (hasUpdate(accessor)) {
        const { id, patch } = splitUpdateInput(table, input);
        const updated = await accessor.update(id, patch);

        return updated === null
          ? Result.err(missingEntityError(table, id))
          : Result.ok(updated);
      }

      return Result.ok(
        await accessor.upsert(input as unknown as UpsertOf<TTable>)
      );
    } catch (error) {
      return Result.err(mapCrudError(table.name, 'update', error));
    }
  };

const defaultDeleteBlaze =
  <TTable extends AnyStoreTable, TConnection extends CrudConnection<TTable>>(
    table: TTable,
    resource: Resource<TConnection>
  ): Implementation<IdentityInputOf<TTable>, undefined> =>
  async (input, ctx) => {
    try {
      const id = input[
        table.identity as keyof typeof input
      ] as StoreIdentifierOf<TTable>;
      const removed = await resolveAccessor(table, resource, ctx).remove(id);

      return removed.deleted
        ? Result.ok()
        : Result.err(missingEntityError(table, id));
    } catch (error) {
      return Result.err(mapCrudError(table.name, 'delete', error));
    }
  };

const defaultListBlaze =
  <TTable extends AnyStoreTable, TConnection extends CrudConnection<TTable>>(
    table: TTable,
    resource: Resource<TConnection>
  ): Implementation<FiltersOf<TTable>, EntityOf<TTable>[]> =>
  async (input, ctx) => {
    try {
      const listed = await resolveAccessor(table, resource, ctx).list(input);
      return Result.ok([...listed]);
    } catch (error) {
      return Result.err(mapCrudError(table.name, 'list', error));
    }
  };

/**
 * Produce the standard CRUD trail tuple for one normalized store table.
 *
 * The factory derives schemas, examples, resources, and contour linkage from
 * the table metadata, while defaulting the blaze layer to the connector-agnostic
 * store accessor contract. Per-operation blaze overrides stay available for
 * callers that need custom persistence behavior.
 */
export const crud = <
  TTable extends AnyStoreTable,
  TConnection extends CrudConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  options: CrudOptions<TTable> = {}
): CrudTrails<TTable> => {
  const entityContour = createTableContour(table);
  const generated = table.generated as readonly string[];

  return Object.freeze([
    deriveTrail(entityContour, 'create', {
      blaze: options.blaze?.create ?? defaultCreateBlaze(table, resource),
      generated,
      resource,
    } as never) as unknown as CreateTrailOf<TTable>,
    deriveTrail(entityContour, 'read', {
      blaze: options.blaze?.read ?? defaultReadBlaze(table, resource),
      resource,
    } as never) as unknown as ReadTrailOf<TTable>,
    deriveTrail(entityContour, 'update', {
      blaze: options.blaze?.update ?? defaultUpdateBlaze(table, resource),
      generated,
      resource,
    } as never) as unknown as UpdateTrailOf<TTable>,
    deriveTrail(entityContour, 'delete', {
      blaze: options.blaze?.delete ?? defaultDeleteBlaze(table, resource),
      resource,
    } as never) as unknown as DeleteTrailOf<TTable>,
    deriveTrail(entityContour, 'list', {
      blaze: options.blaze?.list ?? defaultListBlaze(table, resource),
      resource,
    } as never) as unknown as ListTrailOf<TTable>,
  ]) as CrudTrails<TTable>;
};
