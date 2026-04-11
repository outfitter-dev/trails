import { contour } from '@ontrails/core';
import { z } from 'zod';

import {
  extractStringLiteral,
  findConfigProperty,
  findContourDefinitions,
  getStringValue,
  identifierName,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode, ContourDefinition } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

class UnsupportedContourEvaluationError extends Error {}

type ContourEvaluationEnvironment = ReadonlyMap<string, unknown>;

const buildInvalidExampleDiagnostic = (
  contourName: string,
  message: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Contour "${contourName}" has invalid examples: ${message}`,
  rule: 'example-valid',
  severity: 'error',
});

const getPropertyName = (node: unknown): string | null => {
  if (typeof node !== 'object' || node === null) {
    return null;
  }

  const { name } = node as { readonly name?: unknown };
  if (typeof name === 'string') {
    return name;
  }

  return extractStringLiteral(node as AstNode);
};

const requireNode = (node: AstNode | undefined): AstNode => {
  if (!node) {
    throw new UnsupportedContourEvaluationError(
      'Missing node in contour evaluation.'
    );
  }

  return node;
};

type ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
) => unknown;

// The evaluator table is declared before `evaluateNode` so the recursive
// dispatch can read it at call time without any forward references. Entries
// are registered below once each per-type evaluator is defined.
const contourNodeEvaluators = new Map<string, ContourNodeEvaluator>();

const evaluateNode: ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): unknown => {
  const evaluator = contourNodeEvaluators.get(node.type);
  if (evaluator) {
    return evaluator(node, env);
  }

  throw new UnsupportedContourEvaluationError(
    `Unsupported AST node "${node.type}" in contour evaluation.`
  );
};

const evaluateArrayExpression: ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): readonly unknown[] => {
  const elements = node['elements'] as readonly AstNode[] | undefined;
  return (elements ?? []).map((element) => evaluateNode(element, env));
};

const evaluateLiteralExpression: ContourNodeEvaluator = (
  node: AstNode
): unknown => getStringValue(node) ?? node.value;

const evaluateIdentifierExpression: ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): unknown => {
  const name = identifierName(node);
  if (name === 'undefined') {
    return undefined;
  }

  if (name === 'z') {
    return z;
  }

  if (!name || !env.has(name)) {
    throw new UnsupportedContourEvaluationError(
      `Unknown identifier "${name ?? '<unknown>'}" in contour evaluation.`
    );
  }

  return env.get(name);
};

const evaluateWrappedExpression: ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): unknown =>
  evaluateNode(
    requireNode((node as unknown as { expression?: AstNode }).expression),
    env
  );

const evaluateNullExpression: ContourNodeEvaluator = (): null => null;

const evaluateObjectExpression: ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): Record<string, unknown> => {
  const properties = node['properties'] as readonly AstNode[] | undefined;
  const value: Record<string, unknown> = {};

  for (const property of properties ?? []) {
    if (property.type !== 'Property') {
      throw new UnsupportedContourEvaluationError(
        `Unsupported object property type "${property.type}".`
      );
    }

    const propertyName = getPropertyName(property.key);
    if (!propertyName) {
      throw new UnsupportedContourEvaluationError(
        'Unsupported object property key in contour evaluation.'
      );
    }

    value[propertyName] = evaluateNode(
      requireNode(property.value as AstNode | undefined),
      env
    );
  }

  return value;
};

const evaluateCallArguments = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): readonly unknown[] =>
  ((node['arguments'] as readonly AstNode[] | undefined) ?? []).map((arg) =>
    evaluateNode(arg, env)
  );

const resolveContourFallbackOptions = (
  shape: unknown
): Parameters<typeof contour>[2] | null =>
  typeof shape === 'object' &&
  shape !== null &&
  Object.hasOwn(shape, 'id') &&
  (shape as z.ZodRawShape)['id'] !== undefined
    ? ({ identity: 'id' } as Parameters<typeof contour>[2])
    : null;

const resolveContourOptions = (
  shape: unknown,
  options: unknown
): Parameters<typeof contour>[2] => {
  if (options === undefined) {
    const fallbackOptions = resolveContourFallbackOptions(shape);
    if (fallbackOptions !== null) {
      return fallbackOptions;
    }

    throw new UnsupportedContourEvaluationError(
      'Contour evaluator requires literal options, or an `id` field when options are omitted.'
    );
  }

  if (typeof options !== 'object' || options === null) {
    throw new UnsupportedContourEvaluationError(
      'Contour evaluator requires literal options when provided.'
    );
  }

  return options as Parameters<typeof contour>[2];
};

const evaluateContourCall = (args: readonly unknown[]): unknown => {
  const [name, shape, options] = args;
  if (typeof name !== 'string') {
    throw new UnsupportedContourEvaluationError(
      'Contour evaluator requires a literal name.'
    );
  }

  return contour(
    name,
    shape as z.ZodRawShape,
    resolveContourOptions(shape, options)
  );
};

const evaluateMemberCall = (
  callee: AstNode,
  args: readonly unknown[],
  env: ContourEvaluationEnvironment
): unknown => {
  const receiver = evaluateNode(
    requireNode((callee as unknown as { object?: AstNode }).object),
    env
  );
  const propertyName = getPropertyName(
    (callee as unknown as { property?: AstNode }).property
  );
  if (!propertyName) {
    throw new UnsupportedContourEvaluationError(
      'Unsupported member property in contour evaluation.'
    );
  }

  const method = (receiver as Record<string, unknown>)[propertyName];
  if (typeof method !== 'function') {
    throw new UnsupportedContourEvaluationError(
      `Contour evaluator could not call "${propertyName}".`
    );
  }

  return Reflect.apply(method, receiver, args);
};

const evaluateCallExpression: ContourNodeEvaluator = (
  node: AstNode,
  env: ContourEvaluationEnvironment
): unknown => {
  const args = evaluateCallArguments(node, env);
  const callee = requireNode(node['callee'] as AstNode | undefined);

  if (callee.type === 'Identifier') {
    const calleeName = identifierName(callee);
    if (calleeName !== 'contour') {
      throw new UnsupportedContourEvaluationError(
        `Unsupported contour evaluator call "${calleeName ?? '<unknown>'}".`
      );
    }

    return evaluateContourCall(args);
  }

  if (
    callee.type !== 'MemberExpression' &&
    callee.type !== 'StaticMemberExpression'
  ) {
    throw new UnsupportedContourEvaluationError(
      `Unsupported callee type "${callee.type}".`
    );
  }

  return evaluateMemberCall(callee, args, env);
};

const EVALUATOR_REGISTRATIONS: readonly (readonly [
  string,
  ContourNodeEvaluator,
])[] = [
  ['ArrayExpression', evaluateArrayExpression],
  ['BooleanLiteral', evaluateLiteralExpression],
  ['Literal', evaluateLiteralExpression],
  ['NumericLiteral', evaluateLiteralExpression],
  ['StringLiteral', evaluateLiteralExpression],
  ['CallExpression', evaluateCallExpression],
  ['Identifier', evaluateIdentifierExpression],
  ['NullLiteral', evaluateNullExpression],
  ['ObjectExpression', evaluateObjectExpression],
  ['ParenthesizedExpression', evaluateWrappedExpression],
  ['TSAsExpression', evaluateWrappedExpression],
  ['TSSatisfiesExpression', evaluateWrappedExpression],
];

for (const [type, evaluator] of EVALUATOR_REGISTRATIONS) {
  contourNodeEvaluators.set(type, evaluator);
}

const hasExamples = (definition: ContourDefinition): boolean =>
  definition.options !== null &&
  findConfigProperty(definition.options, 'examples') !== null;

const evaluateContourDefinition = (
  definition: ContourDefinition,
  env: ContourEvaluationEnvironment
): unknown => evaluateNode(definition.call, env);

const buildContourExampleErrorDiagnostic = (
  definition: ContourDefinition,
  error: unknown,
  sourceCode: string,
  filePath: string
): WardenDiagnostic | null => {
  if (
    error instanceof UnsupportedContourEvaluationError ||
    !hasExamples(definition) ||
    !(error instanceof Error)
  ) {
    return null;
  }

  return buildInvalidExampleDiagnostic(
    definition.name,
    error.message,
    filePath,
    offsetToLine(sourceCode, definition.start)
  );
};

const evaluateContourExamples = (
  definition: ContourDefinition,
  env: Map<string, unknown>,
  sourceCode: string,
  filePath: string
): WardenDiagnostic | null => {
  try {
    const value = evaluateContourDefinition(definition, env);
    if (definition.bindingName) {
      env.set(definition.bindingName, value);
    }

    return null;
  } catch (error) {
    return buildContourExampleErrorDiagnostic(
      definition,
      error,
      sourceCode,
      filePath
    );
  }
};

const collectContourExampleDiagnostics = (
  definitions: readonly ContourDefinition[],
  sourceCode: string,
  filePath: string
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const env = new Map<string, unknown>();

  for (const definition of definitions) {
    const diagnostic = evaluateContourExamples(
      definition,
      env,
      sourceCode,
      filePath
    );
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
};

const checkContourExamples = (
  sourceCode: string,
  filePath: string
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  return collectContourExampleDiagnostics(
    findContourDefinitions(ast),
    sourceCode,
    filePath
  );
};

/**
 * Checks that contour examples validate against their schema.
 */
export const exampleValid: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkContourExamples(sourceCode, filePath);
  },
  description:
    'Ensure every contour example validates against the declared contour schema.',
  name: 'example-valid',
  severity: 'error',
};
