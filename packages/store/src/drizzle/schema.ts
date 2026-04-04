import { ValidationError } from '@ontrails/core';
import {
  customType,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type {
  AnySQLiteColumn,
  AnySQLiteTable,
  SQLiteColumnBuilderBase,
} from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import type { AnyStoreDefinition, AnyStoreTable } from '../types.js';
import type { DrizzleStoreSchema } from './types.js';

const dateText = customType<{ data: Date; driverData: string }>({
  dataType() {
    return 'text';
  },
  fromDriver(value) {
    return new Date(value);
  },
  toDriver(value) {
    return value.toISOString();
  },
});

interface InnerTypeDef {
  readonly innerType: z.ZodType;
}

interface DefaultTypeDef extends InnerTypeDef {
  readonly defaultValue?: unknown;
}

interface UnwrappedSchema {
  readonly defaultValue?: unknown;
  readonly nullable: boolean;
  readonly optional: boolean;
  readonly schema: z.ZodType;
}

interface SqliteFieldSpec {
  readonly defaultValue?: unknown;
  readonly enumValues?: readonly [string, ...string[]];
  readonly kind: 'boolean' | 'date' | 'integer' | 'json' | 'real' | 'text';
  readonly nullable: boolean;
  readonly optional: boolean;
}

interface SqliteColumnBuilder {
  default(value: unknown): SqliteColumnBuilder;
  notNull(): SqliteColumnBuilder;
  primaryKey(config?: {
    readonly autoIncrement?: boolean;
  }): SqliteColumnBuilder;
  references(
    ref: () => AnySQLiteColumn,
    actions?: {
      readonly onDelete?:
        | 'cascade'
        | 'restrict'
        | 'set null'
        | 'set default'
        | 'no action';
      readonly onUpdate?:
        | 'cascade'
        | 'restrict'
        | 'set null'
        | 'set default'
        | 'no action';
    }
  ): SqliteColumnBuilder;
}

const defaultUnwrapState: Omit<UnwrappedSchema, 'schema'> = {
  nullable: false,
  optional: false,
};

/**
 * The unwrap helpers below access Zod internal `._def` shapes (`def.type`,
 * `def.checks`, `def.innerType`, `def.defaultValue`). These are not part of
 * Zod's public API and may change across minor versions. The store package
 * pins Zod through the workspace catalog — test `z.number().int()` mapping
 * to `INTEGER` (see drizzle.test.ts) to catch regressions on Zod upgrades.
 */
const unwrapInnerType = (schema: z.ZodType): z.ZodType => {
  const { innerType } = schema.def as unknown as InnerTypeDef;
  return innerType;
};

const unwrapDefaultLayer = (
  schema: z.ZodType
): {
  readonly defaultValue?: unknown;
  readonly schema: z.ZodType;
} => {
  const { defaultValue } = schema.def as unknown as DefaultTypeDef;
  return {
    defaultValue,
    schema: unwrapInnerType(schema),
  };
};

const unwrapSchema = (
  schema: z.ZodType,
  state: Omit<UnwrappedSchema, 'schema'> = defaultUnwrapState
): UnwrappedSchema => {
  switch (schema.def.type) {
    case 'default': {
      const { defaultValue, schema: innerSchema } = unwrapDefaultLayer(schema);
      return unwrapSchema(innerSchema, { ...state, defaultValue });
    }
    case 'nullable': {
      return unwrapSchema(unwrapInnerType(schema), {
        ...state,
        nullable: true,
      });
    }
    case 'optional': {
      return unwrapSchema(unwrapInnerType(schema), {
        ...state,
        optional: true,
      });
    }
    default: {
      return {
        ...state,
        schema,
      };
    }
  }
};

const isIntegerNumber = (schema: z.ZodType): boolean =>
  schema.def.type === 'number' &&
  ((schema.def.checks as readonly unknown[] | undefined) ?? []).some(
    (check) => {
      const { def } = check as { readonly def?: Record<string, unknown> };
      return def?.['check'] === 'number_format';
    }
  );

const toEnumValues = (
  entries: Record<string, string>
): readonly [string, ...string[]] => {
  const values = Object.values(entries);
  if (values.length === 0) {
    throw new ValidationError('Enum-backed store fields must declare values');
  }

  return values as unknown as readonly [string, ...string[]];
};

const fieldSpecBase = (
  unwrapped: UnwrappedSchema
): Omit<SqliteFieldSpec, 'kind'> => ({
  ...(unwrapped.defaultValue === undefined
    ? {}
    : { defaultValue: unwrapped.defaultValue }),
  nullable: unwrapped.nullable,
  optional: unwrapped.optional,
});

const enumEntriesOf = (schema: z.ZodType): Record<string, string> => {
  const { entries } = schema.def as unknown as {
    readonly entries: Record<string, string>;
  };
  return entries;
};

const inferFieldKind = (
  field: string,
  schema: z.ZodType
): SqliteFieldSpec['kind'] => {
  switch (schema.def.type) {
    case 'array':
    case 'object': {
      return 'json';
    }
    case 'boolean': {
      return 'boolean';
    }
    case 'date': {
      return 'date';
    }
    case 'enum': {
      return 'text';
    }
    case 'number': {
      return isIntegerNumber(schema) ? 'integer' : 'real';
    }
    case 'string': {
      return 'text';
    }
    default: {
      throw new ValidationError(
        `Store field "${field}" uses unsupported schema type "${schema.def.type}" for the Drizzle SQLite connector`
      );
    }
  }
};

export const describeField = (
  field: string,
  schema: z.ZodType
): SqliteFieldSpec => {
  const unwrapped = unwrapSchema(schema);
  const base = fieldSpecBase(unwrapped);
  const kind = inferFieldKind(field, unwrapped.schema);

  return {
    ...base,
    ...(unwrapped.schema.def.type === 'enum'
      ? { enumValues: toEnumValues(enumEntriesOf(unwrapped.schema)) }
      : {}),
    kind,
  };
};

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const quoteStringLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

const serializeJsonDefault = (value: object | readonly unknown[]): string =>
  quoteStringLiteral(JSON.stringify(value));

const serializePrimitiveDefault = (
  value: string | number | boolean
): string | undefined => {
  switch (typeof value) {
    case 'boolean': {
      return value ? '1' : '0';
    }
    case 'number': {
      return Number.isFinite(value) ? `${value}` : undefined;
    }
    case 'string': {
      return quoteStringLiteral(value);
    }
    default: {
      return undefined;
    }
  }
};

const toSqlDefault = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Date) {
    return quoteStringLiteral(value.toISOString());
  }

  return typeof value === 'object'
    ? serializeJsonDefault(value as object)
    : serializePrimitiveDefault(value as string | number | boolean);
};

