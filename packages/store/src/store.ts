import { ValidationError } from '@ontrails/core';
import type { z } from 'zod';

import type {
  StoreDefinition,
  StoreObjectSchema,
  StoreTable,
  StoreTableInput,
  StoreTablesInput,
} from './types.js';

const isStoreObjectSchema = (schema: z.ZodType): schema is StoreObjectSchema =>
  schema.def.type === 'object' && 'shape' in schema.def;

const uniqueStrings = <T extends string>(
  values: readonly T[] | undefined
): readonly T[] =>
  Object.freeze([...(values === undefined ? [] : new Set(values))]);

const hasField = (schema: StoreObjectSchema, field: string): boolean =>
  field in schema.shape;

const validateFieldList = (
  tableName: string,
  schema: StoreObjectSchema,
  fields: readonly string[],
  label: string
): void => {
  for (const field of fields) {
    if (hasField(schema, field)) {
      continue;
    }

    throw new ValidationError(
      `Store table "${tableName}" declares ${label} field "${field}" that is not present on the schema`
    );
  }
};

const validateReferences = (
  tableName: string,
  schema: StoreObjectSchema,
  references: Readonly<Partial<Record<string, string>>>,
  tableNames: readonly string[]
): void => {
  for (const [field, target] of Object.entries(references)) {
    if (!hasField(schema, field)) {
      throw new ValidationError(
        `Store table "${tableName}" declares reference field "${field}" that is not present on the schema`
      );
    }

    if (target !== undefined && tableNames.includes(target)) {
      continue;
    }

    throw new ValidationError(
      `Store table "${tableName}" references unknown table "${target}"`
    );
  }
};

const buildFieldMask = (fields: readonly string[]): Record<string, true> =>
  Object.fromEntries(fields.map((field) => [field, true] as const)) as Record<
    string,
    true
  >;

const omitFields = <TSchema extends StoreObjectSchema>(
  schema: TSchema,
  fields: readonly string[]
): StoreObjectSchema => {
  if (fields.length === 0) {
    return schema;
  }

  return schema.omit(buildFieldMask(fields)) as StoreObjectSchema;
};

const deriveInsertSchema = <TSchema extends StoreObjectSchema>(
  schema: TSchema,
  generated: readonly string[]
): StoreObjectSchema => omitFields(schema, generated);

/**
 * Strip `default` wrappers from a Zod type so that partial update schemas
 * do not silently re-materialize defaults. Walks through all wrapper layers
 * (default, optional, nullable), strips defaults, and re-applies non-default
 * wrappers to preserve the nullable constraint.
 */
const stripDefaultWrappers = (schema: z.ZodType): z.ZodType => {
  const wrappers: ('optional' | 'nullable')[] = [];
  let current = schema;

  while (
    current.def.type === 'default' ||
    current.def.type === 'optional' ||
    current.def.type === 'nullable'
  ) {
    const type = current.def.type as 'default' | 'optional' | 'nullable';
    if (type !== 'default') {
      wrappers.push(type);
    }
    current = (current.def as unknown as Record<string, unknown>)[
      'innerType'
    ] as z.ZodType;
  }

  // Re-apply nullable wrappers (optional is dropped — .partial() re-adds it)
  return wrappers.reduceRight(
    (acc, w) => (w === 'nullable' ? acc.nullable() : acc),
    current
  );
};

const stripDefaultsFromShape = (
  schema: StoreObjectSchema
): Record<string, z.ZodType> => {
  const stripped: Record<string, z.ZodType> = {};

  for (const [field, value] of Object.entries(schema.shape)) {
    stripped[field] = stripDefaultWrappers(value);
  }

  return stripped;
};

const deriveUpdateSchema = (
  schema: StoreObjectSchema,
  primaryKey: string
): StoreObjectSchema => {
  const partial = schema
    .extend(stripDefaultsFromShape(schema))
    .partial() as StoreObjectSchema;
  // Only omit the primaryKey if it's still present (it may already be in `generated`)
  return hasField(partial, primaryKey)
    ? omitFields(partial, [primaryKey])
    : partial;
};

