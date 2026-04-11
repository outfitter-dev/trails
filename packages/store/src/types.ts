import type { Signal } from '@ontrails/core';
import type { z } from 'zod';

/**
 * Backend-agnostic persistence shapes that a connector can interpret.
 */
export type StoreKind = 'tabular' | 'document' | 'file' | 'kv' | 'cache';

/**
 * Store-level options applied to the authored definition.
 */
export interface StoreOptions {
  readonly kind?: StoreKind;
}

/**
 * Object schema accepted by the store definition layer.
 */
export type StoreObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

/**
 * String field names available on a store-backed entity schema.
 */
export type StoreFieldKey<TSchema extends StoreObjectSchema> = Extract<
  keyof z.output<TSchema>,
  string
>;

type VersionedSchema<
  TSchema extends StoreObjectSchema,
  TVersioned extends boolean | undefined,
> = TVersioned extends true
  ? TSchema extends z.ZodObject<infer TShape>
    ? z.ZodObject<TShape & { version: z.ZodNumber }>
    : never
  : TSchema;

type GeneratedFieldNames<
  TSchema extends StoreObjectSchema,
  TGenerated extends readonly string[] | undefined,
> = TGenerated extends readonly StoreFieldKey<TSchema>[]
  ? TGenerated[number]
  : never;

/**
 * Seed row accepted for one table fixture.
 *
 * Generated fields may be supplied explicitly, but they are optional so test
 * fixtures can omit timestamps and similar server-managed values when the mock
 * store can synthesize them.
 */
export type StoreFixtureInput<
  TSchema extends StoreObjectSchema,
  TGenerated extends readonly string[] | undefined =
    | readonly string[]
    | undefined,
> = Omit<
  z.input<TSchema>,
  Extract<GeneratedFieldNames<TSchema, TGenerated>, keyof z.input<TSchema>>
> &
  Partial<
    Pick<
      z.input<TSchema>,
      Extract<GeneratedFieldNames<TSchema, TGenerated>, keyof z.input<TSchema>>
    >
  >;

/**
 * Normalized fixture row after schema validation and default application.
 */
export type StoreFixtureRow<
  TSchema extends StoreObjectSchema,
  TGenerated extends readonly string[] | undefined =
    | readonly string[]
    | undefined,
> = Omit<
  z.output<TSchema>,
  Extract<GeneratedFieldNames<TSchema, TGenerated>, keyof z.output<TSchema>>
> &
  Partial<
    Pick<
      z.output<TSchema>,
      Extract<GeneratedFieldNames<TSchema, TGenerated>, keyof z.output<TSchema>>
    >
  >;

/**
 * Connector-owned search metadata.
 *
 * The core package keeps this opaque on purpose. Search behavior is declared
 * here and interpreted by a concrete connector later.
 */
export type StoreSearchDefinition = Readonly<Record<string, unknown>>;

/**
 * Change signals projected from one store entity definition.
 */
export interface StoreTableSignals<TPayload> {
  readonly created: Signal<TPayload>;
  readonly updated: Signal<TPayload>;
  readonly removed: Signal<TPayload>;
}

/**
 * Shared fields for all store table input variants.
 */
interface StoreTableInputBase<
  TSchema extends StoreObjectSchema = StoreObjectSchema,
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined =
    | readonly StoreFieldKey<TSchema>[]
    | undefined,
  TVersioned extends boolean | undefined = boolean | undefined,
> {
  readonly fixtures?: readonly StoreFixtureInput<
    VersionedSchema<TSchema, TVersioned>,
    GeneratedFieldsOfShape<TSchema, TGenerated, TVersioned>
  >[];
  readonly generated?: TGenerated;
  readonly indexed?: readonly StoreFieldKey<TSchema>[];
  readonly indexes?: readonly StoreFieldKey<TSchema>[];
  readonly references?: Readonly<
    Partial<Record<StoreFieldKey<TSchema>, string>>
  >;
  readonly schema: TSchema;
  readonly search?: StoreSearchDefinition;
  readonly versioned?: TVersioned;
}

/**
 * Authored metadata for one store entity.
 *
 * At least one of `identity` or `primaryKey` must be provided. Omitting both
 * is a compile-time error — `resolveIdentity` would throw at runtime without
 * this guard.
 */
export type StoreTableInput<
  TSchema extends StoreObjectSchema = StoreObjectSchema,
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined =
    | readonly StoreFieldKey<TSchema>[]
    | undefined,
  TVersioned extends boolean | undefined = boolean | undefined,