const toSqlType = (kind: SqliteFieldSpec['kind']): string => {
  switch (kind) {
    case 'boolean':
    case 'integer': {
      return 'INTEGER';
    }
    case 'real': {
      return 'REAL';
    }
    case 'date':
    case 'json':
    case 'text': {
      return 'TEXT';
    }
    default: {
      return 'TEXT';
    }
  }
};

const createBaseColumnBuilder = (
  field: string,
  spec: SqliteFieldSpec
): SqliteColumnBuilder => {
  switch (spec.kind) {
    case 'boolean': {
      return integer(field, {
        mode: 'boolean',
      }) as unknown as SqliteColumnBuilder;
    }
    case 'date': {
      return dateText(field) as unknown as SqliteColumnBuilder;
    }
    case 'integer': {
      return integer(field) as unknown as SqliteColumnBuilder;
    }
    case 'json': {
      return text(field, { mode: 'json' }) as unknown as SqliteColumnBuilder;
    }
    case 'real': {
      return real(field) as unknown as SqliteColumnBuilder;
    }
    case 'text': {
      return spec.enumValues === undefined
        ? (text(field) as unknown as SqliteColumnBuilder)
        : (text(field, {
            enum: spec.enumValues,
          }) as unknown as SqliteColumnBuilder);
    }
    default: {
      throw new ValidationError(
        `Store field "${field}" resolved to an unsupported Drizzle column builder`
      );
    }
  }
};

