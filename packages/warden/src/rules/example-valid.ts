import { entity } from '@ontrails/core';
import { z } from 'zod';

import {
  extractStringLiteral,
  findConfigProperty,
  getStringValue,
  identifierName,
} from '../source/literals.js';
import { offsetToLine } from '../source/locations.js';
import {
  getNodeExpression,
  getNodeObject,
  getNodeProperty,
} from '../source/nodes.js';
import { parse } from '../source/parse.js';
import { findEntityDefinitions } from '../source/trails.js';
import type { AstNode } from '../source/nodes.js';
import type { EntityDefinition } from '../source/trails.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

class UnsupportedEntityEvaluationError extends Error {}

type EntityEvaluationEnvironment = ReadonlyMap<string, unknown>;

const buildInvalidExampleDiagnostic = (
  entityName: string,
  message: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Entity "${entityName}" has invalid examples: ${message}`,
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
    throw new UnsupportedEntityEvaluationError(
      'Missing node in entity evaluation.'
    );
  }

  return node;
};

type EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
) => unknown;

// The evaluator table is declared before `evaluateNode` so the recursive
// dispatch can read it at call time without any forward references. Entries
// are registered below once each per-type evaluator is defined.
const entityNodeEvaluators = new Map<string, EntityNodeEvaluator>();

const evaluateNode: EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
): unknown => {
  const evaluator = entityNodeEvaluators.get(node.type);
  if (evaluator) {
    return evaluator(node, env);
  }

  throw new UnsupportedEntityEvaluationError(
    `Unsupported AST node "${node.type}" in entity evaluation.`
  );
};

const evaluateArrayExpression: EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
): readonly unknown[] => {
  const elements = node['elements'] as readonly AstNode[] | undefined;
  return (elements ?? []).map((element) => evaluateNode(element, env));
};

const evaluateLiteralExpression: EntityNodeEvaluator = (
  node: AstNode
): unknown => getStringValue(node) ?? node.value;

const evaluateIdentifierExpression: EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
): unknown => {
  const name = identifierName(node);
  if (name === 'undefined') {
    return undefined;
  }

  if (name === 'z') {
    return z;
  }

  if (!name || !env.has(name)) {
    throw new UnsupportedEntityEvaluationError(
      `Unknown identifier "${name ?? '<unknown>'}" in entity evaluation.`
    );
  }

  return env.get(name);
};

const evaluateWrappedExpression: EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
): unknown => evaluateNode(requireNode(getNodeExpression(node)), env);

const evaluateNullExpression: EntityNodeEvaluator = (): null => null;

const evaluateObjectExpression: EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
): Record<string, unknown> => {
  const properties = node['properties'] as readonly AstNode[] | undefined;
  const value: Record<string, unknown> = {};

  for (const property of properties ?? []) {
    if (property.type !== 'Property') {
      throw new UnsupportedEntityEvaluationError(
        `Unsupported object property type "${property.type}".`
      );
    }

    const propertyName = getPropertyName(property.key);
    if (!propertyName) {
      throw new UnsupportedEntityEvaluationError(
        'Unsupported object property key in entity evaluation.'
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
  env: EntityEvaluationEnvironment
): readonly unknown[] =>
  ((node['arguments'] as readonly AstNode[] | undefined) ?? []).map((arg) =>
    evaluateNode(arg, env)
  );

const resolveEntityFallbackOptions = (
  shape: unknown
): Parameters<typeof entity>[2] | null =>
  typeof shape === 'object' &&
  shape !== null &&
  Object.hasOwn(shape, 'id') &&
  (shape as z.ZodRawShape)['id'] !== undefined
    ? ({ identity: 'id' } as Parameters<typeof entity>[2])
    : null;

const resolveEntityOptions = (
  shape: unknown,
  options: unknown
): Parameters<typeof entity>[2] => {
  if (options === undefined) {
    const fallbackOptions = resolveEntityFallbackOptions(shape);
    if (fallbackOptions !== null) {
      return fallbackOptions;
    }

    throw new UnsupportedEntityEvaluationError(
      'Entity evaluator requires literal options, or an `id` field when options are omitted.'
    );
  }

  if (typeof options !== 'object' || options === null) {
    throw new UnsupportedEntityEvaluationError(
      'Entity evaluator requires literal options when provided.'
    );
  }

  return options as Parameters<typeof entity>[2];
};

const evaluateEntityCall = (args: readonly unknown[]): unknown => {
  const [name, shape, options] = args;
  if (typeof name !== 'string') {
    throw new UnsupportedEntityEvaluationError(
      'Entity evaluator requires a literal name.'
    );
  }

  return entity(
    name,
    shape as z.ZodRawShape,
    resolveEntityOptions(shape, options)
  );
};

const evaluateMemberCall = (
  callee: AstNode,
  args: readonly unknown[],
  env: EntityEvaluationEnvironment
): unknown => {
  const receiver = evaluateNode(requireNode(getNodeObject(callee)), env);
  const propertyName = getPropertyName(getNodeProperty(callee));
  if (!propertyName) {
    throw new UnsupportedEntityEvaluationError(
      'Unsupported member property in entity evaluation.'
    );
  }

  const method = (receiver as Record<string, unknown>)[propertyName];
  if (typeof method !== 'function') {
    throw new UnsupportedEntityEvaluationError(
      `Entity evaluator could not call "${propertyName}".`
    );
  }

  return Reflect.apply(method, receiver, args);
};

const evaluateCallExpression: EntityNodeEvaluator = (
  node: AstNode,
  env: EntityEvaluationEnvironment
): unknown => {
  const args = evaluateCallArguments(node, env);
  const callee = requireNode(node['callee'] as AstNode | undefined);

  if (callee.type === 'Identifier') {
    const calleeName = identifierName(callee);
    if (calleeName !== 'entity') {
      throw new UnsupportedEntityEvaluationError(
        `Unsupported entity evaluator call "${calleeName ?? '<unknown>'}".`
      );
    }

    return evaluateEntityCall(args);
  }

  if (
    callee.type !== 'MemberExpression' &&
    callee.type !== 'StaticMemberExpression'
  ) {
    throw new UnsupportedEntityEvaluationError(
      `Unsupported callee type "${callee.type}".`
    );
  }

  return evaluateMemberCall(callee, args, env);
};

const EVALUATOR_REGISTRATIONS: readonly (readonly [
  string,
  EntityNodeEvaluator,
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
  entityNodeEvaluators.set(type, evaluator);
}

const hasExamples = (definition: EntityDefinition): boolean =>
  definition.options !== null &&
  findConfigProperty(definition.options, 'examples') !== null;

const evaluateEntityDefinition = (
  definition: EntityDefinition,
  env: EntityEvaluationEnvironment
): unknown => evaluateNode(definition.call, env);

const buildEntityExampleErrorDiagnostic = (
  definition: EntityDefinition,
  error: unknown,
  sourceCode: string,
  filePath: string
): WardenDiagnostic | null => {
  if (
    error instanceof UnsupportedEntityEvaluationError ||
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

const evaluateEntityExamples = (
  definition: EntityDefinition,
  env: Map<string, unknown>,
  sourceCode: string,
  filePath: string
): WardenDiagnostic | null => {
  try {
    const value = evaluateEntityDefinition(definition, env);
    if (definition.bindingName) {
      env.set(definition.bindingName, value);
    }

    return null;
  } catch (error) {
    return buildEntityExampleErrorDiagnostic(
      definition,
      error,
      sourceCode,
      filePath
    );
  }
};

const collectEntityExampleDiagnostics = (
  definitions: readonly EntityDefinition[],
  sourceCode: string,
  filePath: string
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const env = new Map<string, unknown>();

  for (const definition of definitions) {
    const diagnostic = evaluateEntityExamples(
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

const checkEntityExamples = (
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

  return collectEntityExampleDiagnostics(
    findEntityDefinitions(ast),
    sourceCode,
    filePath
  );
};

/**
 * Checks that entity examples validate against their schema.
 */
export const exampleValid: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkEntityExamples(sourceCode, filePath);
  },
  description:
    'Ensure every entity example validates against the declared entity schema.',
  name: 'example-valid',
  severity: 'error',
};
