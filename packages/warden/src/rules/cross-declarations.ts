/**
 * Validates that `ctx.cross()` calls match the declared `crosses` array.
 *
 * Statically analyzes trail `blaze` functions to find `ctx.cross('trailId', ...)`
 * calls and compares them against the `crosses: [...]` declaration in the trail
 * config. Reports errors for undeclared crossings and warnings for unused ones.
 */

import {
  extractFirstStringArg,
  findConfigProperty,
  findBlazeBodies,
  findTrailDefinitions,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

// ---------------------------------------------------------------------------
// Shared identifier helpers
// ---------------------------------------------------------------------------

/** Get the name of an Identifier node, or null. */
const identifierName = (node: AstNode | undefined): string | null => {
  if (node?.type !== 'Identifier') {
    return null;
  }
  return (node as unknown as { name?: string }).name ?? null;
};

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
// Const identifier resolution
// ---------------------------------------------------------------------------

/**
 * Best-effort resolution of `const NAME = 'value'` declarations via regex.
 *
 * Returns the string value if a simple `const <name> = '...'` or `"..."` is
 * found in the source. Returns null for anything more complex.
 */
const resolveConstString = (
  name: string,
  sourceCode: string
): string | null => {
  const pattern = new RegExp(
    `const\\s+${name}\\s*=\\s*(?:'([^']*)'|"([^"]*)")`
  );
  const match = pattern.exec(sourceCode);
  if (!match) {
    return null;
  }
  return match[1] ?? match[2] ?? null;
};

/** Try to resolve an Identifier element to a string via const declaration. */
const resolveIdentifierElement = (
  el: AstNode,
  sourceCode: string
): string | null => {
  const name = identifierName(el);
  if (!name) {
    return null;
  }
  return resolveConstString(name, sourceCode);
};

/** Resolve an array element to a static trail ID when possible. */
const resolveCrossElementId = (
  element: AstNode,
  sourceCode: string
): string | null => {
  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  if (element.type === 'Identifier') {
    return resolveIdentifierElement(element, sourceCode);
  }

  return null;
};

// ---------------------------------------------------------------------------
// Declared crossing extraction
// ---------------------------------------------------------------------------

/** Extract the ArrayExpression elements from a config's `crosses` property. */
const getCrossElements = (config: AstNode): readonly AstNode[] | null => {
  const crossesProp = findConfigProperty(config, 'crosses');
  if (!crossesProp) {
    return null;
  }

  const arrayNode = crossesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return null;
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? null;
};

/** Collect string IDs from array elements, resolving identifiers when possible. */
const collectStringIds = (
  elements: readonly AstNode[],
  sourceCode: string
): Set<string> => {
  const ids = new Set<string>();
  for (const element of elements) {
    const resolved = resolveCrossElementId(element, sourceCode);
    if (resolved) {
      ids.add(resolved);
    }
  }
  return ids;
};

/** Extract string literal elements from a `crosses: [...]` array property. */
const extractDeclaredCrosses = (
  config: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const elements = getCrossElements(config);
  return elements ? collectStringIds(elements, sourceCode) : new Set();
};

// ---------------------------------------------------------------------------
// Called crossing extraction — member expression helpers
// ---------------------------------------------------------------------------

const MEMBER_TYPES = new Set(['StaticMemberExpression', 'MemberExpression']);

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

/**
 * Extract the second parameter name from a blaze function node.
 *
 * Handles `(input, ctx) => ...`, `async (input, context) => ...`, and
 * `function(input, ctx) { ... }` forms.
 */
const extractContextParamName = (blazeBody: AstNode): string | null => {
  const params = blazeBody['params'] as readonly AstNode[] | undefined;
  if (!params || params.length < 2) {
    return null;
  }
  return identifierName(params[1]);
};

/** Check if a callee is a member-style cross call: <ctxName>.cross(...). */
const isMemberCrossCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'cross';
};

/**
 * Check if a node is a `<ctxName>.cross(...)` call and return the string trail ID.
 *
 * Also matches bare `cross(...)` calls from destructuring.
 */
const extractCrossCallId = (
  node: AstNode,
  ctxNames: ReadonlySet<string>
): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }

  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }

  if (isMemberCrossCall(callee, ctxNames)) {
    return extractFirstStringArg(node);
  }

  if (identifierName(callee) === 'cross') {
    return extractFirstStringArg(node);
  }

  return null;
};

/** Build the set of context parameter names to match against. */
const buildCtxNames = (body: AstNode): ReadonlySet<string> => {
  const ctxNames = new Set(['ctx', 'context']);
  const paramName = extractContextParamName(body);
  if (paramName) {
    ctxNames.add(paramName);
  }
  return ctxNames;
};

/** Walk blaze bodies and collect all statically resolvable ctx.cross() trail IDs. */
const extractCalledCrosses = (config: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();

  for (const body of findBlazeBodies(config)) {
    const ctxNames = buildCtxNames(body);

    walk(body, (node) => {
      const id = extractCrossCallId(node, ctxNames);
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
  crossedId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.cross('${crossedId}') called but '${crossedId}' is not declared in crosses`,
  rule: 'cross-declarations',
  severity: 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  crossedId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${crossedId}' declared in crosses but ctx.cross('${crossedId}') never called`,
  rule: 'cross-declarations',
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
  const declared = extractDeclaredCrosses(def.config, sourceCode);
  const called = extractCalledCrosses(def.config);

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
 * Validates that `ctx.cross()` calls align with declared `crosses` arrays.
 */
export const crossDeclarations: WardenRule = {
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
    'Ensure ctx.cross() calls match the declared crosses array in trail definitions.',
  name: 'cross-declarations',
  severity: 'error',
};
