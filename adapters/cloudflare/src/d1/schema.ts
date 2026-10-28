import type { AnyStoreDefinition, AnyStoreTable } from '@ontrails/store';

export const defaultD1TablePrefix = 'store';

export const quoteD1Identifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

export const d1TableName = (prefix: string, table: AnyStoreTable): string =>
  `${prefix}.${table.name}`;

export const renderD1CreateTableSql = (tableName: string): string =>
  `CREATE TABLE IF NOT EXISTS ${quoteD1Identifier(tableName)} (id TEXT PRIMARY KEY, entity TEXT NOT NULL, version INTEGER);`;

/**
 * Render a deterministic, create-only baseline for the D1 physical storage layout.
 * Apply reviewed SQL through Wrangler migrations before using the default driver.
 * This does not compare, validate or upgrade existing schema or transform JSON rows.
 * For resources, reuse options.tablePrefix ?? resource.id as the prefix.
 *
 * @example
 * ```ts
 * import { renderD1SchemaSql } from '@ontrails/cloudflare/d1';
 * const sql = renderD1SchemaSql(definition, { tablePrefix: 'notes.store' });
 * ```
 */
export const renderD1SchemaSql = (
  definition: AnyStoreDefinition,
  options: { readonly tablePrefix?: string | undefined } = {}
): string => {
  const prefix = options.tablePrefix ?? defaultD1TablePrefix;
  const statements: string[] = [];
  for (const name of definition.tableNames.toSorted()) {
    const table = definition.tables[name];
    if (table !== undefined) {
      statements.push(renderD1CreateTableSql(d1TableName(prefix, table)));
    }
  }
  return statements.length === 0 ? '' : `${statements.join('\n')}\n`;
};
