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

const RULE_NAME = 'no-destructured-compose';

const diagnosticMessage = (trailId: string): string =>
  `Trail "${trailId}" destructures compose from the blaze context. Use ctx.compose(...) directly so composition stays visible and Warden can recognize composed Result values.`;

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

const findComposeBinding = (pattern: AstNode | undefined): AstNode | null => {
  if (pattern?.type !== 'ObjectPattern') {
    return null;
  }

  const properties =
    (pattern as unknown as { properties?: readonly AstNode[] }).properties ??
    [];

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

const blazeParams = (blaze: AstNode): readonly AstNode[] =>
  (blaze as unknown as { params?: readonly AstNode[] }).params ?? [];

const destructuredComposeFromVariableDeclarator = (
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

  return findComposeBinding(id);
};

const destructuredComposeFromAssignment = (
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

  return findComposeBinding(left);
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

      for (const blaze of findBlazeBodies(definition.config)) {
        const params = blazeParams(blaze);
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
    'Coach trail blazes to compose with ctx.compose(...) directly instead of destructuring compose from the context.',
  name: RULE_NAME,
  severity: 'warn',
};
