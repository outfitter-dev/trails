import { isDraftId } from '@ontrails/core';

import {
  collectNamedProvisionIds,
  collectProvisionDefinitionIds,
  extractFirstStringArg,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const isProvisionCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'resource';

const getProvisionElements = (config: AstNode): readonly AstNode[] => {
  const provisionsProp = findConfigProperty(config, 'resources');
  if (!provisionsProp) {
    return [];
  }

  const arrayNode = provisionsProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

const extractDeclaredProvisionId = (
  element: AstNode,
  provisionIdsByName: ReadonlyMap<string, string>
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name ? (provisionIdsByName.get(name) ?? null) : null;
  }

  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  return isProvisionCall(element) ? extractFirstStringArg(element) : null;
};

const extractDeclaredProvisionIds = (
  config: AstNode,
  provisionIdsByName: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getProvisionElements(config).flatMap((element) => {
      const id = extractDeclaredProvisionId(element, provisionIdsByName);
      return id ? [id] : [];
    })
  ),
];

const buildMissingProvisionDiagnostic = (
  trailId: string,
  provisionId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares resource "${provisionId}" which is not defined in the project.`,
  rule: 'resource-exists',
  severity: 'error',
});

const reportMissingProvisions = (
  def: { id: string; config: AstNode; start: number },
  sourceCode: string,
  provisionIdsByName: ReadonlyMap<string, string>,
  filePath: string,
  knownProvisionIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const line = offsetToLine(sourceCode, def.start);
  for (const provisionId of extractDeclaredProvisionIds(
    def.config,
    provisionIdsByName
  )) {
    if (!knownProvisionIds.has(provisionId) && !isDraftId(provisionId)) {
      diagnostics.push(
        buildMissingProvisionDiagnostic(def.id, provisionId, filePath, line)
      );
    }
  }
};

const buildProvisionDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownProvisionIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const provisionIdsByName = collectNamedProvisionIds(ast);
  for (const def of findTrailDefinitions(ast)) {
    reportMissingProvisions(
      def,
      sourceCode,
      provisionIdsByName,
      filePath,
      knownProvisionIds,
      diagnostics
    );
  }
  return diagnostics;
};

const checkProvisionsExist = (
  sourceCode: string,
  filePath: string,
  knownProvisionIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  return buildProvisionDiagnostics(
    ast,
    sourceCode,
    filePath,
    knownProvisionIds
  );
};

/**
 * Checks that all declared resources resolve to known resource definitions.
 */
export const provisionExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return checkProvisionsExist(
      sourceCode,
      filePath,
      collectProvisionDefinitionIds(ast)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localProvisionIds = ast
      ? collectProvisionDefinitionIds(ast)
      : new Set<string>();
    return checkProvisionsExist(
      sourceCode,
      filePath,
      context.knownProvisionIds ?? localProvisionIds
    );
  },
  description:
    'Ensure every resource declared on a trail resolves to a known resource definition.',
  name: 'resource-exists',
  severity: 'error',
};