const applyPrimaryKey = (
  builder: SqliteColumnBuilder,
  spec: SqliteFieldSpec,
  isPrimaryKey: boolean,
  isGenerated: boolean
): SqliteColumnBuilder => {
  if (!isPrimaryKey) {
    return builder;
  }

  const shouldAutoIncrement =
    isGenerated && spec.kind === 'integer' && spec.defaultValue === undefined;

  return shouldAutoIncrement
    ? builder.primaryKey({ autoIncrement: true })
    : builder.primaryKey();
};

const applyCommonBuilderState = (
  builder: SqliteColumnBuilder,
  spec: SqliteFieldSpec,
  notNull: boolean
): SqliteColumnBuilder => {
  let next = builder;

  if (notNull) {
    next = next.notNull();
  }

  if (toSqlDefault(spec.defaultValue) !== undefined) {
    next = next.default(spec.defaultValue);
  }

  return next;
};

const resolveReferencedTable = (
  definition: AnyStoreDefinition,
  sourceTable: AnyStoreTable,
  targetTableName: string
): AnyStoreTable => {
  const target = definition.tables[targetTableName];
  if (target !== undefined) {
    return target;
  }

  throw new ValidationError(
    `Store table "${sourceTable.name}" references unknown table "${targetTableName}"`
  );
};

const resolveReferencedColumn = (
  tables: Record<string, AnySQLiteTable>,
  targetTableName: string,
  targetPrimaryKey: string
): AnySQLiteColumn => {
  const targetTable = tables[targetTableName];
  if (targetTable === undefined) {
    throw new ValidationError(
      `Store table reference to "${targetTableName}" could not be resolved during Drizzle schema derivation`
    );
  }

  return targetTable[
    targetPrimaryKey as keyof typeof targetTable
  ] as AnySQLiteColumn;
};

const applyReference = (
  builder: SqliteColumnBuilder,
  field: string,
  table: AnyStoreTable,
  definition: AnyStoreDefinition,
  tables: Record<string, AnySQLiteTable>
): SqliteColumnBuilder => {
  const targetTableName = table.references[field];
  if (targetTableName === undefined) {
    return builder;
  }

  const target = resolveReferencedTable(definition, table, targetTableName);
  return builder.references(
    () => resolveReferencedColumn(tables, targetTableName, target.primaryKey),
    { onDelete: 'restrict', onUpdate: 'cascade' }
  );
};

const deriveColumnBuilder = (
  field: string,
  table: AnyStoreTable,
  definition: AnyStoreDefinition,
  tables: Record<string, AnySQLiteTable>
): SqliteColumnBuilder => {
  const schema = table.schema.shape[field] as z.ZodType;
  const spec = describeField(field, schema);
  const isPrimaryKey = field === table.primaryKey;
  const isGenerated = table.generated.includes(field);
  const baseBuilder = createBaseColumnBuilder(field, spec);
  const keyedBuilder = applyPrimaryKey(
    baseBuilder,
    spec,
    isPrimaryKey,
    isGenerated
  );
  const finalizedBuilder = applyCommonBuilderState(
    keyedBuilder,
    spec,
    !isPrimaryKey && !spec.optional && !spec.nullable
  );

  return applyReference(finalizedBuilder, field, table, definition, tables);
};

