/** Warden-private store/factory pattern helpers. */

import type { AstNode } from '../../source/nodes.js';
import {
  extractBindingName,
  findConfigProperty,
  getPropertyName,
  identifierName,
} from '../../source/literals.js';
import { walk } from '../../source/walk.js';

export interface StoreTableDefinition {
  /** Table name declared inside store({ ... }). */
  readonly name: string;
  /**
   * Local binding name of the enclosing `store(...)` declaration, if the
   * `store(...)` call is bound to a `const`/`let`/`var` (e.g. `db` in
   * `const db = store({ ... })`). Null for anonymous stores.
   */
  readonly storeBinding: string | null;
  /**
   * Stable composite key for this table in the form `${storeBinding}:${name}`,
   * falling back to the bare `name` when the store is anonymous. Use this for
   * compose-rule / compose-file keying so two stores with the same table name
   * never collide.
   */
  readonly key: string;
  /** Start offset of the table property declaration. */
  readonly start: number;
  /** Whether the authored table opts into version tracking. */
  readonly versioned: boolean;
}

/**
 * Build a composite key for a store table: `${storeBinding}:${tableName}`,
 * falling back to the bare `tableName` when the enclosing store has no local
 * binding. Centralized so rule keying stays stable.
 *
 * @remarks
 * The key is intentionally file-local (no module path prefix). Compose-file
 * aggregation in `ProjectContext` merges keys from all files, so two files
 * with `const db = store({ notes: ... })` both produce `db:notes` — this is
 * the desired behavior because the warden checks for *pattern completeness*
 * across the project and matching keys signals that the same logical table
 * is covered. If two genuinely different tables share a binding and name,
 * that is a code-level naming collision the developer should resolve.
 */
export const makeStoreTableKey = (
  storeBinding: string | null,
  tableName: string
): string => (storeBinding ? `${storeBinding}:${tableName}` : tableName);

const isBooleanLiteral = (node: AstNode | undefined): boolean =>
  Boolean(
    node &&
    ((node.type === 'BooleanLiteral' &&
      (node as unknown as { value?: unknown }).value === true) ||
      (node.type === 'Literal' &&
        (node as unknown as { value?: unknown }).value === true))
  );

/**
 * Check if a node is a `CallExpression` to the identifier `name`.
 *
 * e.g. `isNamedCall(node, 'store')` matches `store({...})` but not
 * `someObj.store()` or `storeAlt()`.
 */
export const isNamedCall = (node: AstNode | undefined, name: string): boolean =>
  !!node &&
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) === name;

/**
 * Narrow a member-expression node (`a.b` or `a['b']`) to its `object` /
 * `property` pair, returning `null` for anything else.
 */
export const getMemberExpression = (
  node: AstNode | undefined
): { readonly object?: AstNode; readonly property?: AstNode } | null => {
  if (
    !node ||
    (node.type !== 'MemberExpression' && node.type !== 'StaticMemberExpression')
  ) {
    return null;
  }

  return node as unknown as {
    readonly object?: AstNode;
    readonly property?: AstNode;
  };
};

/**
 * Resolve a `<store>.tables.<name>` member expression to its store binding
 * and table name.
 *
 * Returns `null` for anything that isn't a two-level member access ending in
 * `.tables.<name>`. The store binding is the identifier of the object owning
 * `.tables` — typically the local binding from `const db = store(...)`.
 */
export const extractStoreTableFromMember = (
  node: AstNode | undefined
): {
  readonly storeBinding: string | null;
  readonly tableName: string;
} | null => {
  const member = getMemberExpression(node);
  const tableName = member ? getPropertyName(member.property) : null;
  const tablesMember = member ? getMemberExpression(member.object) : null;
  if (!tableName || !tablesMember) {
    return null;
  }

  if (getPropertyName(tablesMember.property) !== 'tables') {
    return null;
  }

  const storeBinding = identifierName(tablesMember.object) ?? null;
  return { storeBinding, tableName };
};

/**
 * Collect `const foo = <store>.tables.<name>` bindings from a parsed file,
 * keyed by the local binding name. Values are the composite table key
 * (`${storeBinding}:${tableName}`) so callers can dedupe across stores that
 * share a table name.
 */
