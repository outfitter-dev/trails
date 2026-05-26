/**
 * Validates that `ctx.compose()` calls match the declared `composes` array.
 *
 * Statically analyzes trail `blaze` functions to find `ctx.compose('trailId', ...)`
 * calls and compares them against the `composes: [...]` declaration in the trail
 * config. Reports errors for undeclared compositions and warnings for unused ones.
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
const deriveConstString = (name: string, sourceCode: string): string | null => {
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
  return deriveConstString(name, sourceCode);
};

/** Resolve an array element to a static trail ID when possible. */
const deriveComposeElementId = (
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
// Declared composing extraction
// ---------------------------------------------------------------------------

/** Extract the ArrayExpression elements from a config's `composes` property. */
const getComposeElements = (config: AstNode): readonly AstNode[] | null => {
  const composesProp = findConfigProperty(config, 'composes');
  if (!composesProp) {
    return null;
  }

  const arrayNode = composesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return null;
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? null;
};

interface DeclaredComposes {
  /** Statically resolved trail IDs from string literals / const identifiers. */
  readonly ids: ReadonlySet<string>;
  /**
   * True if any element could not be statically resolved (e.g. trail object
   * reference like `composes: [showGist]`). When true, "undeclared" diagnostics
   * are softened from error to warn since the declared set is incomplete.
   */
  readonly hasUnresolved: boolean;
}

/**
 * Collect string IDs from array elements, resolving identifiers when possible.
 *
 * Trail-object references (`composes: [showGist]`) cannot be resolved at lint
 * time; they're normalized at runtime by `trail()`. When any entry is
 * unresolved, `hasUnresolved` is set so callers can soften diagnostics.
 */
/** Classify a single element and accumulate into the id set. */
const classifyComposeElement = (
  element: AstNode,
  sourceCode: string,
  ids: Set<string>
): boolean => {
  const resolved = deriveComposeElementId(element, sourceCode);
  if (!resolved) {
    // Element could not be statically resolved
    return true;
  }
  ids.add(resolved);
  return false;
};

const resolveDeclaredComposeElements = (
  elements: readonly AstNode[],
  sourceCode: string
): DeclaredComposes => {
  const ids = new Set<string>();
  let hasUnresolved = false;
  for (const element of elements) {
    if (classifyComposeElement(element, sourceCode, ids)) {
      hasUnresolved = true;
    }
  }
  return { hasUnresolved, ids };
};

/** Extract declared composes from a `composes: [...]` array. */
const extractDeclaredComposes = (
  config: AstNode,
  sourceCode: string
): DeclaredComposes => {
  const elements = getComposeElements(config);
  return elements
    ? resolveDeclaredComposeElements(elements, sourceCode)
    : { hasUnresolved: false, ids: new Set() };
};

// ---------------------------------------------------------------------------
// Called composing extraction — member expression helpers
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
 * Handles `(input, ctx) => ...`, `async (input, context) => ...`,
 * `function(input, ctx) { ... }`, and defaulted params like
 * `(input, ctx = fallback) => ...` (AssignmentPattern whose `.left` is the
 * Identifier).
 */
const extractContextParamName = (blazeBody: AstNode): string | null => {
  const params = blazeBody['params'] as readonly AstNode[] | undefined;
  if (!params || params.length < 2) {
    return null;
  }
  const [, param] = params;
  if (param?.type === 'AssignmentPattern') {
    const { left } = param as unknown as { left?: AstNode };
    return identifierName(left);
  }
  return identifierName(param);
};

/** Extract the local name bound to `compose` inside an ObjectPattern Property. */
const extractComposeLocalName = (prop: AstNode): string | null => {
  if (prop.type !== 'Property') {
    return null;
  }
  const { key, value } = prop as unknown as {
    readonly key?: AstNode;
    readonly value?: AstNode;
  };
  const keyName = identifierName(key);
  if (keyName !== 'compose') {
    return null;
  }
  return identifierName(value) ?? keyName;
};

/** Collect `compose` local names from an ObjectPattern's properties. */
const collectComposeNamesFromPattern = (
  pattern: AstNode,
  names: Set<string>
): void => {
  const { properties } = pattern as unknown as {
    readonly properties?: readonly AstNode[];
  };
  for (const prop of properties ?? []) {
    const localName = extractComposeLocalName(prop);
    if (localName) {
      names.add(localName);
    }
  }
};

/** Check if a callee is a member-style compose call: <ctxName>.compose(...). */
const isMemberComposeCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'compose';
};

interface ExtractedComposeCall {
  readonly ids: readonly string[];
  readonly hasUnresolved: boolean;
}

