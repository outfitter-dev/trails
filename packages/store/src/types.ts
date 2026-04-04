import type { z } from 'zod';

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

type GeneratedFieldNames<
  TSchema extends StoreObjectSchema,
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined,
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
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined =
    | readonly StoreFieldKey<TSchema>[]
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
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined =
    | readonly StoreFieldKey<TSchema>[]
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
 * Authored metadata for one store table.
 */
export interface StoreTableInput<
  TSchema extends StoreObjectSchema = StoreObjectSchema,
  TGenerated extends readonly StoreFieldKey<TSchema>[] | undefined =
    | readonly StoreFieldKey<TSchema>[]
    | undefined,
> {
  readonly fixtures?: readonly StoreFixtureInput<TSchema, TGenerated>[];
  readonly generated?: TGenerated;
  readonly indexes?: readonly StoreFieldKey<TSchema>[];
  readonly primaryKey: StoreFieldKey<TSchema>;
  readonly references?: Readonly<
    Partial<Record<StoreFieldKey<TSchema>, string>>
  >;
  readonly schema: TSchema;
  readonly search?: StoreSearchDefinition;
}

/**
 * Record of authored tables passed to `store(...)`.
 */
export type StoreTablesInput = Record<
  string,
  StoreTableInput<
    StoreObjectSchema,
    readonly StoreFieldKey<StoreObjectSchema>[] | undefined
  >
>;

/**
 * Preserve generated fields when present, otherwise normalize to an empty tuple.
 */
export type GeneratedFieldsOfInput<TInput extends StoreTableInput> =
  TInput['generated'] extends readonly StoreFieldKey<TInput['schema']>[]
    ? TInput['generated']
    : readonly [];

/**
 * Preserve index fields when present, otherwise normalize to an empty tuple.
 */
export type IndexFieldsOfInput<TInput extends StoreTableInput> =
  TInput['indexes'] extends readonly StoreFieldKey<TInput['schema']>[]
    ? TInput['indexes']
    : readonly [];

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
    TInput['schema'],
    GeneratedFieldsOfInput<TInput>
  >[]
    ? readonly StoreFixtureRow<
        TInput['schema'],
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
  readonly indexes: IndexFieldsOfInput<TInput>;
  readonly insertSchema: StoreObjectSchema;
  readonly name: TName;
  readonly primaryKey: TInput['primaryKey'];
  readonly references: ReferencesOfInput<TInput>;
  readonly schema: TInput['schema'];
  readonly search?: TInput['search'];
  readonly updateSchema: StoreObjectSchema;
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
  readonly kind: 'store';
  readonly tableNames: readonly Extract<keyof TTables, string>[];
  readonly tables: {
    readonly [TName in keyof TTables]: StoreTable<
      TTables[TName],
      Extract<TName, string>
    >;
  };
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
  readonly indexes: readonly string[];
  readonly insertSchema: StoreObjectSchema;
  readonly name: string;
  readonly primaryKey: string;
  readonly references: Readonly<Partial<Record<string, string>>>;
  readonly schema: StoreObjectSchema;
  readonly search?: StoreSearchDefinition | undefined;
  readonly updateSchema: StoreObjectSchema;
}

/**
 * Structural view of any normalized store definition.
 */
export interface AnyStoreDefinition {
  readonly kind: 'store';
  readonly tableNames: readonly string[];
  readonly tables: Readonly<Record<string, AnyStoreTable>>;
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
 * Primary-key field name for one store table.
 */
export type PrimaryKeyOf<TTable extends AnyStoreTable> = TTable['primaryKey'];

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
  EntityOf<TTable>[Extract<PrimaryKeyOf<TTable>, keyof EntityOf<TTable>>];

/**
 * Access mode for a bound store connection or provision.
 */
export type StoreAccessMode = 'readonly' | 'readwrite';

/**
 * Read-only table operations that every bound store must expose.
 */
export interface ReadOnlyStoreTableAccessor<TTable extends AnyStoreTable> {
  /** Retrieve a single entity by primary key. Returns `null` when not found. */
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
 * Writable table operations layered on top of the read contract.
 */
export interface StoreTableAccessor<
  TTable extends AnyStoreTable,
> extends ReadOnlyStoreTableAccessor<TTable> {
  /**
   * Insert a new entity.
   *
   * @throws {AlreadyExistsError} On primary key or unique constraint violation.
   *
   * @remarks
   * This is an intentional throw-based boundary: store connectors throw typed
   * errors (`AlreadyExistsError`) rather than returning `Result`. Trail
   * implementations that call store accessors should catch and convert to
   * `Result.err()` at their level. A future `safeInsert` returning `Result`
   * is planned but deferred to avoid cascading changes across all connectors.
   */
  insert(input: InsertOf<TTable>): Promise<EntityOf<TTable>>;
  /**
   * Remove an entity by primary key. Returns `{ deleted: true }` when the
   * row was found and removed, `{ deleted: false }` when no matching row
   * existed (not an error).
   */
  remove(id: StoreIdentifierOf<TTable>): Promise<{ readonly deleted: boolean }>;
  /**
   * Patch an entity by primary key with partial fields. Returns the updated
   * entity, or `null` when no row with that ID exists.
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
 * Connection shape exposed by a writable bound store.
 */
export type StoreConnection<TStore extends AnyStoreDefinition> = {
  readonly [TName in keyof TStore['tables']]: StoreTableAccessor<
    TStore['tables'][TName]
  >;
};
