import type { Resource } from '@ontrails/core';
import type { AnyStoreTable, StoreAccessor } from '@ontrails/store';

/** Connection shape: one StoreAccessor per table name. */
export type JsonFileConnection<TStore extends Record<string, AnyStoreTable>> =
  Readonly<{ [K in keyof TStore]: StoreAccessor<TStore[K]> }>;

/** Optional fixture overrides used when building a mock jsonfile store. */
export type JsonFileMockSeed<TStore extends AnyStoreDefinition> = Partial<{
  readonly [TName in keyof TStore['tables']]: readonly FixtureInputOf<
    TStore['tables'][TName]
  >[];
}>;

/** Options for creating a jsonfile store. */
export interface JsonFileStoreOptions<
  TStore extends AnyStoreDefinition = AnyStoreDefinition,
> {
  /** Directory where JSON files are written. One `<tableName>.json` per table. */
  readonly dir: string;
  /** Resource ID override. Defaults to `"store"`. */
  readonly id?: string;
  /** Optional identity generator. Defaults to `Bun.randomUUIDv7()`. */
  readonly generateIdentity?: () => string;
  /** Optional per-table fixture overrides used by the mock resource factory. */
  readonly mockSeed?: JsonFileMockSeed<TStore>;
}

/** Resource type for a jsonfile store. */
export type JsonFileStoreResource<
  TStore extends Record<string, AnyStoreTable>,
> = Resource<JsonFileConnection<TStore>>;
