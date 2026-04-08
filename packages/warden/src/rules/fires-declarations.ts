/**
 * Validates that `ctx.fire()` calls match the declared `fires` array.
 *
 * Statically analyzes trail `blaze` functions to find `ctx.fire('signalId', ...)`
 * calls and compares them against the `fires: [...]` declaration in the trail
 * config. Reports errors for undeclared fires and warnings for unused ones.
 *
 * Mirrors `cross-declarations` structurally — same extraction, same reporting
 * shape, same const-identifier resolution, same context-parameter handling.
 */

import {
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

/** Resolve an array element to a static signal ID when possible. */
const resolveFireElementId = (
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
// Declared fires extraction
// ---------------------------------------------------------------------------

/** Extract the ArrayExpression elements from a config's `fires` property. */
const getFiresElements = (config: AstNode): readonly AstNode[] | null => {
  const firesProp = findConfigProperty(config, 'fires');
  if (!firesProp) {
    return null;
  }

  const arrayNode = firesProp.value;
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
    const resolved = resolveFireElementId(element, sourceCode);
    if (resolved) {
      ids.add(resolved);
    }
  }
  return ids;
};

/** Extract string literal elements from a `fires: [...]` array property. */
const extractDeclaredFires = (
  config: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const elements = getFiresElements(config);
  return elements ? collectStringIds(elements, sourceCode) : new Set();
};

// ---------------------------------------------------------------------------
// Called fires extraction — member expression helpers
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

/** Extract the first argument string from a CallExpression's arguments list. */
const extractFirstStringArg = (node: AstNode): string | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (!args || args.length === 0) {
    return null;
  }

  const [firstArg] = args;
  if (!firstArg || !isStringLiteral(firstArg)) {
    return null;
  }

  return getStringValue(firstArg);
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

/** Check if a callee is a member-style fire call: <ctxName>.fire(...). */
const isMemberFireCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'fire';
};

/**
 * Check if a node is a `<ctxName>.fire(...)` call and return the string signal ID.
 *
 * Also matches bare `fire(...)` calls from destructuring.
 */
const extractFireCallId = (
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

  if (isMemberFireCall(callee, ctxNames)) {
    return extractFirstStringArg(node);
  }

  if (identifierName(callee) === 'fire') {
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

/** Walk blaze bodies and collect all statically resolvable ctx.fire() signal IDs. */
const extractCalledFires = (config: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();

  for (const body of findBlazeBodies(config)) {
    const ctxNames = buildCtxNames(body);

    walk(body, (node) => {
      const id = extractFireCallId(node, ctxNames);
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
  signalId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.fire('${signalId}') called but '${signalId}' is not declared in fires`,
  rule: 'fires-declarations',
  severity: 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  signalId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${signalId}' declared in fires but ctx.fire('${signalId}') never called`,
  rule: 'fires-declarations',
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
  const declared = extractDeclaredFires(def.config, sourceCode);
  const called = extractCalledFires(def.config);

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
 * Validates that `ctx.fire()` calls align with declared `fires` arrays.
 */
export const firesDeclarations: WardenRule = {
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
    'Ensure ctx.fire() calls match the declared fires array in trail definitions.',
  name: 'fires-declarations',
  severity: 'error',
};
