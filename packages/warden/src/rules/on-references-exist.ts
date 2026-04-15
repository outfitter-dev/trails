/**
 * Validates that every signal id declared in a trail's `on:` array resolves
 * to a known signal definition somewhere in the project.
 *
 * Mirrors `resource-exists` structurally — collects local signal definitions
 * for the standalone `check()` path and accepts a project-wide
 * `knownSignalIds` set via `checkWithContext()`.
 */

import { isDraftId } from '@ontrails/core';

import {
  collectSignalDefinitionIds,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
  deriveConstString,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

// ---------------------------------------------------------------------------
// Declared `on:` extraction
// ---------------------------------------------------------------------------

const getOnElements = (config: AstNode): readonly AstNode[] => {
  const onProp = findConfigProperty(config, 'on');
  if (!onProp) {
    return [];
  }

  const arrayNode = onProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/**
 * Resolve an `on:` array element to a signal id when possible.
 *
 * Handles string literals and `const NAME = 'id'` identifier references.
 * Object-form entries (e.g. `on: [someSignal]` where `someSignal` is a
 * `Signal` value) cannot be statically resolved here and are skipped — the
 * runtime normalizes them inside `trail()`, so skipping is safe. The tradeoff
 * is that typo'd Signal imports won't be caught at lint time; the TypeScript
 * compiler catches those instead.
 */
const extractOnElementId = (
  element: AstNode,
  sourceCode: string
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name ? deriveConstString(name, sourceCode) : null;
  }

  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  return null;
};

const extractDeclaredOnIds = (
  config: AstNode,
  sourceCode: string
): readonly string[] => [
  ...new Set(
    getOnElements(config).flatMap((element) => {
      const id = extractOnElementId(element, sourceCode);
      return id ? [id] : [];
    })
  ),
];

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const buildMissingSignalDiagnostic = (
  trailId: string,
  signalId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares on: "${signalId}" which is not a known signal in the project.`,
  rule: 'on-references-exist',
  severity: 'error',
});

const reportMissingSignals = (
  def: { id: string; config: AstNode; start: number },
  sourceCode: string,
  filePath: string,
  knownSignalIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const line = offsetToLine(sourceCode, def.start);
  for (const signalId of extractDeclaredOnIds(def.config, sourceCode)) {
    if (!knownSignalIds.has(signalId) && !isDraftId(signalId)) {
      diagnostics.push(
        buildMissingSignalDiagnostic(def.id, signalId, filePath, line)
      );
    }
  }
};

const buildSignalDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownSignalIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  for (const def of findTrailDefinitions(ast)) {
    if (def.kind !== 'trail') {
      continue;
    }
    reportMissingSignals(
      def,
      sourceCode,
      filePath,
      knownSignalIds,
      diagnostics
    );
  }
  return diagnostics;
};

const checkOnReferences = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  knownSignalIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast) {
    return [];
  }
  return buildSignalDiagnostics(ast, sourceCode, filePath, knownSignalIds);
};

/**
 * Checks that every `on:` reference resolves to a known signal definition.
 */
export const onReferencesExist: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return checkOnReferences(
      ast,
      sourceCode,
      filePath,
      collectSignalDefinitionIds(ast)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localSignalIds = ast
      ? collectSignalDefinitionIds(ast)
      : new Set<string>();
    return checkOnReferences(
      ast,
      sourceCode,
      filePath,
      context.knownSignalIds ?? localSignalIds
    );
  },
  description:
    'Ensure every signal id declared in a trail on: array resolves to a known signal definition.',
  name: 'on-references-exist',
  severity: 'error',
};
