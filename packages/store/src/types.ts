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
> {
  readonly generated?: readonly StoreFieldKey<TSchema>[];
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
  StoreTableInput<StoreObjectSchema>
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
 * Generated store table contract derived from authored metadata.
 */
export interface StoreTable<
  TInput extends StoreTableInput = StoreTableInput,
  TName extends string = string,
> {
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
 * Any normalized store table.
 */
export type AnyStoreTable = StoreTable<StoreTableInput, string>;

/**
 * Any normalized store definition.
 */
export type AnyStoreDefinition = StoreDefinition<StoreTablesInput>;

/**
 * Full entity type represented by one store table.
 */
export type EntityOf<TTable extends AnyStoreTable> = z.output<TTable['schema']>;

/**
 * Primary-key field name for one store table.
 */
export type PrimaryKeyOf<TTable extends AnyStoreTable> = TTable['primaryKey'];

/**
 * Server-managed fields for one store table.
 */
export type GeneratedKeysOf<TTable extends AnyStoreTable> =
  TTable['generated'][number] & string;

/**
 * Insert shape derived from the entity schema minus generated fields.
 */
export type InsertOf<TTable extends AnyStoreTable> = Omit<
  z.input<TTable['schema']>,
  GeneratedKeysOf<TTable>
>;

/**
 * Update shape derived from the insert shape.
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
