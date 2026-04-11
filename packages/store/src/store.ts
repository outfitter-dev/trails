import { signal, ValidationError } from '@ontrails/core';
import type { AnySignal } from '@ontrails/core';
import { z } from 'zod';

import type {
  StoreDefinition,
  StoreKind,
  StoreOptions,
  StoreObjectSchema,
  StoreTable,
  StoreTableSignals,
  StoreTableInput,
  StoreTablesInput,
} from './types.js';

const isStoreObjectSchema = (schema: z.ZodType): schema is StoreObjectSchema =>
  schema.def.type === 'object' && 'shape' in schema.def;

const versionFieldName = 'version';
const versionFieldSchema = z.number().int().positive();

const uniqueStrings = <T extends string>(
  values: readonly T[] | undefined
): readonly T[] =>
  Object.freeze([...(values === undefined ? [] : new Set(values))]);

const uniqueMergedStrings = <T extends string>(
  ...groups: readonly (readonly T[] | undefined)[]
): readonly T[] => uniqueStrings(groups.flatMap((group) => [...(group ?? [])]));

const hasField = (schema: StoreObjectSchema, field: string): boolean =>
  Object.hasOwn(schema.shape, field);

const versionedSchema = (schema: StoreObjectSchema): StoreObjectSchema =>
  schema.extend({
    [versionFieldName]: versionFieldSchema,
  }) as StoreObjectSchema;

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

const createTableSignals = (
  tableName: string,
  schema: StoreObjectSchema
): StoreTableSignals<unknown> =>
  Object.freeze({
    created: signal(`${tableName}.created`, {
      description: `Fired after a "${tableName}" entity is created.`,
      payload: schema,
    }),
    removed: signal(`${tableName}.removed`, {
      description: `Fired after a "${tableName}" entity is removed.`,
      payload: schema,
    }),
    updated: signal(`${tableName}.updated`, {
      description: `Fired after a "${tableName}" entity is updated.`,
      payload: schema,
    }),
  });

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

const validateVersioning = (
  tableName: string,
  schema: StoreObjectSchema,
  versioned: boolean
): void => {
  if (!versioned || !hasField(schema, versionFieldName)) {
    return;
  }

  throw new ValidationError(
    `Store table "${tableName}" cannot declare a "${versionFieldName}" field when versioned storage is enabled because the framework manages that field.`
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

const resolveVersioned = (input: StoreTableInput): boolean =>
  input.versioned === true;

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

const resolveTableSchema = <TInput extends StoreTableInput<StoreObjectSchema>>(
  tableName: string,
  input: TInput
): {
  readonly schema: StoreObjectSchema;
  readonly versioned: boolean;
} => {
  const authoredSchema = resolveStoreObjectSchema(tableName, input.schema);
  const versioned = resolveVersioned(input);
  validateVersioning(tableName, authoredSchema, versioned);

  return {
    schema: versioned ? versionedSchema(authoredSchema) : authoredSchema,
    versioned,
  };
};

const resolveGeneratedFields = <
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  input: TInput,
  versioned: boolean
): readonly string[] =>
  versioned
    ? uniqueMergedStrings(input.generated, [versionFieldName])
    : uniqueStrings(input.generated);

const freezeNormalizedTable = <
  TName extends string,
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  name: TName,
  input: TInput,
  resolved: {
    readonly fixtureSchema: StoreObjectSchema;
    readonly fixtures: StoreTable<TInput>['fixtures'];
    readonly generated: readonly string[];
    readonly identity: string;
    readonly indexed: readonly string[];
    readonly insertSchema: StoreObjectSchema;
    readonly references: Readonly<Partial<Record<string, string>>>;
    readonly schema: StoreObjectSchema;
    readonly signals: StoreTable<TInput, TName>['signals'];
    readonly versioned: boolean;
  }
): StoreTable<TInput, TName> =>
  Object.freeze({
    fixtureSchema: resolved.fixtureSchema,
    fixtures: resolved.fixtures,
    generated: resolved.generated,
    identity: resolved.identity,
    indexed: resolved.indexed,
    indexes: resolved.indexed,
    insertSchema: resolved.insertSchema,
    name,
    primaryKey: resolved.identity,
    references: resolved.references,
    schema: resolved.schema,
    ...(input.search === undefined ? {} : { search: input.search }),
    signals: resolved.signals,
    updateSchema: deriveUpdateSchema(resolved.insertSchema, resolved.identity),
    versioned: resolved.versioned,
  }) as StoreTable<TInput, TName>;