> =
  | (StoreTableInputBase<TSchema, TGenerated, TVersioned> & {
      readonly identity: StoreFieldKey<TSchema>;
      readonly primaryKey?: StoreFieldKey<TSchema>;
    })
  | (StoreTableInputBase<TSchema, TGenerated, TVersioned> & {
      readonly identity?: StoreFieldKey<TSchema>;
      readonly primaryKey: StoreFieldKey<TSchema>;
    });

/**
 * Record of authored tables passed to `store(...)`.
 */
export type StoreTablesInput = Record<
  string,
  StoreTableInput<
    StoreObjectSchema,
    readonly StoreFieldKey<StoreObjectSchema>[] | undefined,
    boolean | undefined
  >
>;

type DeclaredGeneratedFieldsOfInput<TInput extends StoreTableInput> =
  TInput['generated'] extends readonly StoreFieldKey<TInput['schema']>[]
    ? TInput['generated']
    : readonly [];

type GeneratedFieldsOfShape<
  TSchema extends StoreObjectSchema,
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined,
  TVersioned extends boolean | undefined,
> = TVersioned extends true
  ? readonly [
      ...(TGenerated extends readonly StoreFieldKey<TSchema>[]
        ? TGenerated
        : readonly []),
      'version',
    ]
  : TGenerated extends readonly StoreFieldKey<TSchema>[]
    ? TGenerated
    : readonly [];

type VersionedFieldsOfInput<TInput extends StoreTableInput> =
  TInput['versioned'] extends true ? true : false;

type SchemaOfInput<TInput extends StoreTableInput> = VersionedSchema<
  TInput['schema'],
  VersionedFieldsOfInput<TInput>
>;

/**
 * Preserve generated fields when present, otherwise normalize to an empty tuple.
 */
export type GeneratedFieldsOfInput<TInput extends StoreTableInput> =
  GeneratedFieldsOfShape<
    TInput['schema'],
    DeclaredGeneratedFieldsOfInput<TInput>,
    VersionedFieldsOfInput<TInput>
  >;

/**
 * Preserve the authored identity field.
 */
export type IdentityFieldOfInput<TInput extends StoreTableInput> =
  TInput['identity'] extends StoreFieldKey<TInput['schema']>
    ? TInput['identity']
    : TInput['primaryKey'] extends StoreFieldKey<TInput['schema']>
      ? TInput['primaryKey']
      : never;

/**
 * Preserve indexed fields when present, otherwise normalize to an empty tuple.
 *
 * At runtime `resolveIndexed` merges both `indexed` and `indexes` arrays, so
 * this type mirrors that behavior: when both are present, the result is the
 * union of both tuples. When only one is provided, it is used directly.
 */
export type IndexedFieldsOfInput<TInput extends StoreTableInput> =
  TInput['indexed'] extends readonly StoreFieldKey<TInput['schema']>[]
    ? TInput['indexes'] extends readonly StoreFieldKey<TInput['schema']>[]
      ? readonly [...TInput['indexed'], ...TInput['indexes']]
      : TInput['indexed']
    : TInput['indexes'] extends readonly StoreFieldKey<TInput['schema']>[]
      ? TInput['indexes']
      : readonly [];

/**
 * Backward-compatible alias for code that still uses the SQL-shaped name.
 */
export type IndexFieldsOfInput<TInput extends StoreTableInput> =
  TInput['indexes'] extends readonly StoreFieldKey<TInput['schema']>[]
    ? TInput['indexes']
    : IndexedFieldsOfInput<TInput>;

/**
 * Preserve references when present, otherwise normalize to an empty object.
 */
export type ReferencesOfInput<TInput extends StoreTableInput> =
  TInput['references'] extends Readonly<
    Partial<Record<StoreFieldKey<TInput['schema']>, string>>
  >
    ? TInput['references']
    : Readonly<Record<never, never>>;

/**
 * Preserve fixtures when present, otherwise normalize to an empty tuple.
 */
export type FixturesOfInput<TInput extends StoreTableInput> =
  TInput['fixtures'] extends readonly StoreFixtureInput<
    SchemaOfInput<TInput>,
    GeneratedFieldsOfInput<TInput>
  >[]
    ? readonly StoreFixtureRow<
        SchemaOfInput<TInput>,
        GeneratedFieldsOfInput<TInput>
      >[]
    : readonly [];

/**
 * Generated store table contract derived from authored metadata.
 */
export interface StoreTable<
  TInput extends StoreTableInput = StoreTableInput,
  TName extends string = string,
