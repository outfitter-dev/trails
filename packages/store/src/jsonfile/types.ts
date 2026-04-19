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
  /**
   * Optional identity generator. Defaults to `Bun.randomUUIDv7()`.
   *
   * @remarks
   * When a jsonfile table is reused across multiple `connectJsonFile` call
   * sites (same `dir` + table), the runtime enforces that every connection
   * supplies a compatible `generateIdentity`. That compatibility check is
   * intentional reference equality, not a structural or behavioral comparison:
   * two distinct arrow functions that happen to be "logically identical"
   * (e.g. `() => uuid()` written inline in two files) will still be treated
   * as a conflict and surface as a `ConflictError`. Callers that want to
   * share a table across call sites should hoist `generateIdentity` to a
   * stable reference — a module-level `const` or shared utility — and pass
   * that same reference in from every connection, rather than recreating
   * the function inline at each site.
   *
   * The conflict check only fires for custom generators. When no custom
   * generator is provided for an auto-generated-identity store,
   * `deriveTableReuseConfig` normalizes `generateIdentity` to `undefined`
   * regardless of what (if anything) was passed, so two connections that
   * both rely on defaults never conflict on this field. The same
   * normalization also applies when the identity field is not in
   * `generatedFields` — the generator is irrelevant in that case, so the
   * check is skipped.
   */
  readonly generateIdentity?: () => string;
}

/** Resource type for a jsonfile store. */
export type JsonFileStoreResource<
  TStore extends Record<string, AnyStoreTable>,
> = Resource<JsonFileConnection<TStore>>;