const unresolvedCompose = (): ExtractedComposeCall => ({
  hasUnresolved: true,
  ids: [],
});

const resolveBatchComposeTupleTarget = (
  element: AstNode,
  sourceCode: string
): string | null => {
  if (element.type !== 'ArrayExpression') {
    return null;
  }

  const tupleElements = element['elements'] as readonly AstNode[] | undefined;
  const [target] = tupleElements ?? [];
  return target ? deriveComposeElementId(target, sourceCode) : null;
};

const collectBatchComposeId = (
  element: AstNode,
  sourceCode: string,
  ids: string[]
): boolean => {
  const resolved = resolveBatchComposeTupleTarget(element, sourceCode);
  if (!resolved) {
    return true;
  }
  ids.push(resolved);
  return false;
};

/** Extract statically-resolved trail IDs from `ctx.compose([[trail, input], ...])`. */
const extractBatchComposeIds = (
  firstArg: AstNode | undefined,
  sourceCode: string
): ExtractedComposeCall | null => {
  if (firstArg?.type !== 'ArrayExpression') {
    return null;
  }

  const elements = firstArg['elements'] as readonly AstNode[] | undefined;
  const ids: string[] = [];
  let hasUnresolved = false;

  for (const element of elements ?? []) {
    if (collectBatchComposeId(element, sourceCode, ids)) {
      hasUnresolved = true;
    }
  }

  return { hasUnresolved, ids };
};

const extractDirectComposeIds = (
  firstArg: AstNode | undefined
): ExtractedComposeCall | null => {
  if (!firstArg || !isStringLiteral(firstArg)) {
    return null;
  }

  const value = getStringValue(firstArg);
  return value ? { hasUnresolved: false, ids: [value] } : unresolvedCompose();
};

const isComposeCallExpression = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>,
  composeLocalNames: ReadonlySet<string>
): boolean =>
  isMemberComposeCall(callee, ctxNames) ||
  composeLocalNames.has(identifierName(callee) ?? '');

const extractComposeFirstArg = (node: AstNode): AstNode | undefined => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  return args?.[0];
};

const resolveComposeCallNode = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  composeLocalNames: ReadonlySet<string>
): AstNode | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }

  const callee = node['callee'] as AstNode | undefined;
  if (
    !callee ||
    !isComposeCallExpression(callee, ctxNames, composeLocalNames)
  ) {
    return null;
  }

  return node;
};

const resolveComposeCallTargets = (
  firstArg: AstNode | undefined,
  sourceCode: string
): ExtractedComposeCall => {
  const direct = extractDirectComposeIds(firstArg);
  if (direct) {
    return direct;
  }

  const batch = extractBatchComposeIds(firstArg, sourceCode);
  return batch ?? unresolvedCompose();
};

/**
 * Check if a node is a `<ctxName>.compose(...)` call and return any statically
 * resolvable target IDs.
 *
 * Also matches bare `compose(...)` calls only when `compose` was verifiably
 * destructured from the trail context. When the first argument is a non-string
 * expression (e.g. a trail object identifier like `ctx.compose(showGist,
 * input)`), marks the call as unresolved so callers can track that a compose
 * call exists but its target cannot be statically resolved.
 */
const extractComposeCall = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  composeLocalNames: ReadonlySet<string>,
  sourceCode: string
): ExtractedComposeCall | null => {
  const composeCall = resolveComposeCallNode(node, ctxNames, composeLocalNames);
  if (!composeCall) {
    return null;
  }

  return resolveComposeCallTargets(
    extractComposeFirstArg(composeCall),
    sourceCode
  );
};

/**
 * Build the set of context parameter names to match against.
 *
 * Returns ONLY the actual second-parameter name from the blaze signature.
 * No seeded defaults: if the blaze has no second parameter, the returned set
 * is empty and no `ctx.compose(...)` / `context.compose(...)` calls are tracked
 * for that blaze. An unrelated closure-scoped `ctx` identifier is not the
 * trail context and must not be treated as one.
 *
 * Mirrors `fires-declarations.ts` and `resource-declarations.ts` for the same
 * reason.
 */
const buildCtxNames = (body: AstNode): ReadonlySet<string> => {
  const ctxNames = new Set<string>();
  const paramName = extractContextParamName(body);
  if (paramName) {
    ctxNames.add(paramName);
  }
  return ctxNames;
};

