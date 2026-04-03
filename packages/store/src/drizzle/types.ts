import type { Provision } from '@ontrails/core';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core';

import type {
  AnyStoreDefinition,
  FixtureInputOf,
  ReadOnlyStoreConnection,
  StoreAccessMode,
  StoreConnection,
} from '../types.js';

export type DrizzleStoreSchema<TStore extends AnyStoreDefinition> = {
  readonly [TName in keyof TStore['tables']]: AnySQLiteTable<{
    name: Extract<TName, string>;
  }>;
};

export interface DrizzleQueryContext<TStore extends AnyStoreDefinition> {
  readonly drizzle: BunSQLiteDatabase<DrizzleStoreSchema<TStore>>;
  readonly tables: DrizzleStoreSchema<TStore>;
}

export type DrizzleMockSeed<TStore extends AnyStoreDefinition> = Partial<{
  readonly [TName in keyof TStore['tables']]: readonly FixtureInputOf<
    TStore['tables'][TName]
  >[];
}>;

export interface ConnectDrizzleOptions<TStore extends AnyStoreDefinition> {
  readonly description?: string;
  readonly id?: string;
  readonly mockSeed?: DrizzleMockSeed<TStore>;
  readonly url: string;
}

export interface ReadOnlyDrizzleOptions {
  readonly description?: string;
  readonly id?: string;
  readonly url: string;
}

export type ReadOnlyDrizzleStoreConnection<TStore extends AnyStoreDefinition> =
  ReadOnlyStoreConnection<TStore> & {
    query<TResult>(
      run: (ctx: DrizzleQueryContext<TStore>) => TResult | Promise<TResult>
    ): Promise<Awaited<TResult>>;
  };

export type DrizzleStoreConnection<TStore extends AnyStoreDefinition> =
  StoreConnection<TStore> & ReadOnlyDrizzleStoreConnection<TStore>;

export interface DrizzleStoreProvisionShape<
  TStore extends AnyStoreDefinition,
  TConnection,
  TAccess extends StoreAccessMode,
> {
  readonly access: TAccess;
  readonly store: TStore;
  readonly tables: DrizzleStoreSchema<TStore>;
  from(ctx: Parameters<Provision<TConnection>['from']>[0]): TConnection;
  readonly kind: 'provision';
}

export type DrizzleStoreProvision<
  TStore extends AnyStoreDefinition,
  TConnection,
  TAccess extends StoreAccessMode,
> = Provision<TConnection> &
  DrizzleStoreProvisionShape<TStore, TConnection, TAccess>;
