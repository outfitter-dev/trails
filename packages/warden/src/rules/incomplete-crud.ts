import {
  collectImportAliasMap,
  collectNamedContourIds,
  collectNamedStoreTableIds,
  getStringValue,
  identifierName,
  isNamedCall,
  isStringLiteral,
  offsetToLine,
  parse,
  deriveStoreTableId,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const CRUD_OPERATIONS = ['create', 'read', 'update', 'delete', 'list'] as const;
const CRUD_OPERATION_SET = new Set<string>(CRUD_OPERATIONS);

/** Sentinel entity id prefix for contours imported from another module. */
const IMPORTED_CONTOUR_PREFIX = 'imported:';

interface CrudCoverage {
  readonly entityId: string;
  readonly line: number;
  readonly operations: Set<string>;
}

const extractInlineContourId = (node: AstNode | undefined): string | null => {
  if (!isNamedCall(node, 'contour')) {
    return null;
  }

  const [nameArg] = ((node as unknown as { arguments?: readonly AstNode[] })
    .arguments ?? []) as readonly AstNode[];
  return nameArg && isStringLiteral(nameArg) ? getStringValue(nameArg) : null;
};

/**
 * Resolve an identifier reference (bound contour or imported alias) to a
 * stable entity id. Imported identifiers return a `pending-resolution`
 * sentinel so coverage is still tracked instead of silently dropped.
 */
const resolveContourIdentifier = (
  name: string,
  namedContourIds: ReadonlyMap<string, string>,
  importAliases: ReadonlyMap<string, string>
): string | null => {
  const local = namedContourIds.get(name);
  if (local) {
    return local;
  }

  if (importAliases.has(name)) {
    return `${IMPORTED_CONTOUR_PREFIX}${importAliases.get(name) ?? name}`;
  }

  return null;
};

/**
 * Resolve a `deriveTrail` contour argument to a stable entity id.
 *
 * Resolution order:
 *   1. Inline `contour('name', …)` call — use the authored name.
 *   2. Local identifier bound to `contour('name', …)` via `namedContourIds`.
 *   3. Identifier imported from another module — mark as a pending
 *      `imported:<local>` coverage observation so the rule still tracks the
 *      entity across the file instead of silently dropping it. The prefix is
 *      stripped from diagnostic output for readability.
 */
const resolveContourId = (
  node: AstNode | undefined,
  namedContourIds: ReadonlyMap<string, string>,
  importAliases: ReadonlyMap<string, string>
): string | null => {
  if (!node) {
    return null;
  }

  if (node.type === 'Identifier') {
    const name = identifierName(node);
    return name
      ? resolveContourIdentifier(name, namedContourIds, importAliases)
      : null;
  }

  return extractInlineContourId(node);
};

const ensureCoverage = (
  coverageByEntityId: Map<string, CrudCoverage>,
  entityId: string,
  line: number
): CrudCoverage => {
  const existing = coverageByEntityId.get(entityId);
  if (existing) {
    return existing;
  }

  const coverage: CrudCoverage = {
    entityId,
    line,
    operations: new Set<string>(),
  };
  coverageByEntityId.set(entityId, coverage);
  return coverage;
};

const extractCrudOperation = (node: AstNode | undefined): string | null => {
  if (!node || !isStringLiteral(node)) {
    return null;
  }

  const operation = getStringValue(node);
  return operation && CRUD_OPERATION_SET.has(operation) ? operation : null;
};

const extractDerivedCrudEntry = (
  node: AstNode,
  namedContourIds: ReadonlyMap<string, string>,
  importAliases: ReadonlyMap<string, string>
): { readonly entityId: string; readonly operation: string } | null => {
  if (!isNamedCall(node, 'deriveTrail')) {
    return null;
  }

  const [contourArg, operationArg] = ((
    node as unknown as {
      arguments?: readonly AstNode[];
    }
  ).arguments ?? []) as readonly AstNode[];
  const operation = extractCrudOperation(operationArg);
  const entityId = resolveContourId(contourArg, namedContourIds, importAliases);
  return operation && entityId ? { entityId, operation } : null;
};

const collectDerivedCrudCoverage = (
  ast: AstNode,
  sourceCode: string
): ReadonlyMap<string, CrudCoverage> => {
  const coverageByEntityId = new Map<string, CrudCoverage>();
  const namedContourIds = collectNamedContourIds(ast);
  const importAliases = collectImportAliasMap(ast);

  walk(ast, (node) => {
    const entry = extractDerivedCrudEntry(node, namedContourIds, importAliases);
    if (!entry) {
      return;
    }

    ensureCoverage(
      coverageByEntityId,
      entry.entityId,
      offsetToLine(sourceCode, node.start)
    ).operations.add(entry.operation);
  });

  return coverageByEntityId;
};

const collectTupleOperations = (
  elements: readonly AstNode[]
): readonly string[] =>
  // Array-pattern elisions are represented as null by OXC today; the truthy
  // check below intentionally treats those the same as out-of-bounds slots.
  // If OXC ever switches to a non-null placeholder node, update this to an
  // explicit null check so elisions still count as absent.
  CRUD_OPERATIONS.flatMap((operation, index) =>
    elements[index] ? [operation] : []
  );

const extractCrudTuplePattern = (
  node: AstNode,
  namedStoreTableIds: ReadonlyMap<string, string>
): {
  readonly elements: readonly AstNode[];
  readonly entityId: string;
} | null => {
  if (node.type !== 'VariableDeclarator') {
    return null;
  }

  const { id, init } = node as unknown as {
    readonly id?: AstNode;
    readonly init?: AstNode;
  };
  if (!id || id.type !== 'ArrayPattern' || !isNamedCall(init, 'crud')) {
    return null;
  }

  const [tableArg] = ((init as unknown as { arguments?: readonly AstNode[] })
    .arguments ?? []) as readonly AstNode[];
  const entityId = deriveStoreTableId(tableArg, namedStoreTableIds);
  const { elements } = id as unknown as { elements?: readonly AstNode[] };
  return entityId && elements ? { elements, entityId } : null;
};

const extractCrudTupleEntry = (
  node: AstNode,
  namedStoreTableIds: ReadonlyMap<string, string>
): {
  readonly entityId: string;
  readonly operations: readonly string[];
} | null => {
  const pattern = extractCrudTuplePattern(node, namedStoreTableIds);
  if (!pattern) {
    return null;
  }

  return {
    entityId: pattern.entityId,
    operations: collectTupleOperations(pattern.elements),
  };
};

const collectCrudTupleCoverage = (
  ast: AstNode,
  sourceCode: string
): ReadonlyMap<string, CrudCoverage> => {
  const coverageByEntityId = new Map<string, CrudCoverage>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);

  walk(ast, (node) => {
    const entry = extractCrudTupleEntry(node, namedStoreTableIds);
    if (!entry) {
      return;
    }

    const coverage = ensureCoverage(
      coverageByEntityId,
      entry.entityId,
      offsetToLine(sourceCode, node.start)
    );

    for (const operation of entry.operations) {
      coverage.operations.add(operation);
    }
  });

  return coverageByEntityId;
};

