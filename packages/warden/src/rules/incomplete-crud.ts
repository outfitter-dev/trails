import {
  collectNamedContourIds,
  collectNamedStoreTableIds,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const CRUD_OPERATIONS = ['create', 'read', 'update', 'delete', 'list'] as const;
const CRUD_OPERATION_SET = new Set<string>(CRUD_OPERATIONS);

interface CrudCoverage {
  readonly entityId: string;
  readonly line: number;
  readonly operations: Set<string>;
}

const isNamedCall = (node: AstNode | undefined, name: string): boolean =>
  !!node &&
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) === name;

const getMemberExpression = (
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

const getPropertyName = (node: AstNode | undefined): string | null => {
  if (node?.type === 'Identifier') {
    return identifierName(node);
  }

  if (node && isStringLiteral(node)) {
    return getStringValue(node);
  }

  return null;
};

const extractInlineContourId = (node: AstNode | undefined): string | null => {
  if (!isNamedCall(node, 'contour')) {
    return null;
  }

  const [nameArg] = ((node as unknown as { arguments?: readonly AstNode[] })
    .arguments ?? []) as readonly AstNode[];
  return nameArg && isStringLiteral(nameArg) ? getStringValue(nameArg) : null;
};

const resolveContourId = (
  node: AstNode | undefined,
  namedContourIds: ReadonlyMap<string, string>
): string | null => {
  if (!node) {
    return null;
  }

  if (node.type === 'Identifier') {
    const name = identifierName(node);
    return name ? (namedContourIds.get(name) ?? null) : null;
  }

  return extractInlineContourId(node);
};

const extractStoreTableIdFromMember = (
  node: AstNode | undefined
): string | null => {
  const member = getMemberExpression(node);
  const tableId = member ? getPropertyName(member.property) : null;
  const tablesMember = member ? getMemberExpression(member.object) : null;
  if (!tableId || !tablesMember) {
    return null;
  }

  return getPropertyName(tablesMember.property) === 'tables' ? tableId : null;
};

const resolveStoreTableId = (
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

  return extractStoreTableIdFromMember(node);
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
  namedContourIds: ReadonlyMap<string, string>
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
  const entityId = resolveContourId(contourArg, namedContourIds);
  return operation && entityId ? { entityId, operation } : null;
};

const collectDerivedCrudCoverage = (
  ast: AstNode,
  sourceCode: string
): ReadonlyMap<string, CrudCoverage> => {
  const coverageByEntityId = new Map<string, CrudCoverage>();
  const namedContourIds = collectNamedContourIds(ast);

  walk(ast, (node) => {
    const entry = extractDerivedCrudEntry(node, namedContourIds);
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
  const entityId = resolveStoreTableId(tableArg, namedStoreTableIds);
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
    message: `Factory coverage for "${coverage.entityId}" is incomplete: found ${present.join(', ')} but missing ${missing.join(', ')}. Prefer the full CRUD set or document the intentional omission.`,
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