interface NormalizedTableState {
  readonly generated: readonly string[];
  readonly identity: string;
  readonly indexed: readonly string[];
  readonly references: Readonly<Partial<Record<string, string>>>;
  readonly schema: StoreObjectSchema;
  readonly versioned: boolean;
}

const resolveNormalizedTableState = <
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  name: string,
  input: TInput,
  tableNames: readonly string[]
): NormalizedTableState => {
  const { schema, versioned } = resolveTableSchema(name, input);
  const identity = resolveIdentity(name, input);
  const generated = resolveGeneratedFields(input, versioned);
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

  return {
    generated,
    identity,
    indexed,
    references,
    schema,
    versioned,
  };
};

const resolveNormalizedTableArtifacts = <
  TName extends string,
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  name: TName,
  input: TInput,
  resolved: NormalizedTableState
): {
  readonly fixtureSchema: StoreObjectSchema;
  readonly fixtures: StoreTable<TInput>['fixtures'];
  readonly generated: readonly string[];
  readonly identity: string;
  readonly indexed: readonly string[];
  readonly insertSchema: StoreObjectSchema;
  readonly references: Readonly<Partial<Record<string, string>>>;
  readonly schema: StoreObjectSchema;
  readonly signals: StoreTable<TInput, TName>['signals'];
} => {
  const insertSchema = deriveInsertSchema(resolved.schema, resolved.generated);
  const fixtureSchema = deriveFixtureSchema(
    resolved.schema,
    resolved.generated
  );
  const fixtures = normalizeFixtures(
    name,
    resolved.identity,
    fixtureSchema,
    input.fixtures
  );
  const signals = createTableSignals(name, resolved.schema) as StoreTable<
    TInput,
    TName
  >['signals'];

  return {
    fixtureSchema,
    fixtures,
    generated: resolved.generated,
    identity: resolved.identity,
    indexed: resolved.indexed,
    insertSchema,
    references: resolved.references,
    schema: resolved.schema,
    signals,
  };
};

const normalizeTable = <
  TName extends string,
  TInput extends StoreTableInput<StoreObjectSchema>,
>(
  name: TName,
  input: TInput,
  tableNames: readonly string[]
): StoreTable<TInput, TName> => {
  const resolved = resolveNormalizedTableState(name, input, tableNames);

  return freezeNormalizedTable(name, input, {
    ...resolveNormalizedTableArtifacts(name, input, resolved),
    versioned: resolved.versioned,
  });
};

const normalizeTables = <const TTables extends StoreTablesInput>(
  tables: TTables,
  tableNames: readonly Extract<keyof TTables, string>[]
): MutableTables<TTables> => {
  const normalized = {} as MutableTables<TTables>;

  for (const name of tableNames) {
    const input = tables[name];
    if (input !== undefined) {
      normalized[name] = normalizeTable(name, input, tableNames);
    }
  }

  return normalized;
};

const collectStoreSignals = <const TTables extends StoreTablesInput>(
  normalized: MutableTables<TTables>,
  tableNames: readonly Extract<keyof TTables, string>[]
): readonly AnySignal[] =>
  Object.freeze(
    tableNames.flatMap((name) => {
      const table = normalized[name];
      return table === undefined
        ? []
        : [table.signals.created, table.signals.updated, table.signals.removed];
    })
  );

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
  const normalized = normalizeTables(tables, tableNames);
  const get = <TName extends Extract<keyof TTables, string>>(name: TName) =>
    normalized[name];
  const signals = collectStoreSignals(normalized, tableNames);

  return Object.freeze({
    get,
    kind,
    signals,
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
