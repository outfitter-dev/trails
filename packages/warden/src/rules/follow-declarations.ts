/**
 * Validates that `ctx.follow()` calls match the declared `follow` array.
 *
 * Statically analyzes trail run functions to find `ctx.follow('trailId', ...)`
 * calls and compares them against the `follow: [...]` declaration in the trail
 * config. Reports errors for undeclared follows and warnings for unused ones.
 */

import {
  findConfigProperty,
  findRunBodies,
  findTrailDefinitions,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

// ---------------------------------------------------------------------------
// String literal helpers
// ---------------------------------------------------------------------------

/** Check if a node is a string literal (covers `StringLiteral` and `Literal` with string value). */
const isStringLiteral = (node: AstNode): boolean => {
  if (node.type === 'StringLiteral') {
    return true;
  }
  if (node.type === 'Literal') {
    return typeof (node as unknown as { value?: unknown }).value === 'string';
  }
  return false;
};

/** Extract the string value from a string literal node. */
const getStringValue = (node: AstNode): string | null => {
  const val = (node as unknown as { value?: unknown }).value;
  return typeof val === 'string' ? val : null;
};

// ---------------------------------------------------------------------------
// Declared follow extraction
// ---------------------------------------------------------------------------

/** Extract the ArrayExpression elements from a config's `follow` property. */
const getFollowElements = (config: AstNode): readonly AstNode[] | null => {
  const followProp = findConfigProperty(config, 'follow');
  if (!followProp) {
    return null;
  }

  const arrayNode = followProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return null;
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? null;
};

/** Collect string IDs from array elements. */
const collectStringIds = (elements: readonly AstNode[]): Set<string> => {
  const ids = new Set<string>();
  for (const el of elements) {
    if (isStringLiteral(el)) {
      const val = getStringValue(el);
      if (val) {
        ids.add(val);
      }
    }
  }
  return ids;
};

/** Extract string literal elements from a `follow: [...]` array property. */
const extractDeclaredFollows = (config: AstNode): ReadonlySet<string> => {
  const elements = getFollowElements(config);
  return elements ? collectStringIds(elements) : new Set();
};

// ---------------------------------------------------------------------------
// Called follow extraction — member expression helpers
// ---------------------------------------------------------------------------

const MEMBER_TYPES = new Set(['StaticMemberExpression', 'MemberExpression']);

/** Get the name of an Identifier node, or null. */
const identifierName = (node: AstNode | undefined): string | null => {
  if (node?.type !== 'Identifier') {
    return null;
  }
  return (node as unknown as { name?: string }).name ?? null;
};

/** Extract object and property Identifier names from a MemberExpression. */
const extractMemberPair = (
  callee: AstNode
): { objName: string; propName: string } | null => {
  if (!MEMBER_TYPES.has(callee.type)) {
    return null;
  }

  const objName = identifierName(
    (callee as unknown as { object?: AstNode }).object
  );
  const propName = identifierName(
    (callee as unknown as { property?: AstNode }).property
  );

  return objName && propName ? { objName, propName } : null;
};

/** Extract the first argument string from a CallExpression's arguments list. */
const extractFirstStringArg = (node: AstNode): string | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (!args || args.length === 0) {
    return null;
  }

  const [firstArg] = args;
  if (!firstArg || !isStringLiteral(firstArg)) {
    // Dynamic ID — cannot resolve statically
    return null;
  }

  return getStringValue(firstArg);
};

/** Check if a node is a `ctx.follow(...)` call and return the string trail ID. */
const extractFollowCallId = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }

  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }

  const pair = extractMemberPair(callee);
  if (!pair || pair.objName !== 'ctx' || pair.propName !== 'follow') {
    return null;
  }

  return extractFirstStringArg(node);
};

/** Walk run bodies and collect all statically resolvable ctx.follow() trail IDs. */
const extractCalledFollows = (config: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();

  for (const body of findRunBodies(config)) {
    walk(body, (node) => {
      const id = extractFollowCallId(node);
      if (id) {
        ids.add(id);
      }
    });
  }

  return ids;
};

// ---------------------------------------------------------------------------
// Diagnostic builders
// ---------------------------------------------------------------------------

const buildUndeclaredDiagnostic = (
  trailId: string,
  followId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.follow('${followId}') called but '${followId}' is not declared in follow`,
  rule: 'follow-declarations',
  severity: 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  followId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${followId}' declared in follow but ctx.follow('${followId}') never called`,
  rule: 'follow-declarations',
  severity: 'warn',
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Emit error for each called ID not present in declared set. */
const reportUndeclared = (
  called: ReadonlySet<string>,
  declared: ReadonlySet<string>,
  ctx: { trailId: string; filePath: string; line: number },
  diagnostics: WardenDiagnostic[]
): void => {
  for (const id of called) {
    if (!declared.has(id)) {
      diagnostics.push(
        buildUndeclaredDiagnostic(ctx.trailId, id, ctx.filePath, ctx.line)
      );
    }
  }
};

/** Emit warning for each declared ID not present in called set. */
const reportUnused = (
  declared: ReadonlySet<string>,
  called: ReadonlySet<string>,
  ctx: { trailId: string; filePath: string; line: number },
  diagnostics: WardenDiagnostic[]
): void => {
  for (const id of declared) {
    if (!called.has(id)) {
      diagnostics.push(
        buildUnusedDiagnostic(ctx.trailId, id, ctx.filePath, ctx.line)
      );
    }
  }
};

const checkTrailDefinition = (
  def: { id: string; config: AstNode; start: number },
  filePath: string,
  sourceCode: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const declared = extractDeclaredFollows(def.config);
  const called = extractCalledFollows(def.config);

  if (declared.size === 0 && called.size === 0) {
    return;
  }

  const line = offsetToLine(sourceCode, def.start);
  const ctx = { filePath, line, trailId: def.id };

  reportUndeclared(called, declared, ctx, diagnostics);
  reportUnused(declared, called, ctx, diagnostics);
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/**
 * Validates that `ctx.follow()` calls align with declared `follow` arrays.
 */
export const followDeclarations: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    for (const def of findTrailDefinitions(ast)) {
      checkTrailDefinition(def, filePath, sourceCode, diagnostics);
    }

    return diagnostics;
  },
  description:
    'Ensure ctx.follow() calls match the declared follow array in trail definitions.',
  name: 'follow-declarations',
  severity: 'error',
};