const collectIncompleteCoverage = (
  coverageByEntityId: ReadonlyMap<string, CrudCoverage>
): readonly CrudCoverage[] =>
  [...coverageByEntityId.values()].filter(
    (coverage) =>
      coverage.operations.size > 0 &&
      coverage.operations.size < CRUD_OPERATIONS.length
  );

const formatEntityLabel = (entityId: string): string =>
  entityId.startsWith(IMPORTED_CONTOUR_PREFIX)
    ? `${entityId.slice(IMPORTED_CONTOUR_PREFIX.length)} (imported, pending-resolution)`
    : entityId;

const buildIncompleteCrudDiagnostic = (
  coverage: CrudCoverage,
  filePath: string
): WardenDiagnostic => {
  const present = CRUD_OPERATIONS.filter((operation) =>
    coverage.operations.has(operation)
  );
  const missing = CRUD_OPERATIONS.filter(
    (operation) => !coverage.operations.has(operation)
  );

  return {
    filePath,
    line: coverage.line,
    message: `Factory coverage for "${formatEntityLabel(coverage.entityId)}" is incomplete: found ${present.join(', ')} but missing ${missing.join(', ')}. Prefer the full CRUD set or document the intentional omission.`,
    rule: 'incomplete-crud',
    severity: 'warn',
  };
};

export const incompleteCrud: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return [
      ...collectIncompleteCoverage(collectDerivedCrudCoverage(ast, sourceCode)),
      ...collectIncompleteCoverage(collectCrudTupleCoverage(ast, sourceCode)),
    ].map((coverage) => buildIncompleteCrudDiagnostic(coverage, filePath));
  },
  description:
    'Warn when factory-style CRUD authoring covers only part of the standard create/read/update/delete/list set. This rule is file-scoped: all operations for an entity must be colocated in the same file for the rule to correctly assess completeness. One-file-per-operation layouts (e.g. deriveTrail in separate create.ts, read.ts, etc.) may produce false positives.',
  name: 'incomplete-crud',
  severity: 'warn',
};
