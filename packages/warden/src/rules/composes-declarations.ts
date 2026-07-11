/**
 * Validates that `ctx.compose()` calls match the declared `composes` array.
 *
 * Statically analyzes trail `implementation` functions to find `ctx.compose('trailId', ...)`
 * calls and compares them against the `composes: [...]` declaration in the trail
 * config. Reports errors for undeclared compositions and warnings for unused ones.
 */

import {
  findConfigProperty,
  findImplementationBodies,
  findTrailDefinitions,
  getNodeArguments,
  getNodeBodyNode,
  getNodeBodyStatements,
  getNodeCallee,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeKind,
  getNodeLeft,
  getNodeName,
  getNodeObject,
  getNodeParams,
  getNodeProperties,
  getNodeProperty,
  getNodeValue,
  getNodeValueNode,
  isShadowed,
  offsetToLine,
  parse,
  walkWithScopes,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
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
  return getNodeName(node) ?? null;
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
    return typeof getNodeValue(node) === 'string';
  }
  return false;
};

/** Extract the string value from a string literal node. */
const getStringValue = (node: AstNode): string | null => {
  const val = getNodeValue(node);
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

  const objName = identifierName(getNodeObject(callee));
  const propName = identifierName(getNodeProperty(callee));

  return objName && propName ? { objName, propName } : null;
};

/**
 * Extract the second parameter name from a implementation function node.
 *
 * Handles `(input, ctx) => ...`, `async (input, context) => ...`,
 * `function(input, ctx) { ... }`, and defaulted params like
 * `(input, ctx = fallback) => ...` (AssignmentPattern whose `.left` is the
 * Identifier).
 */
const extractContextParamName = (
  implementationBody: AstNode
): string | null => {
  const params = implementationBody['params'] as readonly AstNode[] | undefined;
  if (!params || params.length < 2) {
    return null;
  }
  const [, param] = params;
  if (param?.type === 'AssignmentPattern') {
    const left = getNodeLeft(param);
    return identifierName(left);
  }
  return identifierName(param);
};

/** Extract the local name bound to `compose` inside an ObjectPattern Property. */
const extractComposeLocalName = (prop: AstNode): string | null => {
  if (prop.type !== 'Property') {
    return null;
  }
  const key = getNodeKey(prop);
  const value = getNodeValueNode(prop);
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
  const properties = getNodeProperties(pattern);
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
 * Returns ONLY the actual second-parameter name from the implementation signature.
 * No seeded defaults: if the implementation has no second parameter, the returned set
 * is empty and no `ctx.compose(...)` / `context.compose(...)` calls are tracked
 * for that implementation. An unrelated closure-scoped `ctx` identifier is not the
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
  const id = getNodeId(node);
  const init = getNodeInit(node);
  if (!id || id.type !== 'ObjectPattern' || !init) {
    return null;
  }
  const initName = identifierName(init);
  return initName && ctxNames.has(initName) ? id : null;
};

const getTopLevelStatements = (body: AstNode): readonly AstNode[] => {
  if (body.type === 'BlockStatement') {
    return getNodeBodyStatements(body);
  }
  const blockBody = getNodeBodyNode(body);
  if (!blockBody || blockBody.type !== 'BlockStatement') {
    return [];
  }
  return getNodeBodyStatements(blockBody);
};

