import { isDraftId } from '@ontrails/core';

import {
  collectNamedResourceIds,
  collectResourceDefinitionIds,
} from './source/resources.js';
import {
  extractFirstStringArg,
  findConfigProperty,
  getStringValue,
  identifierName,
  isStringLiteral,
} from '../source/literals.js';
import { offsetToLine } from '../source/locations.js';
import { getNodeCallee } from '../source/nodes.js';
import { parse } from '../source/parse.js';
import { findTrailDefinitions } from '../source/trails.js';
import type { AstNode } from '../source/nodes.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const isResourceCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName(getNodeCallee(node)) === 'resource';

const getResourceElements = (config: AstNode): readonly AstNode[] => {
  const resourcesProp = findConfigProperty(config, 'resources');
  if (!resourcesProp) {
    return [];
  }

  const arrayNode = resourcesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

const extractDeclaredResourceId = (
  element: AstNode,
  resourceIdsByName: ReadonlyMap<string, string>
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name ? (resourceIdsByName.get(name) ?? null) : null;
  }

  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  return isResourceCall(element) ? extractFirstStringArg(element) : null;
};

const extractDeclaredResourceIds = (
  config: AstNode,
  resourceIdsByName: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getResourceElements(config).flatMap((element) => {
      const id = extractDeclaredResourceId(element, resourceIdsByName);
      return id ? [id] : [];
    })
  ),
];

const buildMissingResourceDiagnostic = (
  trailId: string,
  resourceId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares resource "${resourceId}" which is not defined in the project. Define it with resource('${resourceId}', ...) and ensure that definition is included in the topo.`,
  rule: 'resource-exists',
  severity: 'error',
});

const reportMissingResources = (
  def: { id: string; config: AstNode; start: number },
  sourceCode: string,
  resourceIdsByName: ReadonlyMap<string, string>,
  filePath: string,
  knownResourceIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const line = offsetToLine(sourceCode, def.start);
  for (const resourceId of extractDeclaredResourceIds(
    def.config,
    resourceIdsByName
  )) {
    if (!knownResourceIds.has(resourceId) && !isDraftId(resourceId)) {
      diagnostics.push(
        buildMissingResourceDiagnostic(def.id, resourceId, filePath, line)
      );
    }
  }
};

const buildResourceDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownResourceIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const resourceIdsByName = collectNamedResourceIds(ast);
  for (const def of findTrailDefinitions(ast)) {
    reportMissingResources(
      def,
      sourceCode,
      resourceIdsByName,
      filePath,
      knownResourceIds,
      diagnostics
    );
  }
  return diagnostics;
};

const checkResourcesExist = (
  sourceCode: string,
  filePath: string,
  knownResourceIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  return buildResourceDiagnostics(ast, sourceCode, filePath, knownResourceIds);
};

/**
 * Checks that all declared resources resolve to known resource definitions.
 */
export const resourceExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return checkResourcesExist(
      sourceCode,
      filePath,
      collectResourceDefinitionIds(ast)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localResourceIds = ast
      ? collectResourceDefinitionIds(ast)
      : new Set<string>();
    return checkResourcesExist(
      sourceCode,
      filePath,
      context.knownResourceIds ?? localResourceIds
    );
  },
  description:
    'Ensure every resource declared on a trail resolves to a known resource definition.',
  name: 'resource-exists',
  severity: 'error',
};
