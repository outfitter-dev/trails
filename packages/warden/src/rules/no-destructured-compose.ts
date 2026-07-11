import {
  findImplementationBodies,
  findTrailDefinitions,
  getNodeComputed,
  getNodeId,
  getNodeInit,
  getNodeLeft,
  getNodeOperator,
  getNodeParams,
  getNodeProperties,
  getNodeRight,
  getStringValue,
  identifierName,
  isShadowed,
  isStringLiteral,
  offsetToLine,
  parse,
  walkWithScopes,
} from './ast.js';
import { isFrameworkInternalFile, isTestFile } from './scan.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'no-destructured-compose';

const diagnosticMessage = (trailId: string): string =>
  `Trail "${trailId}" destructures compose from the implementation context. Use ctx.compose(...) directly so composition stays visible and Warden can recognize composed Result values.`;

const propertyKeyName = (property: AstNode): string | null => {
  if (getNodeComputed(property) === true) {
    return null;
  }

  const key = property.key as AstNode | undefined;
  if (!key) {
    return null;
  }

  return (
    identifierName(key) ?? (isStringLiteral(key) ? getStringValue(key) : null)
  );
};

const findComposeBinding = (pattern: AstNode | undefined): AstNode | null => {
  if (pattern?.type !== 'ObjectPattern') {
    return null;
  }

  const properties = getNodeProperties(pattern) ?? [];

  for (const property of properties) {
    if (
      property.type === 'Property' &&
      propertyKeyName(property) === 'compose'
    ) {
      return property;
    }
  }

  return null;
};

const implementationParams = (implementation: AstNode): readonly AstNode[] =>
  getNodeParams(implementation) ?? [];

const destructuredComposeFromVariableDeclarator = (
  node: AstNode,
  contextName: string
): AstNode | null => {
  if (node.type !== 'VariableDeclarator') {
    return null;
  }

  const id = getNodeId(node);
  const init = getNodeInit(node);

  if (identifierName(init) !== contextName) {
    return null;
  }

  return findComposeBinding(id);
};

const destructuredComposeFromAssignment = (
  node: AstNode,
  contextName: string
): AstNode | null => {
  if (node.type !== 'AssignmentExpression') {
    return null;
  }

  const left = getNodeLeft(node);
  const operator = getNodeOperator(node);
  const right = getNodeRight(node);

  if (operator !== '=' || identifierName(right) !== contextName) {
    return null;
  }

  return findComposeBinding(left);
};

const checkBodyDestructuring = (
  sourceCode: string,
  filePath: string,
  trailId: string,
  implementation: AstNode,
  contextName: string
): WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  walkWithScopes(
    implementation,
    (node, scopes) => {
      if (isShadowed(contextName, scopes)) {
        return;
      }

      const composeBinding =
        destructuredComposeFromVariableDeclarator(node, contextName) ??
        destructuredComposeFromAssignment(node, contextName);
      if (!composeBinding) {
        return;
      }

      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, composeBinding.start),
        message: diagnosticMessage(trailId),
        rule: RULE_NAME,
        severity: 'warn',
      });
    },
    { stopAtNestedFunctions: true }
  );

  return diagnostics;
};

export const noDestructuredCompose: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath) || isFrameworkInternalFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    for (const definition of findTrailDefinitions(ast)) {
      if (definition.kind !== 'trail') {
        continue;
      }

      for (const implementation of findImplementationBodies(
        definition.config
      )) {
        const params = implementationParams(implementation);
        const [, contextParam] = params;
        const paramComposeBinding = findComposeBinding(contextParam);

        if (paramComposeBinding) {
          diagnostics.push({
            filePath,
            line: offsetToLine(sourceCode, paramComposeBinding.start),
            message: diagnosticMessage(definition.id),
            rule: RULE_NAME,
            severity: 'warn',
          });
        }

        const contextName = identifierName(contextParam);
        if (contextName) {
          diagnostics.push(
            ...checkBodyDestructuring(
              sourceCode,
              filePath,
              definition.id,
              implementation,
              contextName
            )
          );
        }
      }
    }

    return diagnostics;
  },
  description:
    'Coach trail implementations to compose with ctx.compose(...) directly instead of destructuring compose from the context.',
  name: RULE_NAME,
  severity: 'warn',
};