const getCtxDestructurePattern = (
  node: AstNode,
  ctxNames: ReadonlySet<string>
): AstNode | null => {
  if (node.type !== 'VariableDeclarator') {
    return null;
  }
  const { id, init } = node as unknown as {
    readonly id?: AstNode;
    readonly init?: AstNode;
  };
  if (!id || id.type !== 'ObjectPattern' || !init) {
    return null;
  }
  const initName = identifierName(init);
  return initName && ctxNames.has(initName) ? id : null;
};

const getTopLevelStatements = (body: AstNode): readonly AstNode[] => {
  const blockBody = (body as unknown as { body?: AstNode }).body;
  if (!blockBody || blockBody.type !== 'BlockStatement') {
    return [];
  }
  return (blockBody as unknown as { body?: readonly AstNode[] }).body ?? [];
};

const collectComposeNamesFromDeclaration = (
  stmt: AstNode,
  ctxNames: ReadonlySet<string>,
  names: Set<string>
): void => {
  if (stmt.type !== 'VariableDeclaration') {
    return;
  }
  const { kind } = stmt as unknown as { readonly kind?: string };
  if (kind !== 'const') {
    return;
  }
  const declarations =
    (stmt as unknown as { readonly declarations?: readonly AstNode[] })
      .declarations ?? [];
  for (const decl of declarations) {
    const pattern = getCtxDestructurePattern(decl, ctxNames);
    if (pattern) {
      collectComposeNamesFromPattern(pattern, names);
    }
  }
};

const collectDestructuredComposeNames = (
  body: AstNode,
  ctxNames: ReadonlySet<string>
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const stmt of getTopLevelStatements(body)) {
    collectComposeNamesFromDeclaration(stmt, ctxNames, names);
  }
  return names;
};

interface CalledComposes {
  /** Statically resolved trail IDs from string literal arguments. */
  readonly ids: ReadonlySet<string>;
  /**
   * True if any `ctx.compose()` call used a non-string first argument (e.g.
   * `ctx.compose(showGist, input)`). When true, "unused declaration"
   * diagnostics are softened since the call may target a declared entry.
   */
  readonly hasUnresolved: boolean;
}

/** Collect compose call results from a single blaze body. */
const collectComposeCallsFromBody = (
  body: AstNode,
  ids: Set<string>,
  sourceCode: string
): boolean => {
  const ctxNames = buildCtxNames(body);
  const composeLocalNames = collectDestructuredComposeNames(body, ctxNames);
  let foundUnresolved = false;

  walk(body, (node) => {
    const extracted = extractComposeCall(
      node,
      ctxNames,
      composeLocalNames,
      sourceCode
    );
    if (!extracted) {
      return;
    }

    if (extracted.hasUnresolved) {
      foundUnresolved = true;
    }

    for (const id of extracted.ids) {
      ids.add(id);
    }
  });

  return foundUnresolved;
};

/** Walk blaze bodies and collect all statically resolvable ctx.compose() trail IDs. */
const extractCalledComposes = (
  config: AstNode,
  sourceCode: string
): CalledComposes => {
  const ids = new Set<string>();
  let hasUnresolved = false;

  for (const body of findBlazeBodies(config)) {
    if (collectComposeCallsFromBody(body, ids, sourceCode)) {
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
  composedId: string,
  filePath: string,
  line: number,
  softened = false
): WardenDiagnostic => ({
  filePath,
  line,
  message: softened
    ? `Trail "${trailId}": ctx.compose('${composedId}') called but '${composedId}' is not declared in composes (may be declared via trail object references). Add the string id to composes, or use the same trail object form in both composes and ctx.compose(...).`
    : `Trail "${trailId}": ctx.compose('${composedId}') called but '${composedId}' is not declared in composes. Add it to the trail composes array: composes: ['${composedId}', ...].`,
  rule: 'composes-declarations',
  severity: softened ? 'warn' : 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  composedId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${composedId}' declared in composes but ctx.compose('${composedId}') never called`,
  rule: 'composes-declarations',
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
  const declared = extractDeclaredComposes(def.config, sourceCode);
  const called = extractCalledComposes(def.config, sourceCode);

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

  // When all ctx.compose() calls are statically resolved, report unused
  // declarations. When some calls use trail object references (unresolved),
  // skip — a declared string like 'gist.show' might be the target of an
  // unresolved `ctx.compose(showGist)` call, producing false positives.
  if (!called.hasUnresolved) {
    reportUnused(declared.ids, called.ids, ctx, diagnostics);
  }
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/**
 * Validates that `ctx.compose()` calls align with declared `composes` arrays.
 */
export const composesDeclarations: WardenRule = {
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
    'Ensure ctx.compose() calls match the declared composes array in trail definitions.',
  name: 'composes-declarations',
  severity: 'error',
};