export const collectNamedStoreTableIds = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = extractBindingName(id);
    const table = extractStoreTableFromMember(init);
    if (name && table) {
      ids.set(name, makeStoreTableKey(table.storeBinding, table.tableName));
    }
  });

  return ids;
};

/**
 * Resolve an argument node to a composite store-table key
 * (`${storeBinding}:${tableName}` or bare `tableName` when anonymous).
 *
 * Handles the two authoring patterns:
 *   - direct member access: `db.tables.notes`
 *   - identifier reference: `const notesTable = db.tables.notes; crud(notesTable, …)`
 */
export const deriveStoreTableId = (
  node: AstNode | undefined,
  namedStoreTableIds: ReadonlyMap<string, string>
): string | null => {
  if (!node) {
    return null;
  }

  if (node.type === 'Identifier') {
    const name = identifierName(node);
    return name ? (namedStoreTableIds.get(name) ?? null) : null;
  }

  const member = extractStoreTableFromMember(node);
  return member
    ? makeStoreTableKey(member.storeBinding, member.tableName)
    : null;
};

const extractStoreTableDefinitions = (
  node: AstNode,
  storeBinding: string | null
): readonly StoreTableDefinition[] => {
  if (!isNamedCall(node, 'store')) {
    return [];
  }

  const [tablesArg] = ((node as unknown as { arguments?: readonly AstNode[] })
    .arguments ?? []) as readonly AstNode[];
  if (!tablesArg || tablesArg.type !== 'ObjectExpression') {
    return [];
  }

  const properties = tablesArg['properties'] as readonly AstNode[] | undefined;
  if (!properties) {
    return [];
  }

  return properties.flatMap((property) => {
    if (property.type !== 'Property') {
      return [];
    }

    const name = getPropertyName(property.key);
    const value = property.value as AstNode | undefined;
    if (!name || value?.type !== 'ObjectExpression') {
      return [];
    }

    const versionedProp = findConfigProperty(value, 'versioned');
    return [
      {
        key: makeStoreTableKey(storeBinding, name),
        name,
        start: property.start,
        storeBinding,
        versioned: isBooleanLiteral(
          versionedProp?.value as AstNode | undefined
        ),
      },
    ];
  });
};

export const findStoreTableDefinitions = (
  ast: AstNode
): readonly StoreTableDefinition[] => {
  const definitions: StoreTableDefinition[] = [];
  const seenStoreCalls = new WeakSet<AstNode>();

  // First pass: bound stores (walk VariableDeclarators so we know the binding).
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    if (!init || !isNamedCall(init, 'store')) {
      return;
    }

    seenStoreCalls.add(init);
    const storeBinding = extractBindingName(id);
    definitions.push(...extractStoreTableDefinitions(init, storeBinding));
  });

  // Second pass: anonymous `store({...})` calls not bound to a variable
  // (e.g. an inline default export). Use the bare table name as the key.
  walk(ast, (node) => {
    if (!isNamedCall(node, 'store') || seenStoreCalls.has(node)) {
      return;
    }
    definitions.push(...extractStoreTableDefinitions(node, null));
  });

  return definitions;
};

export const collectCrudTableIds = (ast: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);

  walk(ast, (node) => {
    if (!isNamedCall(node, 'crud')) {
      return;
    }

    const [tableArg] = ((node as unknown as { arguments?: readonly AstNode[] })
      .arguments ?? []) as readonly AstNode[];
    const tableId = deriveStoreTableId(tableArg, namedStoreTableIds);
    if (tableId) {
      ids.add(tableId);
    }
  });

  return ids;
};

export const collectReconcileTableIds = (ast: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);

  walk(ast, (node) => {
    if (!isNamedCall(node, 'reconcile')) {
      return;
    }

    const [configArg] = ((
      node as unknown as {
        arguments?: readonly AstNode[];
      }
    ).arguments ?? []) as readonly AstNode[];
    if (!configArg || configArg.type !== 'ObjectExpression') {
      return;
    }

    const tableProp = findConfigProperty(configArg, 'table');
    const tableId = deriveStoreTableId(
      tableProp?.value as AstNode | undefined,
      namedStoreTableIds
    );
    if (tableId) {
      ids.add(tableId);
    }
  });

  return ids;
};
