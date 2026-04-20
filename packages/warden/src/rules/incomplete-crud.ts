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
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const CRUD_OPERATIONS = ['create', 'read', 'update', 'delete', 'list'] as const;
const CRUD_OPERATION_SET = new Set<string>(CRUD_OPERATIONS);

/** Sentinel entity id prefix for contours imported from another module. */
const IMPORTED_CONTOUR_PREFIX = 'imported:';
const CONTOUR_BINDING_SUFFIX = 'Contour';

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

const stripImportedContourPrefix = (entityId: string): string =>
  entityId.startsWith(IMPORTED_CONTOUR_PREFIX)
    ? entityId.slice(IMPORTED_CONTOUR_PREFIX.length)
    : entityId;

const stripContourBindingSuffix = (entityId: string): string =>
  entityId.endsWith(CONTOUR_BINDING_SUFFIX)
    ? entityId.slice(0, -CONTOUR_BINDING_SUFFIX.length)
    : entityId;

const normalizeProjectEntityId = (
  entityId: string,
  projectEntityIds: ReadonlySet<string>
): string => {
  const localId = stripImportedContourPrefix(entityId);
  if (!entityId.startsWith(IMPORTED_CONTOUR_PREFIX)) {
    return localId;
  }

  const strippedId = stripContourBindingSuffix(localId);
  if (
    strippedId !== localId &&
    (projectEntityIds.has(strippedId) ||
      projectEntityIds.has(`${IMPORTED_CONTOUR_PREFIX}${strippedId}`))
  ) {
    return strippedId;
  }
  return localId;
};

const normalizeProjectCoverage = (
  projectCoverage: ReadonlyMap<string, ReadonlySet<string>>,
  projectEntityIds: ReadonlySet<string>
): ReadonlyMap<string, ReadonlySet<string>> => {
  const normalized = new Map<string, Set<string>>();
  for (const [entityId, operations] of projectCoverage) {
    const normalizedId = normalizeProjectEntityId(entityId, projectEntityIds);
    const bucket = normalized.get(normalizedId) ?? new Set<string>();
    for (const operation of operations) {
      bucket.add(operation);
    }
    normalized.set(normalizedId, bucket);
  }
  return normalized;
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

const collectFileCoverage = (
  ast: AstNode,
  sourceCode: string
): {
  readonly derived: ReadonlyMap<string, CrudCoverage>;
  readonly tuple: ReadonlyMap<string, CrudCoverage>;
} => ({
  derived: collectDerivedCrudCoverage(ast, sourceCode),
  tuple: collectCrudTupleCoverage(ast, sourceCode),
});

/**
 * Public AST helper: collect per-entity CRUD operation coverage for a single
 * file. Used by the CLI to aggregate coverage across the project before the
 * rule runs, so one-file-per-operation layouts are evaluated correctly.
 */
export const collectFileCrudCoverage = (
  ast: AstNode,
  sourceCode: string
): ReadonlyMap<string, ReadonlySet<string>> => {
  const { derived, tuple } = collectFileCoverage(ast, sourceCode);
  const merged = new Map<string, Set<string>>();
  const merge = (source: ReadonlyMap<string, CrudCoverage>): void => {
    for (const [entityId, coverage] of source) {
      const bucket = merged.get(entityId) ?? new Set<string>();
      for (const operation of coverage.operations) {
        bucket.add(operation);
      }
      merged.set(entityId, bucket);
    }
  };
  merge(derived);
  merge(tuple);
  return merged;
};

const seedCombinedCoverage = (
  fileCoverage: ReadonlyMap<string, CrudCoverage>
): Map<string, Set<string>> => {
  const combined = new Map<string, Set<string>>();
  for (const [entityId, coverage] of fileCoverage) {
    combined.set(entityId, new Set(coverage.operations));
  }
  return combined;
};

const applyProjectOperations = (
  combined: Map<string, Set<string>>,
  fileCoverage: ReadonlyMap<string, CrudCoverage>,
  projectCoverage: ReadonlyMap<string, ReadonlySet<string>>
): void => {
  const projectEntityIds = new Set(projectCoverage.keys());
  const normalizedProjectCoverage = normalizeProjectCoverage(
    projectCoverage,
    projectEntityIds
  );
  for (const entityId of fileCoverage.keys()) {
    const bucket = combined.get(entityId) ?? new Set<string>();
    const operations = normalizedProjectCoverage.get(
      normalizeProjectEntityId(entityId, projectEntityIds)
    );
    if (operations) {
      for (const operation of operations) {
        bucket.add(operation);
      }
    }
    combined.set(entityId, bucket);
  }
};

const mergeProjectOperations = (
  fileCoverage: ReadonlyMap<string, CrudCoverage>,
  projectCoverage?: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, Set<string>> => {
  const combined = seedCombinedCoverage(fileCoverage);
  if (projectCoverage) {
    applyProjectOperations(combined, fileCoverage, projectCoverage);
  }
  return combined;
};

const collectIncompleteEntities = (
  fileCoverage: ReadonlyMap<string, CrudCoverage>,
  projectCoverage?: ReadonlyMap<string, ReadonlySet<string>>
): readonly CrudCoverage[] => {
  const combinedOperations = mergeProjectOperations(
    fileCoverage,
    projectCoverage
  );

  return [...fileCoverage.values()].flatMap((coverage) => {
    const combined = combinedOperations.get(coverage.entityId);
    if (!combined || combined.size === 0) {
      return [];
    }
    if (combined.size >= CRUD_OPERATIONS.length) {
      return [];
    }
    return [
      {
        entityId: coverage.entityId,
        line: coverage.line,
        operations: combined,
      },
    ];
  });
};

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

const evaluateFile = (
  sourceCode: string,
  filePath: string,
  projectCoverage?: ReadonlyMap<string, ReadonlySet<string>>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  const { derived, tuple } = collectFileCoverage(ast, sourceCode);

  return [
    ...collectIncompleteEntities(derived, projectCoverage),
    ...collectIncompleteEntities(tuple, projectCoverage),
  ].map((coverage) => buildIncompleteCrudDiagnostic(coverage, filePath));
};

/**
 * Warn when factory-style CRUD authoring covers only part of the standard
 * create/read/update/delete/list set.
 *
 * Project-aware: when a `ProjectContext` is available, operations observed in
 * sibling files (e.g. one-file-per-operation layouts such as `create.ts`,
 * `read.ts`, `update.ts`, `delete.ts`, `list.ts`) are merged with the local
 * file's coverage before completeness is evaluated, so split layouts do not
 * produce false positives. The fallback `check` entry point stays file-scoped
 * for direct invocations that lack project context.
 */
export const incompleteCrud: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return evaluateFile(sourceCode, filePath);
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return evaluateFile(sourceCode, filePath, context.crudCoverageByEntity);
  },
  description:
    'Warn when factory-style CRUD authoring covers only part of the standard create/read/update/delete/list set. Coverage is aggregated across the project so one-file-per-operation layouts are evaluated on the full CRUD set.',
  name: 'incomplete-crud',
  severity: 'warn',
};
