import { isDraftId } from '@ontrails/core';

import {
  extractStringOrTemplateLiteral,
  findConfigProperty,
  findTrailDefinitions,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
import { collectTrailIds } from './specs.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

/**
 * Node types that wrap an expression without changing its runtime value.
 * These can legally surround a `detours: [...]` array or a `target: "..."`
 * literal and must be peeled before we inspect the shape.
 */
const TRANSPARENT_WRAPPER_TYPES = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (current && TRANSPARENT_WRAPPER_TYPES.has(current.type)) {
    current = (current as AstNode)['expression'] as AstNode | undefined;
  }
  return current;
};

const getDetourElements = (config: AstNode): readonly (AstNode | null)[] => {
  const detoursProp = findConfigProperty(config, 'detours');
  if (!detoursProp) {
    return [];
  }

  const detoursValue = unwrapExpression(
    detoursProp.value as AstNode | undefined
  );
  if (!detoursValue || detoursValue.type !== 'ArrayExpression') {
    return [];
  }

  const elements = (detoursValue as AstNode)['elements'] as
    | readonly (AstNode | null)[]
    | undefined;
  return elements ?? [];
};

interface TargetRef {
  readonly id: string;
  readonly start: number;
}

const extractDetourTargetId = (node: AstNode | undefined): string | null =>
  extractStringOrTemplateLiteral(node);

const extractObjectTargetRef = (element: AstNode): TargetRef | null => {
  if (element.type !== 'ObjectExpression') {
    return null;
  }
  const targetProp = findConfigProperty(element, 'target');
  const rawTargetNode = targetProp?.value as AstNode | undefined;
  const targetNode = unwrapExpression(rawTargetNode);
  const targetId = extractDetourTargetId(targetNode);
  return targetId !== null && targetNode
    ? { id: targetId, start: targetNode.start }
    : null;
};

const extractDetourElementRef = (element: AstNode | null): TargetRef | null => {
  if (!element) {
    return null;
  }
  const unwrapped = unwrapExpression(element) ?? element;
  // String-literal or backtick-literal detour:
  //   detours: ["entity.fallback"] or detours: [`entity.fallback`]
  const literalId = extractDetourTargetId(unwrapped);
  if (literalId !== null) {
    return { id: literalId, start: unwrapped.start };
  }
  return extractObjectTargetRef(unwrapped);
};

const extractDetourTargets = (config: AstNode): readonly TargetRef[] =>
  getDetourElements(config).flatMap((element) => {
    const ref = extractDetourElementRef(element);
    return ref ? [ref] : [];
  });

const buildDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  for (const definition of findTrailDefinitions(ast)) {
    if (definition.kind !== 'trail') {
      continue;
    }

    for (const ref of extractDetourTargets(definition.config)) {
      if (knownIds.has(ref.id) || isDraftId(ref.id)) {
        continue;
      }

      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, ref.start),
        message: `Trail "${definition.id}" has detour targeting "${ref.id}" which is not defined.`,
        rule: 'valid-detour-refs',
        severity: 'error',
      });
    }
  }

  return diagnostics;
};

const checkDetourRefs = (
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }
  return buildDiagnostics(ast, sourceCode, filePath, knownIds);
};

/**
 * Checks that all trail IDs referenced in `detours` declarations exist.
 */
export const validDetourRefs: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkDetourRefs(sourceCode, filePath, collectTrailIds(sourceCode));
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkDetourRefs(sourceCode, filePath, context.knownTrailIds);
  },
  description: 'Ensure all detour target trail IDs reference defined trails.',
  name: 'valid-detour-refs',
  severity: 'error',
};
