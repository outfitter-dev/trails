import type { Resource } from '@ontrails/core';
import type {
  AnyStoreDefinition,
  AnyStoreTable,
  StoreAccessor,
  StoreConnectorOptions,
} from '../types.js';

/** Connection shape: one StoreAccessor per table name. */
export type JsonFileConnection<TStore extends Record<string, AnyStoreTable>> =
  Readonly<{ [K in keyof TStore]: StoreAccessor<TStore[K]> }>;

/** Options for creating a jsonfile store. */
export interface JsonFileStoreOptions<
  TStore extends AnyStoreDefinition = AnyStoreDefinition,
> extends StoreConnectorOptions<TStore> {
  /** Directory where JSON files are written. One `<tableName>.json` per table. */
  readonly dir: string;
  /** Optional identity generator. Defaults to `Bun.randomUUIDv7()`. */
  readonly generateIdentity?: () => string;
}

/** Resource type for a jsonfile store. */
export type JsonFileStoreResource<
  TStore extends Record<string, AnyStoreTable>,
> = Resource<JsonFileConnection<TStore>>;