> {
  readonly fixtureSchema: StoreObjectSchema;
  readonly fixtures: FixturesOfInput<TInput>;
  readonly generated: GeneratedFieldsOfInput<TInput>;
  readonly identity: IdentityFieldOfInput<TInput>;
  readonly indexed: IndexedFieldsOfInput<TInput>;
  readonly indexes: IndexedFieldsOfInput<TInput>;
  readonly insertSchema: StoreObjectSchema;
  readonly name: TName;
  readonly primaryKey: IdentityFieldOfInput<TInput>;
  readonly references: ReferencesOfInput<TInput>;
  readonly schema: SchemaOfInput<TInput>;
  readonly search?: TInput['search'];
  readonly signals: StoreTableSignals<z.output<SchemaOfInput<TInput>>>;
  readonly updateSchema: StoreObjectSchema;
  readonly versioned: VersionedFieldsOfInput<TInput>;
}

/**
 * Full store definition returned by `store(...)`.
 */
export interface StoreDefinition<
  TTables extends StoreTablesInput = StoreTablesInput,
> {
  readonly get: <TName extends Extract<keyof TTables, string>>(
    name: TName
  ) => StoreTable<TTables[TName], TName>;
  readonly kind: StoreKind;
  readonly signals: readonly Signal<unknown>[];
  readonly tableNames: readonly Extract<keyof TTables, string>[];
  readonly tables: {
    readonly [TName in keyof TTables]: StoreTable<
      TTables[TName],
      Extract<TName, string>
    >;
  };
  readonly type: 'store';
}

/**
 * Structural view of any normalized store table.
 *
 * This stays broad on purpose so connector packages can accept concrete store
 * definitions returned by `store(...)` without erasing their table-specific
 * types back to one canonical generic instantiation.
 */
export interface AnyStoreTable {
  readonly fixtureSchema: StoreObjectSchema;
  readonly fixtures: readonly Record<string, unknown>[];
  readonly generated: readonly string[];
  readonly identity: string;
  readonly indexed: readonly string[];
  readonly indexes: readonly string[];
  readonly insertSchema: StoreObjectSchema;
  readonly name: string;
  readonly primaryKey: string;
  readonly references: Readonly<Partial<Record<string, string>>>;
  readonly schema: StoreObjectSchema;
  readonly search?: StoreSearchDefinition | undefined;
  readonly signals: StoreTableSignals<unknown>;
  readonly updateSchema: StoreObjectSchema;
  readonly versioned: boolean;
}

/**
 * Structural view of any normalized store definition.
 */
export interface AnyStoreDefinition {
  readonly kind: StoreKind;
  readonly signals: readonly Signal<unknown>[];
  readonly tableNames: readonly string[];
  readonly tables: Readonly<Record<string, AnyStoreTable>>;
  readonly type: 'store';
}

type GeneratedFieldKeysOf<TTable extends AnyStoreTable> = readonly Extract<
  TTable['generated'][number],
  StoreFieldKey<TTable['schema']>
>[];

/**
 * Full entity type represented by one store table.
 */
export type EntityOf<TTable extends AnyStoreTable> = z.output<TTable['schema']>;

/**
 * Fixture seed input accepted for one table.
 */
export type FixtureInputOf<TTable extends AnyStoreTable> = StoreFixtureInput<
  TTable['schema'],
  GeneratedFieldKeysOf<TTable>
>;

/**
 * Normalized fixture row available on one table.
 */
export type FixtureOf<TTable extends AnyStoreTable> = StoreFixtureRow<
  TTable['schema'],
  GeneratedFieldKeysOf<TTable>
>;

/**
 * Identity field name for one store entity.
 */
export type IdentityOf<TTable extends AnyStoreTable> = TTable['identity'];

/**
 * Primary-key field name for one store table.
 */
export type PrimaryKeyOf<TTable extends AnyStoreTable> = IdentityOf<TTable>;

/**
 * Server-managed fields for one store table.
 */
export type GeneratedKeysOf<TTable extends AnyStoreTable> = Extract<
  TTable['generated'][number],
  StoreFieldKey<TTable['schema']>
>;

/**
 * Insert shape: entity minus generated fields, with defaulted fields optional.
 *
 * Uses `z.input` so that fields with `.default()` are correctly represented as
 * optional in the insert shape (matching the runtime insert schema behavior).
 */
export type InsertOf<TTable extends AnyStoreTable> = Omit<
  z.input<TTable['schema']>,
  GeneratedKeysOf<TTable>
>;

/**
 * Update shape: partial insert minus the primary key (immutable identifier).
 */
export type UpdateOf<TTable extends AnyStoreTable> = Partial<
  Omit<InsertOf<TTable>, PrimaryKeyOf<TTable>>
>;