const normalizeReferences = (
  references: Readonly<Partial<Record<string, string>>> | undefined
): Readonly<Record<string, string>> => {
  const normalized: Record<string, string> = {};

  for (const [field, target] of Object.entries(references ?? {})) {
    if (target !== undefined) {
      normalized[field] = target;
    }
  }

  return Object.freeze(normalized);
};

const validatePrimaryKey = (
  tableName: string,
  schema: StoreObjectSchema,
  primaryKey: string
): void => {
  if (hasField(schema, primaryKey)) {
    return;
  }

  throw new ValidationError(
    `Store table "${tableName}" declares primaryKey "${primaryKey}" that is not present on the schema`
  );
};

const validateTableInput = (
  tableName: string,
  schema: StoreObjectSchema,
  primaryKey: string,
  generated: readonly string[],
  indexes: readonly string[],
  references: Readonly<Partial<Record<string, string>>>,
  tableNames: readonly string[]
): void => {
  validatePrimaryKey(tableName, schema, primaryKey);
  validateFieldList(tableName, schema, generated, 'generated');
  validateFieldList(tableName, schema, indexes, 'index');
  validateReferences(tableName, schema, references, tableNames);
};

type MutableTables<TTables extends StoreTablesInput> = {
  -readonly [TName in keyof TTables]: StoreDefinition<TTables>['tables'][TName];
};

const normalizeTable = <
  TName extends string,
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  name: TName,
  input: TInput,
  tableNames: readonly string[]
): StoreTable<TInput, TName> => {
  if (!isStoreObjectSchema(input.schema)) {
    throw new ValidationError(
      `Store table "${name}" must use a Zod object schema`
    );
  }

  const generated = uniqueStrings(input.generated);
  const indexes = uniqueStrings(input.indexes);
  const references = normalizeReferences(input.references);
  validateTableInput(
    name,
    input.schema,
    input.primaryKey,
    generated,
    indexes,
    references,
    tableNames
  );

  const insertSchema = deriveInsertSchema(input.schema, generated);

  return Object.freeze({
    generated,
    indexes,
    insertSchema,
    name,
    primaryKey: input.primaryKey,
    references,
    schema: input.schema,
    ...(input.search === undefined ? {} : { search: input.search }),
    updateSchema: deriveUpdateSchema(insertSchema, input.primaryKey),
  }) as StoreTable<TInput, TName>;
};

/**
 * Declare a connector-agnostic store definition from entity schemas and
 * persistence metadata.
 *
 * The returned value is a normalized, read-only contract that connectors can
 * bind to a concrete runtime later.
 */
export const store = <const TTables extends StoreTablesInput>(
  tables: TTables
): StoreDefinition<TTables> => {
  const tableNames = Object.freeze(
    Object.keys(tables).toSorted()
  ) as readonly Extract<keyof TTables, string>[];

  const normalized = {} as MutableTables<TTables>;
  for (const name of tableNames) {
    const input = tables[name];

    if (input === undefined) {
      continue;
    }

    normalized[name] = normalizeTable(name, input, tableNames);
  }

  const get = <TName extends Extract<keyof TTables, string>>(name: TName) =>
    normalized[name];

  return Object.freeze({
    get,
    kind: 'store' as const,
    tableNames,
    tables: Object.freeze(normalized),
  });
};

/**
 * Read the full entity schema from a normalized store table.
 */
export const entitySchemaOf = <TTable extends StoreTable>(
  table: TTable
): TTable['schema'] => table.schema;

/**
 * Read the insert schema from a normalized store table.
 */
export const insertSchemaOf = <TTable extends StoreTable>(
  table: TTable
): TTable['insertSchema'] => table.insertSchema;

/**
 * Read the update schema from a normalized store table.
 */
export const updateSchemaOf = <TTable extends StoreTable>(
  table: TTable
): TTable['updateSchema'] => table.updateSchema;
