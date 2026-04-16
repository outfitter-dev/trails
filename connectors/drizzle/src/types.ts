import type { Resource } from '@ontrails/core';
import type {
  AnyStoreDefinition,
  ReadOnlyStoreConnection,
  StoreAccessMode,
  StoreConnectorOptions,
  StoreTableConnection,
} from '@ontrails/store';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core';

export type DrizzleStoreSchema<TStore extends AnyStoreDefinition> = {
  readonly [TName in keyof TStore['tables']]: AnySQLiteTable<{
    name: Extract<TName, string>;
  }>;
};

export interface DrizzleQueryContext<TStore extends AnyStoreDefinition> {
  readonly drizzle: BunSQLiteDatabase<DrizzleStoreSchema<TStore>>;
  readonly tables: DrizzleStoreSchema<TStore>;
}

/**
 * Options accepted by the Drizzle store connector.
 *
 * Extends {@link StoreConnectorOptions} with drizzle-specific fields. The
 * read-only vs writable distinction is enforced by the factory that consumes
 * these options, not by the options type itself.
 */
export interface DrizzleStoreOptions<
  TDef extends AnyStoreDefinition = AnyStoreDefinition,
> extends StoreConnectorOptions<TDef> {
  /** Path to the SQLite database file. Use `":memory:"` for ephemeral runs. */
  readonly url: string;
}

export type ReadOnlyDrizzleStoreConnection<TStore extends AnyStoreDefinition> =
  ReadOnlyStoreConnection<TStore> & {
    query<TResult>(
      run: (ctx: DrizzleQueryContext<TStore>) => TResult | Promise<TResult>
    ): Promise<Awaited<TResult>>;
  };

export type DrizzleStoreConnection<TStore extends AnyStoreDefinition> =
  StoreTableConnection<TStore> & ReadOnlyDrizzleStoreConnection<TStore>;

export interface DrizzleStoreResourceShape<
  TStore extends AnyStoreDefinition,
  TConnection,
  TAccess extends StoreAccessMode,
> {
  readonly access: TAccess;
  readonly signals?: TStore['signals'] | undefined;
  readonly store: TStore;
  readonly tables: DrizzleStoreSchema<TStore>;
  from(ctx: Parameters<Resource<TConnection>['from']>[0]): TConnection;
  readonly kind: 'resource';
}

export type DrizzleStoreResource<
  TStore extends AnyStoreDefinition,
  TConnection,
  TAccess extends StoreAccessMode,
> = Resource<TConnection> &
  DrizzleStoreResourceShape<TStore, TConnection, TAccess>;
