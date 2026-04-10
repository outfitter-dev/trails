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

interface DeclaredCrosses {
  /** Statically resolved trail IDs from string literals / const identifiers. */
  readonly ids: ReadonlySet<string>;
  /**
   * True if any element could not be statically resolved (e.g. trail object
   * reference like `crosses: [showGist]`). When true, "undeclared" diagnostics
   * are softened from error to warn since the declared set is incomplete.
   */
  readonly hasUnresolved: boolean;
}

/**
 * Collect string IDs from array elements, resolving identifiers when possible.
 *
 * Trail-object references (`crosses: [showGist]`) cannot be resolved at lint
 * time; they're normalized at runtime by `trail()`. When any entry is
 * unresolved, `hasUnresolved` is set so callers can soften diagnostics.
 */
/** Classify a single element and accumulate into the id set. */
const classifyCrossElement = (
  element: AstNode,
  sourceCode: string,
  ids: Set<string>
): boolean => {
  const resolved = resolveCrossElementId(element, sourceCode);
  if (!resolved) {
    // Element could not be statically resolved
    return true;
  }
  ids.add(resolved);
  return false;
};

const resolveDeclaredCrossElements = (
  elements: readonly AstNode[],
  sourceCode: string
): DeclaredCrosses => {
  const ids = new Set<string>();
  let hasUnresolved = false;
  for (const element of elements) {
    if (classifyCrossElement(element, sourceCode, ids)) {
      hasUnresolved = true;
    }
  }
  return { hasUnresolved, ids };
};

/** Extract declared crosses from a `crosses: [...]` array. */
const extractDeclaredCrosses = (
  config: AstNode,
  sourceCode: string
): DeclaredCrosses => {
  const elements = getCrossElements(config);
  return elements
    ? resolveDeclaredCrossElements(elements, sourceCode)
    : { hasUnresolved: false, ids: new Set() };
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

/** Sentinel indicating a cross call was found but the first arg is not a string literal. */
const UNRESOLVED_CROSS = Symbol('unresolved-cross');

/**
 * Check if a node is a `<ctxName>.cross(...)` call and return the string trail ID.
 *
 * Also matches bare `cross(...)` calls from destructuring. When the first
 * argument is a non-string expression (e.g. a trail object identifier like
 * `ctx.cross(showGist, input)`), returns `UNRESOLVED_CROSS` so callers can
 * track that a cross call exists but its target cannot be statically resolved.
 */
const extractCrossCallId = (
  node: AstNode,
  ctxNames: ReadonlySet<string>
): string | typeof UNRESOLVED_CROSS | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }

  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }

  const isCrossCall =
    isMemberCrossCall(callee, ctxNames) || identifierName(callee) === 'cross';

  if (!isCrossCall) {
    return null;
  }

  return extractFirstStringArg(node) ?? UNRESOLVED_CROSS;
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

interface CalledCrosses {
  /** Statically resolved trail IDs from string literal arguments. */
  readonly ids: ReadonlySet<string>;
  /**
   * True if any `ctx.cross()` call used a non-string first argument (e.g.
   * `ctx.cross(showGist, input)`). When true, "unused declaration"
   * diagnostics are softened since the call may target a declared entry.
   */
  readonly hasUnresolved: boolean;
}

/** Collect cross call results from a single blaze body. */
const collectCrossCallsFromBody = (
  body: AstNode,
  ids: Set<string>
): boolean => {
  const ctxNames = buildCtxNames(body);
  let foundUnresolved = false;

  walk(body, (node) => {
    const id = extractCrossCallId(node, ctxNames);
    if (id === UNRESOLVED_CROSS) {
      foundUnresolved = true;
    } else if (id) {
      ids.add(id);
    }
  });

  return foundUnresolved;
};

/** Walk blaze bodies and collect all statically resolvable ctx.cross() trail IDs. */
const extractCalledCrosses = (config: AstNode): CalledCrosses => {
  const ids = new Set<string>();
  let hasUnresolved = false;

  for (const body of findBlazeBodies(config)) {
    if (collectCrossCallsFromBody(body, ids)) {
      hasUnresolved = true;
    }
  }

  return { hasUnresolved, ids };
};

// ---------------------------------------------------------------------------
// Diagnostic builders
// ---------------------------------------------------------------------------

const buildUndeclaredDiagnostic = (
  trailId: string,
  crossedId: string,
  filePath: string,
  line: number,
  softened = false
): WardenDiagnostic => ({
  filePath,
  line,
  message: softened
    ? `Trail "${trailId}": ctx.cross('${crossedId}') called but '${crossedId}' is not declared in crosses (may be declared via trail object references)`
    : `Trail "${trailId}": ctx.cross('${crossedId}') called but '${crossedId}' is not declared in crosses`,
  rule: 'cross-declarations',
  severity: softened ? 'warn' : 'error',
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
  ctx: {
    trailId: string;
    filePath: string;
    line: number;
    softened?: boolean;
  },
  diagnostics: WardenDiagnostic[]
): void => {
  for (const id of called) {
    if (!declared.has(id)) {
      diagnostics.push(
        buildUndeclaredDiagnostic(
          ctx.trailId,
          id,
          ctx.filePath,
          ctx.line,
          ctx.softened
        )
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

  if (
    declared.ids.size === 0 &&
    !declared.hasUnresolved &&
    called.ids.size === 0 &&
    !called.hasUnresolved
  ) {
    return;
  }

  const line = offsetToLine(sourceCode, def.start);
  const ctx = { filePath, line, trailId: def.id };

  // When the declared array contains trail object references we can't resolve,
  // downgrade "undeclared" diagnostics from error to warn. The developer still
  // sees genuinely undeclared calls, but we can't statically prove the call
  // isn't covered by a trail object entry the runtime will normalize.
  reportUndeclared(
    called.ids,
    declared.ids,
    { ...ctx, softened: declared.hasUnresolved },
    diagnostics
  );

  // When all ctx.cross() calls are statically resolved, report unused
  // declarations. When some calls use trail object references (unresolved),
  // skip — a declared string like 'gist.show' might be the target of an
  // unresolved `ctx.cross(showGist)` call, producing false positives.
  if (!called.hasUnresolved) {
    reportUnused(declared.ids, called.ids, ctx, diagnostics);
  }
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
