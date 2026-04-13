import { ValidationError } from '@ontrails/core';
import type { z } from 'zod';

import type {
  StoreDefinition,
  StoreKind,
  StoreOptions,
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

const uniqueMergedStrings = <T extends string>(
  ...groups: readonly (readonly T[] | undefined)[]
): readonly T[] => uniqueStrings(groups.flatMap((group) => [...(group ?? [])]));

const hasField = (schema: StoreObjectSchema, field: string): boolean =>
  Object.hasOwn(schema.shape, field);

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

const partialFields = <TSchema extends StoreObjectSchema>(
  schema: TSchema,
  fields: readonly string[]
): StoreObjectSchema => {
  if (fields.length === 0) {
    return schema;
  }

  return schema.partial(buildFieldMask(fields)) as StoreObjectSchema;
};

const deriveInsertSchema = <TSchema extends StoreObjectSchema>(
  schema: TSchema,
  generated: readonly string[]
): StoreObjectSchema => omitFields(schema, generated);

const deriveFixtureSchema = <TSchema extends StoreObjectSchema>(
  schema: TSchema,
  generated: readonly string[]
): StoreObjectSchema => partialFields(schema, generated);

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
  return wrappers.includes('nullable') ? current.nullable() : current;
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
  identity: string
): StoreObjectSchema => {
  const partial = schema
    .extend(stripDefaultsFromShape(schema))
    .partial() as StoreObjectSchema;
  // Only omit the identity field if it's still present (it may already be in `generated`)
  return hasField(partial, identity)
    ? omitFields(partial, [identity])
    : partial;
};

const formatFixtureIssues = (issues: readonly { readonly message: string }[]) =>
  issues.map((issue) => issue.message).join('; ');

const validateFixturePrimaryKeys = (
  tableName: string,
  identity: string,
  fixtures: readonly Record<string, unknown>[]
): void => {
  const seen = new Set<unknown>();

  for (const [index, fixture] of fixtures.entries()) {
    const identifier = fixture[identity];
    if (identifier === undefined) {
      continue;
    }

    if (seen.has(identifier)) {
      throw new ValidationError(
        `Store table "${tableName}" fixture ${index + 1} duplicates primary key "${String(identifier)}"`
      );
    }

    seen.add(identifier);
  }
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
  identity: string
): void => {
  if (hasField(schema, identity)) {
    return;
  }

  throw new ValidationError(
    `Store table "${tableName}" declares identity "${identity}" that is not present on the schema`
  );
};

const resolveStoreObjectSchema = (
  tableName: string,
  schema: StoreTableInput['schema']
): StoreObjectSchema => {
  if (isStoreObjectSchema(schema)) {
    return schema;
  }

  throw new ValidationError(
    `Store table "${tableName}" must use a Zod object schema`
  );
};

const resolveIdentity = (tableName: string, input: StoreTableInput): string => {
  if (
    input.identity !== undefined &&
    input.primaryKey !== undefined &&
    input.identity !== input.primaryKey
  ) {
    throw new ValidationError(
      `Store table "${tableName}" declares conflicting identity "${input.identity}" and primaryKey "${input.primaryKey}"`
    );
  }

  const identity = input.identity ?? input.primaryKey;
  if (identity !== undefined) {
    return identity;
  }

  throw new ValidationError(`Store table "${tableName}" must declare identity`);
};

const resolveIndexed = (input: StoreTableInput): readonly string[] =>
  uniqueMergedStrings(input.indexed, input.indexes);

const validateTableInput = (
  tableName: string,
  schema: StoreObjectSchema,
  identity: string,
  generated: readonly string[],
  indexed: readonly string[],
  references: Readonly<Partial<Record<string, string>>>,
  tableNames: readonly string[]
): void => {
  validatePrimaryKey(tableName, schema, identity);
  validateFieldList(tableName, schema, generated, 'generated');
  validateFieldList(tableName, schema, indexed, 'indexed');
  validateReferences(tableName, schema, references, tableNames);
};

type MutableTables<TTables extends StoreTablesInput> = {
  -readonly [TName in keyof TTables]: StoreDefinition<TTables>['tables'][TName];
};

const fixtureListFrom = (
  fixtures: StoreTableInput['fixtures']
): readonly unknown[] => (Array.isArray(fixtures) ? fixtures : []);

const parseFixture = (
  tableName: string,
  fixtureSchema: StoreObjectSchema,
  fixture: unknown,
  index: number
): Readonly<Record<string, unknown>> => {
  const parsed = fixtureSchema.safeParse(fixture);
  if (!parsed.success) {
    throw new ValidationError(
      `Store table "${tableName}" fixture ${index + 1} is invalid: ${formatFixtureIssues(parsed.error.issues)}`
    );
  }

  return Object.freeze(parsed.data);
};

const normalizeFixtures = <TInput extends StoreTableInput>(
  tableName: string,
  identity: string,
  fixtureSchema: StoreObjectSchema,
  fixtures: TInput['fixtures']
): StoreTable<TInput>['fixtures'] => {
  const fixtureList = fixtureListFrom(fixtures);

  if (fixtureList.length === 0) {
    return Object.freeze([]) as StoreTable<TInput>['fixtures'];
  }

  const normalized: Record<string, unknown>[] = [];

  for (const [index, fixture] of fixtureList.entries()) {
    normalized.push(parseFixture(tableName, fixtureSchema, fixture, index));
  }

  validateFixturePrimaryKeys(tableName, identity, normalized);
  return Object.freeze(normalized) as StoreTable<TInput>['fixtures'];
};

const normalizeTable = <
  TName extends string,
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  name: TName,
  input: TInput,
  tableNames: readonly string[]
): StoreTable<TInput, TName> => {
  const schema = resolveStoreObjectSchema(name, input.schema);
  const identity = resolveIdentity(name, input);
  const generated = uniqueStrings(input.generated);
  const indexed = resolveIndexed(input);
  const references = normalizeReferences(input.references);
  validateTableInput(
    name,
    schema,
    identity,
    generated,
    indexed,
    references,
    tableNames
  );

  const insertSchema = deriveInsertSchema(schema, generated);
  const fixtureSchema = deriveFixtureSchema(schema, generated);
  const fixtures = normalizeFixtures(
    name,
    identity,
    fixtureSchema,
    input.fixtures
  );

  return Object.freeze({
    fixtureSchema,
    fixtures,
    generated,
    identity,
    indexed,
    indexes: indexed,
    insertSchema,
    name,
    primaryKey: identity,
    references,
    schema,
    ...(input.search === undefined ? {} : { search: input.search }),
    updateSchema: deriveUpdateSchema(insertSchema, identity),
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
  tables: TTables,
  options: StoreOptions = {}
): StoreDefinition<TTables> => {
  const kind: StoreKind = options.kind ?? 'tabular';
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
    kind,
    tableNames,
    tables: Object.freeze(normalized),
    type: 'store' as const,
  });
};

/**
 * Read the full entity schema from a normalized store table.
 */
export const entitySchemaOf = <TTable extends StoreTable>(
  table: TTable
): TTable['schema'] => table.schema;

/**
 * Read the fixture schema from a normalized store table.
 */
export const fixtureSchemaOf = <TTable extends StoreTable>(
  table: TTable
): TTable['fixtureSchema'] => table.fixtureSchema;

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