/**
 * Upsert shape: entity payload with generated fields remaining optional.
 *
 * This matches the connector-agnostic "create or replace" contract while
 * still allowing connectors to synthesize generated values like IDs and
 * timestamps when the caller omits them.
 */
export type UpsertOf<TTable extends AnyStoreTable> = FixtureInputOf<TTable>;

/**
 * Typed filter shape for list operations.
 */
export type FiltersOf<TTable extends AnyStoreTable> = Partial<EntityOf<TTable>>;

/**
 * Common pagination controls for store list operations.
 */
export interface StoreListOptions {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Shared identifier type for read/write accessors.
 */
export type StoreIdentifierOf<TTable extends AnyStoreTable> =
  EntityOf<TTable>[Extract<IdentityOf<TTable>, keyof EntityOf<TTable>>];

/**
 * Access mode for a bound store connection or resource.
 */
export type StoreAccessMode = 'readonly' | 'readwrite';

/**
 * Read-only table operations that every bound store must expose.
 */
export interface ReadOnlyStoreTableAccessor<TTable extends AnyStoreTable> {
  /** Retrieve a single entity by identity. Returns `null` when not found. */
  get(id: StoreIdentifierOf<TTable>): Promise<EntityOf<TTable> | null>;
  /**
   * List entities, optionally filtered. Returns all rows when no filters are
   * provided. Returns an empty array when no rows match.
   */
  list(
    filters?: FiltersOf<TTable>,
    options?: StoreListOptions
  ): Promise<readonly EntityOf<TTable>[]>;
}

/**
 * Connector-agnostic writable operations layered on top of the read contract.
 */
export interface StoreAccessor<
  TTable extends AnyStoreTable,
> extends ReadOnlyStoreTableAccessor<TTable> {
  /**
   * Create or replace one entity using the store's identity field.
   *
   * @throws {AlreadyExistsError} On primary key or unique constraint violation.
   *
   * @remarks
   * This is an intentional throw-based boundary: store connectors throw typed
   * errors (`AlreadyExistsError`) rather than returning `Result`. Trail
   * implementations that call store accessors should catch and convert to
   * `Result.err()` at their level. A future safe variant returning `Result`
   * is planned but deferred to avoid cascading changes across all connectors.
   */
  upsert(input: UpsertOf<TTable>): Promise<EntityOf<TTable>>;
  /**
   * Remove an entity by identity. Returns `{ deleted: true }` when the
   * row was found and removed, `{ deleted: false }` when no matching row
   * existed (not an error).
   */
  remove(id: StoreIdentifierOf<TTable>): Promise<{ readonly deleted: boolean }>;
}

/**
 * Tabular writable operations layered on top of the connector-agnostic
 * contract.
 */
export interface StoreTableAccessor<
  TTable extends AnyStoreTable,
> extends StoreAccessor<TTable> {
  /**
   * Insert a new entity.
   *
   * Tabular connectors can expose this convenience when the backend has a
   * native distinction between create and update.
   */
  insert(input: InsertOf<TTable>): Promise<EntityOf<TTable>>;
  /**
   * Patch an entity by identity with partial fields. Returns the updated
   * entity, or `null` when no row with that ID exists.
   *
   * @remarks
   * On versioned tables, `update` does **not** participate in optimistic
   * concurrency control. The `UpdateOf<TTable>` shape is derived by omitting
   * generated fields — including the framework-managed `version` column — so
   * any `version` value is dropped before reaching the connector and the
   * connector always auto-increments without comparing. Callers that need
   * lost-update protection must use {@link StoreAccessor.upsert | `upsert`}
   * instead and pass the expected `version` in the payload.
   */
  update(
    id: StoreIdentifierOf<TTable>,
    input: UpdateOf<TTable>
  ): Promise<EntityOf<TTable> | null>;
}

/**
 * Connection shape exposed by a read-only bound store.
 */
export type ReadOnlyStoreConnection<TStore extends AnyStoreDefinition> = {
  readonly [TName in keyof TStore['tables']]: ReadOnlyStoreTableAccessor<
    TStore['tables'][TName]
  >;
};

/**
 * Connector-agnostic connection shape exposed by a writable bound store.
 */
export type StoreConnection<TStore extends AnyStoreDefinition> = {
  readonly [TName in keyof TStore['tables']]: StoreAccessor<
    TStore['tables'][TName]
  >;
};

/**
 * Tabular connection shape exposed by connectors that distinguish insert and
 * patch operations from the generalized `upsert` contract.
 */
export type StoreTableConnection<TStore extends AnyStoreDefinition> = {
  readonly [TName in keyof TStore['tables']]: StoreTableAccessor<
    TStore['tables'][TName]
  >;
};
