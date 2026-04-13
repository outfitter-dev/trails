/**
 * Validates that registered transport error mappers cover every error category.
 *
 * Scans `createTransportErrorMapper(...)` calls and resolves simple object
 * literals, identifier bindings, and object-property references in the same
 * file so incomplete mapper registrations are caught before they ship.
 */

import { errorCategories } from '@ontrails/core';

import {
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

const MEMBER_EXPRESSION_TYPES = new Set([
  'MemberExpression',
  'StaticMemberExpression',
]);

const getPropertyName = (node: AstNode | undefined): string | null => {
  if (!node) {
    return null;
  }

  return (
    identifierName(node) ??
    (isStringLiteral(node) ? getStringValue(node) : null)
  );
};

const collectObjectBindings = (ast: AstNode): ReadonlyMap<string, AstNode> => {
  const bindings = new Map<string, AstNode>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as { id?: AstNode; init?: AstNode };
    const bindingName = identifierName(id);

    if (bindingName && init?.type === 'ObjectExpression') {
      bindings.set(bindingName, init);
    }
  });

  return bindings;
};

const getObjectProperties = (objectNode: AstNode): readonly AstNode[] =>
  objectNode.type === 'ObjectExpression'
    ? ((objectNode['properties'] as readonly AstNode[] | undefined) ?? [])
    : [];

const findObjectPropertyValue = (
  objectNode: AstNode,
  propertyName: string
): AstNode | null => {
  for (const property of getObjectProperties(objectNode)) {
    if (property.type !== 'Property') {
      continue;
    }

    const key = getPropertyName((property as unknown as { key?: AstNode }).key);
    if (key === propertyName) {
      return (property as unknown as { value?: AstNode }).value ?? null;
    }
  }

  return null;
};

const resolveIdentifierObject = (
  node: AstNode,
  bindings: ReadonlyMap<string, AstNode>
): AstNode | null =>
  bindings.get((node as { name?: string }).name ?? '') ?? null;

const resolveMemberObject = (
  node: AstNode,
  bindings: ReadonlyMap<string, AstNode>,
  depth: number,
  resolve: (
    node: AstNode | undefined,
    bindings: ReadonlyMap<string, AstNode>,
    depth?: number
  ) => AstNode | null
): AstNode | null => {
  const { object, property } = node as { object?: AstNode; property?: AstNode };
  const propertyName = getPropertyName(property);
  if (!propertyName) {
    return null;
  }

  const objectNode = resolve(object, bindings, depth + 1);
  return objectNode
    ? resolve(
        findObjectPropertyValue(objectNode, propertyName) ?? undefined,
        bindings,
        depth + 1
      )
    : null;
};

const resolveObjectExpression = function resolveObjectExpression(
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, AstNode>,
  depth = 0
): AstNode | null {
  if (!node || depth > 4) {
    return null;
  }

  if (node.type === 'ObjectExpression') {
    return node;
  }

  if (node.type === 'Identifier') {
    return resolveIdentifierObject(node, bindings);
  }

  return MEMBER_EXPRESSION_TYPES.has(node.type)
    ? resolveMemberObject(node, bindings, depth, resolveObjectExpression)
    : null;
};

const addMappedCategory = (
  categories: Set<string>,
  property: AstNode
): boolean => {
  if (property.type === 'SpreadElement') {
    return false;
  }

  if (property.type !== 'Property') {
    return true;
  }

  const key = getPropertyName((property as unknown as { key?: AstNode }).key);
  if (key) {
    categories.add(key);
  }

  return true;
};

const collectMappedCategories = (
  mapperObject: AstNode
): ReadonlySet<string> | null => {
  if (mapperObject.type !== 'ObjectExpression') {
    return null;
  }

  const categories = new Set<string>();
  for (const property of getObjectProperties(mapperObject)) {
    if (!addMappedCategory(categories, property)) {
      return null;
    }
  }

  return categories;
};

const createDiagnostic = (
  filePath: string,
  line: number,
  missingCategories: readonly string[]
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Transport error mapper is missing mappings for: ${missingCategories.join(', ')}. Registered createTransportErrorMapper() calls must cover every ErrorCategory.`,
  rule: 'error-mapping-completeness',
  severity: 'error',
});

const getCallArgs = (node: AstNode): readonly AstNode[] =>
  (node as { arguments?: readonly AstNode[] }).arguments ?? [];

const getCallCallee = (node: AstNode): AstNode | undefined =>
  (node as { callee?: AstNode }).callee;

const isMapperFactoryCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName(getCallCallee(node)) === 'createTransportErrorMapper';

const findMissingCategories = (
  mappedCategories: ReadonlySet<string>
): readonly string[] =>
  errorCategories.filter((category) => !mappedCategories.has(category));

const resolveMappedCategories = (
  node: AstNode,
  bindings: ReadonlyMap<string, AstNode>
): ReadonlySet<string> | null => {
  const [firstArg] = getCallArgs(node);
  const mapperObject = resolveObjectExpression(firstArg, bindings);
  return mapperObject ? collectMappedCategories(mapperObject) : null;
};

const inspectMapperCall = (
  node: AstNode,
  bindings: ReadonlyMap<string, AstNode>,
  filePath: string,
  sourceCode: string
): WardenDiagnostic | null => {
  if (!isMapperFactoryCall(node)) {
    return null;
  }

  const mappedCategories = resolveMappedCategories(node, bindings);
  if (!mappedCategories) {
    return null;
  }

  const missingCategories = findMissingCategories(mappedCategories);
  if (missingCategories.length === 0) {
    return null;
  }

  return createDiagnostic(
    filePath,
    offsetToLine(sourceCode, node.start),
    missingCategories
  );
};

/**
 * Flags `createTransportErrorMapper()` registrations that omit error categories.
 */
export const errorMappingCompleteness: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (
      isTestFile(filePath) ||
      !sourceCode.includes('createTransportErrorMapper')
    ) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const bindings = collectObjectBindings(ast);
    const diagnostics: WardenDiagnostic[] = [];

    walk(ast, (node) => {
      const diagnostic = inspectMapperCall(
        node,
        bindings,
        filePath,
        sourceCode
      );
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    });

    return diagnostics;
  },
  description:
    'Require registered transport error mappers to cover every ErrorCategory.',
  name: 'error-mapping-completeness',
  severity: 'error',
};