const appendPrimaryKeySql = (
  parts: string[],
  field: string,
  table: AnyStoreTable,
  spec: SqliteFieldSpec
): void => {
  const isPrimaryKey = field === table.primaryKey;
  if (!isPrimaryKey) {
    if (!spec.optional && !spec.nullable) {
      parts.push('NOT NULL');
    }
    return;
  }

  parts.push('NOT NULL');
  parts.push('PRIMARY KEY');
  const isAutoIncrement =
    table.generated.includes(field) &&
    spec.kind === 'integer' &&
    spec.defaultValue === undefined;

  if (isAutoIncrement) {
    parts.push('AUTOINCREMENT');
  }
};

const appendDefaultSql = (parts: string[], spec: SqliteFieldSpec): void => {
  const sqlDefault = toSqlDefault(spec.defaultValue);
  if (sqlDefault !== undefined) {
    parts.push(`DEFAULT ${sqlDefault}`);
  }
};

const appendReferenceSql = (
  parts: string[],
  field: string,
  table: AnyStoreTable,
  definition: AnyStoreDefinition
): void => {
  const targetTableName = table.references[field];
  if (targetTableName === undefined) {
    return;
  }

  const target = resolveReferencedTable(definition, table, targetTableName);
  parts.push(
    `REFERENCES ${quoteIdentifier(targetTableName)} (${quoteIdentifier(target.primaryKey)}) ON DELETE RESTRICT ON UPDATE CASCADE`
  );
};

const createColumnSqlParts = (
  field: string,
  schema: z.ZodType,
  table: AnyStoreTable,
  definition: AnyStoreDefinition
): string[] => {
  const spec = describeField(field, schema);
  const parts = [quoteIdentifier(field), toSqlType(spec.kind)];
  appendPrimaryKeySql(parts, field, table, spec);
  appendDefaultSql(parts, spec);
  appendReferenceSql(parts, field, table, definition);
  return parts;
};

const createColumnSql = (
  field: string,
  schema: z.ZodType,
  table: AnyStoreTable,
  definition: AnyStoreDefinition
): string =>
  `  ${createColumnSqlParts(field, schema, table, definition).join(' ')}`;

const createTableSql = (
  table: AnyStoreTable,
  definition: AnyStoreDefinition
): string => {
  const columns = Object.entries(table.schema.shape).map(([field, schema]) =>
    createColumnSql(field, schema as z.ZodType, table, definition)
  );

  return [
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (`,
    columns.join(',\n'),
    ')',
  ].join('\n');
};

const createIndexSql = (table: AnyStoreTable, field: string): string =>
  `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${table.name}_${field}_idx`)} ON ${quoteIdentifier(table.name)} (${quoteIdentifier(field)})`;

const definedTables = (
  definition: AnyStoreDefinition
): readonly AnyStoreTable[] =>
  definition.tableNames.flatMap((name) => {
    const table = definition.tables[name];
    return table === undefined ? [] : [table];
  });

const createIndexStatements = (
  definition: AnyStoreDefinition
): readonly string[] =>
  definedTables(definition).flatMap((table) =>
    table.indexes.map((field) => createIndexSql(table, field))
  );

export const deriveDrizzleTables = <TStore extends AnyStoreDefinition>(
  definition: TStore
): DrizzleStoreSchema<TStore> => {
  const tables: Record<string, AnySQLiteTable> = {};

  for (const table of definedTables(definition)) {
    tables[table.name] = sqliteTable(
      table.name,
      Object.fromEntries(
        Object.keys(table.schema.shape).map((field) => [
          field,
          deriveColumnBuilder(field, table, definition, tables),
        ])
      ) as unknown as Record<string, SQLiteColumnBuilderBase>,
      (self) =>
        table.indexes.map((field) =>
          index(`${table.name}_${field}_idx`).on(
            self[field as keyof typeof self] as AnySQLiteColumn
          )
        )
    );
  }

  return Object.freeze(tables) as DrizzleStoreSchema<TStore>;
};

export const createSqliteSchemaStatements = (
  definition: AnyStoreDefinition
): readonly string[] =>
  Object.freeze([
    ...definedTables(definition).map((table) =>
      createTableSql(table, definition)
    ),
    ...createIndexStatements(definition),
  ]);
