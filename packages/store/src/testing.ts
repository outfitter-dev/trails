import { expect } from 'bun:test';

import type {
  AnyStoreTable,
  EntityOf,
  FiltersOf,
  StoreAccessor,
  StoreIdentifierOf,
  UpsertOf,
} from './types.js';

export interface StoreAccessorContractSubject<TTable extends AnyStoreTable> {
  readonly accessor: StoreAccessor<TTable>;
  readonly dispose?: () => Promise<void> | void;
}

export interface StoreAccessorContractOptions<TTable extends AnyStoreTable> {
  readonly createInput: () => UpsertOf<TTable>;
  readonly createSubject:
    | (() => StoreAccessorContractSubject<TTable>)
    | (() => Promise<StoreAccessorContractSubject<TTable>>);
  readonly expectCreated:
    | ((entity: EntityOf<TTable>, input: UpsertOf<TTable>) => void)
    | ((entity: EntityOf<TTable>, input: UpsertOf<TTable>) => Promise<void>);
  readonly expectUpdated:
    | ((
        entity: EntityOf<TTable>,
        previous: EntityOf<TTable>,
        input: UpsertOf<TTable>
      ) => void)
    | ((
        entity: EntityOf<TTable>,
        previous: EntityOf<TTable>,
        input: UpsertOf<TTable>
      ) => Promise<void>);
  readonly missingId: StoreIdentifierOf<TTable>;
  readonly seedExisting?:
    | ((accessor: StoreAccessor<TTable>) => Promise<EntityOf<TTable>>)
    | ((accessor: StoreAccessor<TTable>) => EntityOf<TTable>);
  readonly table: TTable;
  readonly updateInput: (existing: EntityOf<TTable>) => UpsertOf<TTable>;
}

export interface StoreAccessorContractCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

const listByIdentity = async <TTable extends AnyStoreTable>(
  table: TTable,
  accessor: StoreAccessor<TTable>,
  entity: EntityOf<TTable>
): Promise<readonly EntityOf<TTable>[]> => {
  const identity = table.identity as keyof EntityOf<TTable> & string;
  const filters = {
    [identity]: entity[identity],
  } as FiltersOf<TTable>;

  return await accessor.list(filters);
};

const withSubject = async <TTable extends AnyStoreTable, TResult>(
  createSubject: StoreAccessorContractOptions<TTable>['createSubject'],
  run: (subject: StoreAccessorContractSubject<TTable>) => Promise<TResult>
): Promise<TResult> => {
  const subject = await createSubject();

  try {
    return await run(subject);
  } finally {
    await subject.dispose?.();
  }
};

const seedExistingEntity = async <TTable extends AnyStoreTable>(
  options: StoreAccessorContractOptions<TTable>,
  accessor: StoreAccessor<TTable>
): Promise<EntityOf<TTable>> => {
  if (options.seedExisting !== undefined) {
    return await options.seedExisting(accessor);
  }

  return await accessor.upsert(options.createInput());
};

/**
 * Shared contract cases for connector-agnostic writable store accessors.
 *
 * Connectors can register these with their own `test(...)` wrappers so the
 * baseline `get/list/upsert/remove` contract stays aligned across runtimes
 * without fighting repository-specific test-lint rules.
 */
export const createStoreAccessorContractCases = <TTable extends AnyStoreTable>(
  options: StoreAccessorContractOptions<TTable>
): readonly StoreAccessorContractCase[] =>
  [
    {
      name: 'upsert creates an entity and exposes it through get/list',
      run: async () => {
        await withSubject(options.createSubject, async ({ accessor }) => {
          const input = options.createInput();
          const created = await accessor.upsert(input);

          await options.expectCreated(created, input);
          expect(
            await accessor.get(
              created[
                options.table.identity as keyof EntityOf<TTable> & string
              ] as StoreIdentifierOf<TTable>
            )
          ).toEqual(created);
          expect(
            await listByIdentity(options.table, accessor, created)
          ).toEqual([created]);
        });
      },
    },
    {
      name: 'upsert updates an existing entity in place when the identity matches',
      run: async () => {
        await withSubject(options.createSubject, async ({ accessor }) => {
          const existing = await seedExistingEntity(options, accessor);
          const input = options.updateInput(existing);
          const updated = await accessor.upsert(input);
          const identity = options.table.identity as keyof EntityOf<TTable> &
            string;

          expect(updated[identity]).toBe(existing[identity]);
          await options.expectUpdated(updated, existing, input);
          expect(
            await accessor.get(updated[identity] as StoreIdentifierOf<TTable>)
          ).toEqual(updated);
          expect(
            await listByIdentity(options.table, accessor, updated)
          ).toEqual([updated]);
        });
      },
    },
    {
      name: 'remove deletes an existing entity',
      run: async () => {
        await withSubject(options.createSubject, async ({ accessor }) => {
          const existing = await seedExistingEntity(options, accessor);
          const identity = options.table.identity as keyof EntityOf<TTable> &
            string;
          const removed = await accessor.remove(
            existing[identity] as StoreIdentifierOf<TTable>
          );

          expect(removed).toEqual({ deleted: true });
          expect(
            await accessor.get(existing[identity] as StoreIdentifierOf<TTable>)
          ).toBeNull();
        });
      },
    },
    {
      name: 'get returns null for a missing identity',
      run: async () => {
        await withSubject(options.createSubject, async ({ accessor }) => {
          expect(await accessor.get(options.missingId)).toBeNull();
        });
      },
    },
    {
      name: 'remove reports false when the identity is missing',
      run: async () => {
        await withSubject(options.createSubject, async ({ accessor }) => {
          expect(await accessor.remove(options.missingId)).toEqual({
            deleted: false,
          });
        });
      },
    },
  ] as const;