const collectComposeNamesFromDeclaration = (
  stmt: AstNode,
  ctxNames: ReadonlySet<string>,
  names: Set<string>
): void => {
  if (stmt.type !== 'VariableDeclaration') {
    return;
  }
  const kind = getNodeKind(stmt);
  if (kind !== 'const') {
    return;
  }
  const declarations = getNodeDeclarations(stmt);
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

interface ComposeHelper {
  readonly body: AstNode;
  readonly params: readonly AstNode[];
}

const isFunctionLikeNode = (
  node: AstNode | null | undefined
): node is AstNode =>
  node !== null &&
  node !== undefined &&
  (node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression');

const helperFromFunctionNode = (
  node: AstNode | null | undefined
): ComposeHelper | null => {
  if (!isFunctionLikeNode(node)) {
    return null;
  }
  const body = getNodeBodyNode(node);
  return body ? { body, params: getNodeParams(node) } : null;
};

const addFunctionHelper = (
  node: AstNode,
  helpers: Map<string, ComposeHelper>
): void => {
  if (node.type !== 'FunctionDeclaration') {
    return;
  }
  const name = identifierName(getNodeId(node));
  const helper = helperFromFunctionNode(node);
  if (name && helper) {
    helpers.set(name, helper);
  }
};

const addVariableHelpers = (
  node: AstNode,
  helpers: Map<string, ComposeHelper>
): void => {
  if (node.type !== 'VariableDeclaration' || getNodeKind(node) !== 'const') {
    return;
  }
  for (const declaration of getNodeDeclarations(node)) {
    const name = identifierName(getNodeId(declaration));
    const helper = helperFromFunctionNode(getNodeInit(declaration));
    if (name && helper) {
      helpers.set(name, helper);
    }
  }
};

const unwrapTopLevelDeclaration = (node: AstNode): AstNode =>
  node.type === 'ExportNamedDeclaration'
    ? (getNodeDeclaration(node) ?? node)
    : node;

const collectComposeHelpers = (
  ast: AstNode
): ReadonlyMap<string, ComposeHelper> => {
  const helpers = new Map<string, ComposeHelper>();
  for (const statement of getNodeBodyStatements(ast)) {
    const declaration = unwrapTopLevelDeclaration(statement);
    addFunctionHelper(declaration, helpers);
    addVariableHelpers(declaration, helpers);
  }
  return helpers;
};

const collectHelperCtxNames = (
  call: AstNode,
  helper: ComposeHelper,
  ctxNames: ReadonlySet<string>
): ReadonlySet<string> => {
  const names = new Set<string>();
  const args = getNodeArguments(call);
  for (const [index, param] of helper.params.entries()) {
    const argName = identifierName(args[index]);
    const paramName = identifierName(param);
    if (argName && paramName && ctxNames.has(argName)) {
      names.add(paramName);
    }
  }
  return names;
};

const findHelperCall = (
  node: AstNode | null | undefined,
  helpers: ReadonlyMap<string, ComposeHelper>
): { readonly helper: ComposeHelper; readonly name: string } | null => {
  if (node?.type !== 'CallExpression') {
    return null;
  }
  const calleeName = identifierName(getNodeCallee(node));
  if (!calleeName) {
    return null;
  }
  const helper = helpers.get(calleeName);
  return helper ? { helper, name: calleeName } : null;
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

/** Collect compose call results from a single implementation body. */
const collectComposeCallsFromBody = (
  body: AstNode,
  ids: Set<string>,
  sourceCode: string,
  helpers: ReadonlyMap<string, ComposeHelper>,
  inheritedCtxNames?: ReadonlySet<string>,
  visitedHelpers = new Set<string>()
): boolean => {
  const ctxNames = inheritedCtxNames ?? buildCtxNames(body);
  const composeLocalNames = collectDestructuredComposeNames(body, ctxNames);
  const helperNames = new Set(helpers.keys());
  let foundUnresolved = false;

  walkWithScopes(
    body,
    (node, scopeStack) => {
      const extracted = extractComposeCall(
        node,
        ctxNames,
        composeLocalNames,
        sourceCode
      );
      if (extracted) {
        if (extracted.hasUnresolved) {
          foundUnresolved = true;
        }

        for (const id of extracted.ids) {
          ids.add(id);
        }
      }

      const helperCall = findHelperCall(node, helpers);
      if (
        !helperCall ||
        visitedHelpers.has(helperCall.name) ||
        isShadowed(helperCall.name, scopeStack)
      ) {
        return;
      }
      const helperCtxNames = collectHelperCtxNames(
        node,
        helperCall.helper,
        ctxNames
      );
      if (helperCtxNames.size === 0) {
        return;
      }
      visitedHelpers.add(helperCall.name);
      if (
        collectComposeCallsFromBody(
          helperCall.helper.body,
          ids,
          sourceCode,
          helpers,
          helperCtxNames,
          visitedHelpers
        )
      ) {
        foundUnresolved = true;
      }
    },
    { initialScopes: [helperNames] }
  );

  return foundUnresolved;
};

/** Walk implementation bodies and collect all statically resolvable ctx.compose() trail IDs. */
const extractCalledComposes = (
  config: AstNode,
  ast: AstNode,
  sourceCode: string
): CalledComposes => {
  const ids = new Set<string>();
  let hasUnresolved = false;
  const helpers = collectComposeHelpers(ast);

  for (const body of findImplementationBodies(config)) {
    if (collectComposeCallsFromBody(body, ids, sourceCode, helpers)) {
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
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.compose('${composedId}') called but '${composedId}' is not declared in composes. Add it to the trail composes array: composes: ['${composedId}', ...].`,
  rule: 'composes-declarations',
  severity: 'error',
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
  },
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
  ast: AstNode,
  filePath: string,
  sourceCode: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const declared = extractDeclaredComposes(def.config, sourceCode);
  const called = extractCalledComposes(def.config, ast, sourceCode);

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

  reportUndeclared(called.ids, declared.ids, ctx, diagnostics);

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
      checkTrailDefinition(def, ast, filePath, sourceCode, diagnostics);
    }

    return diagnostics;
  },
  description:
    'Ensure ctx.compose() calls match the declared composes array in trail definitions.',
  name: 'composes-declarations',
  severity: 'error',
};
