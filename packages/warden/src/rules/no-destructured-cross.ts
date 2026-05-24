import {
  findBlazeBodies,
  findTrailDefinitions,
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

const RULE_NAME = 'no-destructured-cross';

const diagnosticMessage = (trailId: string): string =>
  `Trail "${trailId}" destructures cross from the blaze context. Use ctx.cross(...) directly so composition stays visible and Warden can recognize composed Result values.`;

const propertyKeyName = (property: AstNode): string | null => {
  if ((property as unknown as { computed?: boolean }).computed === true) {
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

const findCrossBinding = (pattern: AstNode | undefined): AstNode | null => {
  if (pattern?.type !== 'ObjectPattern') {
    return null;
  }

  const properties =
    (pattern as unknown as { properties?: readonly AstNode[] }).properties ??
    [];

  for (const property of properties) {
    if (property.type === 'Property' && propertyKeyName(property) === 'cross') {
      return property;
    }
  }

  return null;
};

const blazeParams = (blaze: AstNode): readonly AstNode[] =>
  (blaze as unknown as { params?: readonly AstNode[] }).params ?? [];

const destructuredCrossFromVariableDeclarator = (
  node: AstNode,
  contextName: string
): AstNode | null => {
  if (node.type !== 'VariableDeclarator') {
    return null;
  }

  const { id, init } = node as unknown as {
    readonly id?: AstNode;
    readonly init?: AstNode;
  };

  if (identifierName(init) !== contextName) {
    return null;
  }

  return findCrossBinding(id);
};

const destructuredCrossFromAssignment = (
  node: AstNode,
  contextName: string
): AstNode | null => {
  if (node.type !== 'AssignmentExpression') {
    return null;
  }

  const { left, operator, right } = node as unknown as {
    readonly left?: AstNode;
    readonly operator?: string;
    readonly right?: AstNode;
  };

  if (operator !== '=' || identifierName(right) !== contextName) {
    return null;
  }

  return findCrossBinding(left);
};

const checkBodyDestructuring = (
  sourceCode: string,
  filePath: string,
  trailId: string,
  blaze: AstNode,
  contextName: string
): WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  walkWithScopes(
    blaze,
    (node, scopes) => {
      if (isShadowed(contextName, scopes)) {
        return;
      }

      const crossBinding =
        destructuredCrossFromVariableDeclarator(node, contextName) ??
        destructuredCrossFromAssignment(node, contextName);
      if (!crossBinding) {
        return;
      }

      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, crossBinding.start),
        message: diagnosticMessage(trailId),
        rule: RULE_NAME,
        severity: 'warn',
      });
    },
    { stopAtNestedFunctions: true }
  );

  return diagnostics;
};

export const noDestructuredCross: WardenRule = {
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

      for (const blaze of findBlazeBodies(definition.config)) {
        const params = blazeParams(blaze);
        const [, contextParam] = params;
        const paramCrossBinding = findCrossBinding(contextParam);

        if (paramCrossBinding) {
          diagnostics.push({
            filePath,
            line: offsetToLine(sourceCode, paramCrossBinding.start),
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
              blaze,
              contextName
            )
          );
        }
      }
    }

    return diagnostics;
  },
  description:
    'Coach trail blazes to compose with ctx.cross(...) directly instead of destructuring cross from the context.',
  name: RULE_NAME,
  severity: 'warn',
};
