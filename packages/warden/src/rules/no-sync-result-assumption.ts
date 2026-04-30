import { resultAccessorNames } from '@ontrails/core';

import { identifierName, isBlazeCall, offsetToLine, parse } from './ast.js';
import type { AstNode } from './ast.js';
import { isFrameworkInternalFile, isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RESULT_ACCESSOR_PROPERTIES: ReadonlySet<string> = new Set(
  resultAccessorNames
);

const MISSING_AWAIT_MESSAGE =
  'Missing await: .blaze() returns Promise<Result> after normalization. Use `const result = await trail.blaze(input, ctx)`.';

const createMissingAwaitDiagnostic = (
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: MISSING_AWAIT_MESSAGE,
  rule: 'no-sync-result-assumption',
  severity: 'error',
});

const isAstLike = (value: unknown): value is AstNode =>
  !!value && typeof value === 'object' && !!(value as AstNode).type;

/**
 * Build parent map for a full AST.
 *
 * Populates a `WeakMap` directly during traversal so we never materialize a
 * strong `Map` holding references to every AST node — the WeakMap lets parent
 * entries be reclaimed alongside their nodes once the rule invocation ends.
 */
const buildParentMap = (ast: AstNode): WeakMap<AstNode, AstNode> => {
  const parents = new WeakMap<AstNode, AstNode>();

  const recordAndVisit = (child: unknown, parent: AstNode): void => {
    if (isAstLike(child)) {
      parents.set(child, parent);
      // eslint-disable-next-line no-use-before-define
      visit(child);
    }
  };

  const visit = (node: AstNode): void => {
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          recordAndVisit(item, node);
        }
      } else {
        recordAndVisit(val, node);
      }
    }
  };

  visit(ast);
  return parents;
};

/**
 * Walk up the parent chain and return true when the expression is awaited
 * before any result-accessing member access fires on it.
 *
 * `await x.blaze(...)` → awaited.
 * `(await x.blaze(...)).isOk()` → awaited (await wraps before member access).
 * `x.blaze(...).isOk()` → NOT awaited (member access on raw call).
 */
const TRANSPARENT_WRAPPER_TYPES = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

const skipParens = (
  node: AstNode,
  parents: WeakMap<AstNode, AstNode>
): AstNode => {
  let current = node;
  let parent = parents.get(current);
  while (parent?.type && TRANSPARENT_WRAPPER_TYPES.has(parent.type)) {
    current = parent;
    parent = parents.get(current);
  }
  return current;
};

/**
 * Walk up through any wrapping parentheses and, when the current node sits
 * in the `consequent` or `alternate` of a `ConditionalExpression`, through
 * that conditional too. Returns the node whose parent should be inspected.
 *
 * Conservative: we only hop across a conditional when the node is one of
 * its branches (not the `test` position). This lets us treat both
 * `const r = cond ? x.blaze(...) : fallback` and
 * `await (cond ? x.blaze(...) : fallback)` correctly without misattributing
 * calls used as conditions.
 */
const isBranchOfConditional = (outer: AstNode, parent: AstNode): boolean => {
  if (parent.type !== 'ConditionalExpression') {
    return false;
  }
  const cond = parent as unknown as {
    consequent?: AstNode;
    alternate?: AstNode;
  };
  return cond.consequent === outer || cond.alternate === outer;
};

/**
 * Logical expressions (`&&`, `||`, `??`) carry the blaze result through either
 * side. A `.blaze()` on either operand may be the value ultimately bound to a
 * declarator (e.g. `const r = cond && trail.blaze(...)`), so we treat both
 * operands as carriers.
 */
const isOperandOfLogical = (outer: AstNode, parent: AstNode): boolean => {
  if (parent.type !== 'LogicalExpression') {
    return false;
  }
  const logical = parent as unknown as { left?: AstNode; right?: AstNode };
  return logical.left === outer || logical.right === outer;
};

const skipParensAndBranchConditionals = (
  node: AstNode,
  parents: WeakMap<AstNode, AstNode>
): AstNode => {
  let outer = skipParens(node, parents);
  while (true) {
    const parent = parents.get(outer);
    if (!parent) {
      return outer;
    }
    if (
      !(
        isBranchOfConditional(outer, parent) ||
        isOperandOfLogical(outer, parent)
      )
    ) {
      return outer;
    }
    outer = skipParens(parent, parents);
  }
};

const isAwaited = (
  node: AstNode,
  parents: WeakMap<AstNode, AstNode>
): boolean => {
  // Walk up through parens and any conditional whose branch is the blaze
  // call. `await (c ? x.blaze(...) : fallback)` awaits the conditional as a
  // whole, so the blaze call in a branch is effectively awaited.
  const outer = skipParensAndBranchConditionals(node, parents);
  return parents.get(outer)?.type === 'AwaitExpression';
};

const memberPropertyName = (node: AstNode): string | null => {
  if (
    node.type !== 'MemberExpression' &&
    node.type !== 'StaticMemberExpression'
  ) {
    return null;
  }
  const prop = (node as unknown as { property?: AstNode }).property;
  if (prop?.type !== 'Identifier') {
    return null;
  }
  return (prop as unknown as { name?: string }).name ?? null;
};

/**
 * Check if the blaze call is directly consumed by a result accessor
 * (e.g. `foo.blaze(...).isOk()` or `foo.blaze(...).value`).
 */
const hasDirectResultAccess = (
  blazeCall: AstNode,
  parents: WeakMap<AstNode, AstNode>
): boolean => {
  // Unwrap wrapping parentheses, conditional branches, and logical-operator
  // operands so `(x.blaze(...)).isOk()`,
  // `(cond ? x.blaze(...) : fb).isOk()`, and
  // `(cond && x.blaze(...)).isOk()` are all detected the same way as the
  // bare `x.blaze(...).isOk()` shape.
  const outer = skipParensAndBranchConditionals(blazeCall, parents);
  const parent = parents.get(outer);
  if (!parent) {
    return false;
  }
  const property = memberPropertyName(parent);
  return property !== null && RESULT_ACCESSOR_PROPERTIES.has(property);
};

/**
 * If the blaze call is the init of a VariableDeclarator (directly, through
 * parens, or as a branch of a ConditionalExpression init), return the bound
 * identifier name. Otherwise null.
 */
const extractAssignedBinding = (
  blazeCall: AstNode,
  parents: WeakMap<AstNode, AstNode>
): string | null => {
  const outer = skipParensAndBranchConditionals(blazeCall, parents);
  const parent = parents.get(outer);
  if (!parent || parent.type !== 'VariableDeclarator') {
    return null;
  }
  const { id } = parent as unknown as { id?: AstNode };
  return identifierName(id);
};

interface PendingBinding {
  readonly name: string;
  readonly declarationNode: AstNode;
  /** Unique id of the scope frame that owns this binding. */
  readonly scopeId: number;
}

const isResultAccessorMember = (node: AstNode): boolean => {
  if (
    node.type !== 'MemberExpression' &&
    node.type !== 'StaticMemberExpression'
  ) {
    return false;
  }
  const property = memberPropertyName(node);
  return property !== null && RESULT_ACCESSOR_PROPERTIES.has(property);
};

const getIdentifierObjectName = (node: AstNode): string | null => {
  const { object } = node as unknown as { object?: AstNode };
  return object?.type === 'Identifier' ? identifierName(object) : null;
};

// ---------------------------------------------------------------------------
// Scope tracking
// ---------------------------------------------------------------------------

const collectIdentifierBinding = (pattern: AstNode, out: Set<string>): void => {
  const name = identifierName(pattern);
  if (name) {
    out.add(name);
  }
};

const collectAssignmentPatternBindings = (
  pattern: AstNode,
  out: Set<string>
): void => {
  const { left } = pattern as unknown as { left?: AstNode };
  // eslint-disable-next-line no-use-before-define
  collectPatternBindings(left, out);
};

const collectRestElementBindings = (
  pattern: AstNode,
  out: Set<string>
): void => {
  const { argument } = pattern as unknown as { argument?: AstNode };
  // eslint-disable-next-line no-use-before-define
  collectPatternBindings(argument, out);
};

type PatternHandler = (pattern: AstNode, out: Set<string>) => void;

const PATTERN_HANDLERS: Record<string, PatternHandler> = {
  // eslint-disable-next-line no-use-before-define
  ArrayPattern: (p, out) => collectArrayPatternBindings(p, out),
  AssignmentPattern: collectAssignmentPatternBindings,
  Identifier: collectIdentifierBinding,
  // eslint-disable-next-line no-use-before-define
  ObjectPattern: (p, out) => collectObjectPatternBindings(p, out),
  RestElement: collectRestElementBindings,
};

/**
 * Collect binding names introduced by a destructuring / parameter pattern.
 * Handles Identifier, AssignmentPattern, ObjectPattern, ArrayPattern,
 * and RestElement shapes.
 *
 * `function` declaration (instead of an arrow) so it can be hoisted for the
 * mutually recursive calls from the array / object pattern helpers below.
 */
// biome-ignore lint/style/useConst: hoisted for mutual recursion
// eslint-disable-next-line func-style
function collectPatternBindings(
  pattern: AstNode | undefined,
  out: Set<string>
): void {
  if (!pattern) {
    return;
  }
  const handler = PATTERN_HANDLERS[pattern.type];
  if (handler) {
    handler(pattern, out);
  }
}

const collectArrayPatternBindings = (
  pattern: AstNode,
  out: Set<string>
): void => {
  const { elements } = pattern as unknown as {
    elements?: readonly (AstNode | null)[];
  };
  if (!elements) {
    return;
  }
  for (const element of elements) {
    if (element) {
      // eslint-disable-next-line no-use-before-define
      collectPatternBindings(element, out);
    }
  }
};

const collectObjectPatternBindings = (
  pattern: AstNode,
  out: Set<string>
): void => {
  const { properties } = pattern as unknown as {
    properties?: readonly AstNode[];
  };
  if (!properties) {
    return;
  }
  for (const prop of properties) {
    if (prop.type === 'RestElement') {
      // eslint-disable-next-line no-use-before-define
      collectPatternBindings(prop, out);
    } else {
      // Property node: value holds the binding pattern.
      const { value } = prop as unknown as { value?: AstNode };
      // eslint-disable-next-line no-use-before-define
      collectPatternBindings(value, out);
    }
  }
};

const SCOPE_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'BlockStatement',
  'StaticBlock',
  'CatchClause',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
]);

const isScopeBoundary = (node: AstNode): boolean =>
  SCOPE_NODE_TYPES.has(node.type);

/**
 * Collect the local binding names introduced directly in this scope's own
 * declarations (params + var/let/const/catch/for declarations), without
 * descending into nested function or block scopes.
 *
 * For function-like scopes, the body (a BlockStatement) is its own child
 * scope — we do not merge params into it. Params and body bindings are
 * treated as sibling frames via the scope walk: when entering the function,
 * we push a frame with params; when entering its body block, we push another
 * frame with the block's declarations. Nearest-scope resolution treats them
 * as a single effective scope chain.
 */
const FUNCTION_SCOPE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const collectVariableDeclarationBindings = (
  declNode: AstNode | undefined,
  out: Set<string>
): void => {
  if (!declNode || declNode.type !== 'VariableDeclaration') {
    return;
  }
  const declarators = (
    declNode as unknown as {
      declarations?: readonly AstNode[];
    }
  ).declarations;
  if (!declarators) {
    return;
  }
  for (const d of declarators) {
    const { id } = d as unknown as { id?: AstNode };
    collectPatternBindings(id, out);
  }
};

const getVariableDeclarationKind = (
  declNode: AstNode | undefined
): string | null => {
  if (!declNode || declNode.type !== 'VariableDeclaration') {
    return null;
  }
  return (declNode as unknown as { kind?: string }).kind ?? null;
};

/** True if declaration is `var` (function/program-scoped, hoistable). */
const isVarDeclaration = (declNode: AstNode | undefined): boolean =>
  getVariableDeclarationKind(declNode) === 'var';

/** Collect only `let`/`const` declarator bindings (block-scoped). */
const collectBlockScopedDeclaratorBindings = (
  declNode: AstNode | undefined,
  out: Set<string>
): void => {
  const kind = getVariableDeclarationKind(declNode);
  if (!kind || kind === 'var') {
    return;
  }
  collectVariableDeclarationBindings(declNode, out);
};

interface FunctionScopeBindings {
  readonly bindings: Set<string>;
  readonly paramBindings: Set<string>;
}

const collectParamBindings = (scope: AstNode): Set<string> => {
  const paramBindings = new Set<string>();
  const { params } = scope as unknown as { params?: readonly AstNode[] };
  if (params) {
    for (const param of params) {
      collectPatternBindings(param, paramBindings);
    }
  }
  return paramBindings;
};

const addHoistedVarsFromBody = (scope: AstNode, out: Set<string>): void => {
  const { body } = scope as unknown as { body?: AstNode };
  if (!(body && isAstLike(body))) {
    return;
  }
  const hoisted = new Set<string>();
  // eslint-disable-next-line no-use-before-define
  collectHoistedVarBindings(body, hoisted);
  for (const name of hoisted) {
    out.add(name);
  }
};

const collectFunctionScopeBindingsEx = (
  scope: AstNode
): FunctionScopeBindings => {
  const paramBindings = collectParamBindings(scope);
  const bindings = new Set<string>(paramBindings);
  addHoistedVarsFromBody(scope, bindings);
  return { bindings, paramBindings };
};

const collectFunctionScopeBindings = (scope: AstNode): Set<string> =>
  collectFunctionScopeBindingsEx(scope).bindings;

const collectCatchScopeBindings = (scope: AstNode): Set<string> => {
  const bindings = new Set<string>();
  const { param } = scope as unknown as { param?: AstNode };
  collectPatternBindings(param, bindings);
  return bindings;
};

const collectForScopeBindings = (scope: AstNode): Set<string> => {
  const bindings = new Set<string>();
  if (scope.type === 'ForStatement') {
    const { init } = scope as unknown as { init?: AstNode };
    collectBlockScopedDeclaratorBindings(init, bindings);
  } else {
    const { left } = scope as unknown as { left?: AstNode };
    collectBlockScopedDeclaratorBindings(left, bindings);
  }
  return bindings;
};

const addFunctionDeclarationName = (stmt: AstNode, out: Set<string>): void => {
  if (stmt.type !== 'FunctionDeclaration') {
    return;
  }
  const { id } = stmt as unknown as { id?: AstNode };
  const fnName = identifierName(id);
  if (fnName) {
    out.add(fnName);
  }
};

const addClassDeclarationName = (stmt: AstNode, out: Set<string>): void => {
  if (stmt.type !== 'ClassDeclaration') {
    return;
  }
  const { id } = stmt as unknown as { id?: AstNode };
  const className = identifierName(id);
  if (className) {
    out.add(className);
  }
};

const collectBlockScopedStatementListBindings = (
  statements: readonly AstNode[] | undefined,
  out: Set<string>
): void => {
  if (!statements) {
    return;
  }
  for (const stmt of statements) {
    collectBlockScopedDeclaratorBindings(stmt, out);
    addFunctionDeclarationName(stmt, out);
    addClassDeclarationName(stmt, out);
  }
};

const collectBlockStatementBindings = (scope: AstNode): Set<string> => {
  const bindings = new Set<string>();
  const { body } = scope as unknown as { body?: readonly AstNode[] };
  collectBlockScopedStatementListBindings(body, bindings);
  // Static initializer blocks own their own VariableEnvironment (per ES spec),
  // so `var` declarations inside them do not escape into the enclosing class
  // or function scope. `collectHoistedVarBindings` correctly refuses to cross
  // a `StaticBlock` boundary from the outside, which means nothing else will
  // register these bindings. Hoist them here so `var result = trail.blaze(...)`
  // inside a `static { ... }` block is tracked against the block itself.
  if (scope.type === 'StaticBlock') {
    // `collectHoistedVarBindings` is called with the StaticBlock as the root,
    // so the own-VariableEnvironment check (which refuses to descend *into* a
    // nested StaticBlock) does not short-circuit traversal of the node itself.
    // eslint-disable-next-line no-use-before-define
    collectHoistedVarBindings(scope, bindings);
  }
  return bindings;
};

/**
 * Collect the local binding names introduced directly in this scope's own
 * declarations (params + var/let/const/catch/for declarations), without
 * descending into nested function or block scopes.
 */
const collectScopeBindings = (scope: AstNode): Set<string> => {
  if (FUNCTION_SCOPE_TYPES.has(scope.type)) {
    return collectFunctionScopeBindings(scope);
  }
  if (scope.type === 'CatchClause') {
    return collectCatchScopeBindings(scope);
  }
  if (
    scope.type === 'ForStatement' ||
    scope.type === 'ForInStatement' ||
    scope.type === 'ForOfStatement'
  ) {
    return collectForScopeBindings(scope);
  }
  if (scope.type === 'BlockStatement' || scope.type === 'StaticBlock') {
    return collectBlockStatementBindings(scope);
  }
  return new Set();
};

type ScopeKind = 'program' | 'function' | 'block' | 'for' | 'catch';

interface ScopeFrame {
  readonly id: number;
  readonly kind: ScopeKind;
  readonly bindings: Set<string>;
  /**
   * For function frames: names that came from parameters (not hoisted `var`s).
   * A `var` declaration with the same name as a parameter is redundant in JS —
   * the parameter is the real binding. We track params separately so we don't
   * register a pending `.blaze()` binding that is actually shadowed by a param.
   */
  readonly paramBindings?: Set<string>;
}

const scopeKindForNode = (node: AstNode): ScopeKind => {
  if (FUNCTION_SCOPE_TYPES.has(node.type)) {
    return 'function';
  }
  if (node.type === 'CatchClause') {
    return 'catch';
  }
  if (
    node.type === 'ForStatement' ||
    node.type === 'ForInStatement' ||
    node.type === 'ForOfStatement'
  ) {
    return 'for';
  }
  return 'block';
};

/**
 * True when a nested node owns its own VariableEnvironment and therefore stops
 * `var` hoisting from crossing into the enclosing function/program scope.
 * Covers function-like nodes and `StaticBlock` (ECMAScript: static blocks
 * introduce their own LexicalEnvironment and VariableEnvironment).
 */
const ownsVariableEnvironment = (node: AstNode): boolean =>
  FUNCTION_SCOPE_TYPES.has(node.type) || node.type === 'StaticBlock';

const collectHoistedVarBindings = (root: AstNode, out: Set<string>): void => {
  const visit = (node: AstNode, isRoot: boolean): void => {
    // Nested var-environment owners (functions, static blocks) do not leak
    // their `var`s to the enclosing scope.
    if (!isRoot && ownsVariableEnvironment(node)) {
      return;
    }
    if (node.type === 'VariableDeclaration' && isVarDeclaration(node)) {
      collectVariableDeclarationBindings(node, out);
    }
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (isAstLike(item)) {
            visit(item, false);
          }
        }
      } else if (isAstLike(val)) {
        visit(val, false);
      }
    }
  };
  visit(root, true);
};

interface AnalyzeState {
  readonly parents: WeakMap<AstNode, AstNode>;
  readonly diagnostics: WardenDiagnostic[];
  readonly sourceCode: string;
  readonly filePath: string;
  /** Pending `.blaze()` bindings seen so far, keyed by scope id + name. */
  readonly pendingByScopeAndName: Map<string, PendingBinding>;
  readonly scopeStack: ScopeFrame[];
  readonly reportedAt: Set<number>;
  /**
   * Monotonic counter for scope frame ids. Intentionally mutable — every other
   * field on `AnalyzeState` is `readonly`, but this one is incremented with
   * `state.nextScopeId += 1` each time a scope frame is pushed so sibling
   * scopes get distinct ids. Keeping it as a plain number (rather than a
   * boxed `{ current: number }`) avoids an extra allocation and indirection
   * on a hot path; the mutability is local to `pushScopeIfBoundary`.
   */
  nextScopeId: number;
}

const pendingKey = (scopeId: number, name: string): string =>
  `${scopeId}\u0000${name}`;

/**
 * Resolve an identifier use to the nearest enclosing scope frame that binds
 * the name. Returns `null` if no frame binds it.
 */
const resolveNearestScope = (
  name: string,
  stack: readonly ScopeFrame[]
): ScopeFrame | null => {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const frame = stack[i];
    if (frame && frame.bindings.has(name)) {
      return frame;
    }
  }
  return null;
};

/**
 * Resolve the blaze call to a `{ name, declarator }` pair when it is the init
 * of a `VariableDeclarator` (directly, through parens, or as a branch of a
 * `ConditionalExpression` init). Returns null otherwise.
 */
const resolveBlazeBinding = (
  blazeCall: AstNode,
  parents: WeakMap<AstNode, AstNode>
): { readonly name: string; readonly declarator: AstNode } | null => {
  const name = extractAssignedBinding(blazeCall, parents);
  if (!name) {
    return null;
  }
  // Mirror `extractAssignedBinding`: unwrap parens and branch-position
  // conditionals so the stored declaration node points at the
  // `VariableDeclarator`, not at an intermediate `ParenthesizedExpression`
  // or `ConditionalExpression`.
  const outer = skipParensAndBranchConditionals(blazeCall, parents);
  const declarator = parents.get(outer);
  return declarator ? { declarator, name } : null;
};

/**
 * Resolve the blaze call to a `{ name, assignment }` pair when it is the RHS
 * of a plain `=` `AssignmentExpression` with an `Identifier` LHS (directly,
 * through parens, or as a branch of a conditional/logical expression).
 *
 * Covers patterns like:
 *   let result;
 *   result = trail.blaze(input, ctx);
 *   result.isOk();
 *
 * Member-expression LHS (`obj.result = blaze(...)`) is intentionally skipped —
 * those are property writes, not bare bindings we can track by name.
 */
const extractPlainIdentifierAssignmentName = (
  parent: AstNode | undefined
): string | null => {
  if (!parent || parent.type !== 'AssignmentExpression') {
    return null;
  }
  const { operator, left } = parent as unknown as {
    operator?: string;
    left?: AstNode;
  };
  // Only plain `=` assignments to a bare identifier. Member-expression LHS
  // (`obj.result = blaze(...)`) is a property write, not a bare binding we
  // can track by name.
  if (operator !== '=' || !left || left.type !== 'Identifier') {
    return null;
  }
  return identifierName(left);
};

const resolveBlazeAssignment = (
  blazeCall: AstNode,
  parents: WeakMap<AstNode, AstNode>
): { readonly name: string; readonly assignment: AstNode } | null => {
  const outer = skipParensAndBranchConditionals(blazeCall, parents);
  const parent = parents.get(outer);
  const name = extractPlainIdentifierAssignmentName(parent);
  return name && parent ? { assignment: parent, name } : null;
};

/**
 * True when `declarator` is a `VariableDeclarator` whose parent
 * `VariableDeclaration` uses the `var` kind. Such declarators re-initialize
 * a same-named function parameter rather than shadowing it, because `var`
 * and parameters share the function's VariableEnvironment.
 */
const isVarDeclaratorOfParamName = (
  declarator: AstNode,
  parents: WeakMap<AstNode, AstNode>
): boolean => {
  if (declarator.type !== 'VariableDeclarator') {
    return false;
  }
  const decl = parents.get(declarator);
  return isVarDeclaration(decl);
};

/**
 * True when `node` is a plain `=` `AssignmentExpression` with an `Identifier`
 * LHS. Such an assignment writes to the existing binding for that name — if
 * that name is a function parameter, the assignment re-initializes the
 * parameter's slot in the VariableEnvironment, just like `var <name> = ...`.
 * Compound assignments (`+=`, `??=`, etc.) are excluded because they do not
 * unconditionally replace the slot with the blaze result.
 */
const isAssignmentToParamName = (node: AstNode): boolean => {
  if (node.type !== 'AssignmentExpression') {
    return false;
  }
  const { operator, left } = node as unknown as {
    operator?: string;
    left?: AstNode;
  };
  return operator === '=' && left?.type === 'Identifier';
};

const recordPendingBinding = (
  blazeCall: AstNode,
  state: AnalyzeState
): void => {
  const binding =
    resolveBlazeBinding(blazeCall, state.parents) ??
    (() => {
      const asn = resolveBlazeAssignment(blazeCall, state.parents);
      return asn ? { declarator: asn.assignment, name: asn.name } : null;
    })();
  if (!binding) {
    return;
  }
  const { name, declarator } = binding;
  // The pending binding lives in the nearest scope that declares `name`.
  // That is always the innermost scope in the current stack, because the
  // variable declaration's id was contributed to its enclosing scope's
  // bindings when that scope was entered.
  const owningFrame = resolveNearestScope(name, state.scopeStack);
  if (!owningFrame) {
    return;
  }
  // If the name resolves to a function parameter, the `var` that visually
  // appears to declare it is redundant — the parameter is the real binding,
  // and parameters are not pending `.blaze()` results.
  //
  // Carve-out: a `var <name> = blaze(...)` *initializer* inside the same
  // function body legitimately re-binds the parameter at that point. `var`
  // and parameters share the function's VariableEnvironment, so the `var`
  // writes to the existing parameter slot and the subsequent use resolves
  // to the freshly-assigned `.blaze()` result. Treat that as a pending
  // binding.
  //
  // The same logic applies to a bare `result = blaze(...)` assignment: it
  // writes to the parameter's existing slot in the same VariableEnvironment,
  // so the subsequent `result.isOk()` observes the blaze result. Only
  // compound assignments (`+=`, `??=`, etc.) and member-expression LHS fall
  // through the param-shadow suppression, because they do not
  // unconditionally replace the parameter slot with the blaze result.
  if (
    owningFrame.paramBindings?.has(name) &&
    !isVarDeclaratorOfParamName(declarator, state.parents) &&
    !isAssignmentToParamName(declarator)
  ) {
    return;
  }
  state.pendingByScopeAndName.set(pendingKey(owningFrame.id, name), {
    declarationNode: declarator,
    name,
    scopeId: owningFrame.id,
  });
};

/**
 * True when `expr`, descended through wrapping parens, conditional branches,
 * and logical-operator operands, contains a `.blaze()` call that would be
 * registered by `recordPendingBinding` for this assignment.
 *
 * This mirrors the *upward* carrier walk done by
 * `skipParensAndBranchConditionals` — if a blaze call is anywhere along a
 * carrier path descending from `expr`, then visiting that blaze call will
 * re-register the pending binding, so we must not clear it on the way in.
 */
type CarrierChildExtractor = (
  expr: AstNode
) => readonly (AstNode | undefined)[];

const CARRIER_CHILDREN: Record<string, CarrierChildExtractor> = {
  ConditionalExpression: (expr) => {
    const { consequent, alternate } = expr as unknown as {
      consequent?: AstNode;
      alternate?: AstNode;
    };
    return [consequent, alternate];
  },
  LogicalExpression: (expr) => {
    const { left, right } = expr as unknown as {
      left?: AstNode;
      right?: AstNode;
    };
    return [left, right];
  },
};

const unwrapTransparentWrapper = (expr: AstNode): AstNode | undefined =>
  (expr as unknown as { expression?: AstNode }).expression;

// biome-ignore lint/style/useConst: hoisted for recursive call
// eslint-disable-next-line func-style
function rhsCarriesBlazeReinit(expr: AstNode | undefined): boolean {
  if (!expr) {
    return false;
  }
  if (TRANSPARENT_WRAPPER_TYPES.has(expr.type)) {
    return rhsCarriesBlazeReinit(unwrapTransparentWrapper(expr));
  }
  const extractor = CARRIER_CHILDREN[expr.type];
  if (extractor) {
    return extractor(expr).some(rhsCarriesBlazeReinit);
  }
  return isBlazeCall(expr);
}

/**
 * Nullish/falsy-skip compound assignments (`??=`, `||=`) only write to the slot
 * when the LHS is nullish or falsy. A pending `.blaze()` binding holds a
 * truthy `Promise<Result>`, so the RHS never runs and the pending binding must
 * survive them.
 *
 * `&&=` is intentionally excluded: it writes when the LHS is truthy, so a
 * pending `Promise<Result>` is *always* overwritten by the RHS. That matches
 * the clearing behavior of mathematical compound operators (`+=`, `-=`, ...).
 */
const NULLISH_SKIP_OPERATORS = new Set(['??=', '||=']);

interface IdentifierAssignment {
  readonly operator: string;
  readonly name: string;
  readonly right: AstNode | undefined;
}

const extractIdentifierAssignment = (
  node: AstNode
): IdentifierAssignment | null => {
  if (node.type !== 'AssignmentExpression') {
    return null;
  }
  const { operator, left, right } = node as unknown as {
    operator?: string;
    left?: AstNode;
    right?: AstNode;
  };
  if (!(operator && left) || left.type !== 'Identifier') {
    return null;
  }
  const name = identifierName(left);
  return name ? { name, operator, right } : null;
};

const resolvePendingKeyFor = (
  name: string,
  state: AnalyzeState
): string | null => {
  const frame = resolveNearestScope(name, state.scopeStack);
  if (!frame) {
    return null;
  }
  const key = pendingKey(frame.id, name);
  return state.pendingByScopeAndName.has(key) ? key : null;
};

/**
 * Handle a plain `=` assignment (or clearing compound assignment) to a bare
 * identifier whose name currently has a pending `.blaze()` binding in scope.
 *
 * A plain `=` whose RHS carries another blaze call leaves the pending entry
 * alone — `recordPendingBinding` will re-register it when the blaze call
 * itself is visited. Otherwise, clear the pending entry: the identifier has
 * been overwritten with a non-Result value, so the original
 * `result.isOk()`-style diagnostic no longer applies.
 *
 * Nullish/falsy-skip compound assignments (`??=`, `||=`) are ignored — a
 * truthy pending `Promise<Result>` causes the RHS to be skipped, so the
 * pending binding is preserved. `&&=` is *not* in this set: a truthy LHS
 * causes the RHS to always run, overwriting the pending slot, so it falls
 * through to the clearing path alongside `+=`, `-=`, etc. Member-expression
 * LHS is ignored because it writes a property, not the tracked identifier.
 */
const handleAssignmentReassignment = (
  node: AstNode,
  state: AnalyzeState
): void => {
  const assignment = extractIdentifierAssignment(node);
  if (!assignment || NULLISH_SKIP_OPERATORS.has(assignment.operator)) {
    return;
  }
  const key = resolvePendingKeyFor(assignment.name, state);
  if (!key) {
    return;
  }
  // Plain `=` with a blaze-carrying RHS will re-register via
  // `recordPendingBinding` when the blaze call itself is visited. Other
  // compound operators (`+=`, `-=`, `*=`, etc.) produce a primitive value
  // from the existing slot, so they always clear.
  if (assignment.operator === '=' && rhsCarriesBlazeReinit(assignment.right)) {
    return;
  }
  state.pendingByScopeAndName.delete(key);
};

const reportMissingAwait = (node: AstNode, state: AnalyzeState): void => {
  if (state.reportedAt.has(node.start)) {
    return;
  }
  state.reportedAt.add(node.start);
  state.diagnostics.push(
    createMissingAwaitDiagnostic(
      state.filePath,
      offsetToLine(state.sourceCode, node.start)
    )
  );
};

const findPendingBindingForUse = (
  node: AstNode,
  state: AnalyzeState
): PendingBinding | null => {
  if (!isResultAccessorMember(node)) {
    return null;
  }
  const name = getIdentifierObjectName(node);
  if (!name) {
    return null;
  }
  const frame = resolveNearestScope(name, state.scopeStack);
  if (!frame) {
    return null;
  }
  return state.pendingByScopeAndName.get(pendingKey(frame.id, name)) ?? null;
};

const checkPendingAccess = (node: AstNode, state: AnalyzeState): void => {
  const binding = findPendingBindingForUse(node, state);
  if (!binding) {
    return;
  }
  // Declaration must precede the use. Use source offsets for ordering.
  if (node.start < binding.declarationNode.end) {
    return;
  }
  reportMissingAwait(node, state);
};

/**
 * If the blaze call is the init of a VariableDeclarator whose id is an
 * ObjectPattern that destructures any known Result accessor property,
 * return the declarator node. Otherwise null.
 *
 * Catches the core missing-await shape when written as destructuring:
 *   `const { isOk } = entityShow.blaze(input, ctx)` — no await, immediate
 *   access to a Result accessor, should fire.
 */
const propertyDestructuresResultAccessor = (prop: AstNode): boolean => {
  if (prop.type === 'RestElement') {
    return false;
  }
  const { key } = prop as unknown as { key?: AstNode };
  const keyName = identifierName(key);
  return keyName !== null && RESULT_ACCESSOR_PROPERTIES.has(keyName);
};

const objectPatternHasResultAccessorKey = (pattern: AstNode): boolean => {
  const { properties } = pattern as unknown as {
    properties?: readonly AstNode[];
  };
  return properties?.some(propertyDestructuresResultAccessor) ?? false;
};

const getDestructuredResultAccessorDeclarator = (
  blazeCall: AstNode,
  parents: WeakMap<AstNode, AstNode>
): AstNode | null => {
  // Unwrap any wrapping parentheses and branch-position conditionals so
  // `const { isOk } = (trail.blaze(...));` and
  // `const { isOk } = cond ? trail.blaze(...) : fallback;` are treated as
  // `const { isOk } = trail.blaze(...);`.
  const outer = skipParensAndBranchConditionals(blazeCall, parents);
  const parent = parents.get(outer);
  if (!parent || parent.type !== 'VariableDeclarator') {
    return null;
  }
  const { id } = parent as unknown as { id?: AstNode };
  if (!id || id.type !== 'ObjectPattern') {
    return null;
  }
  return objectPatternHasResultAccessorKey(id) ? parent : null;
};

const visitBlazeCall = (node: AstNode, state: AnalyzeState): void => {
  if (!isBlazeCall(node) || isAwaited(node, state.parents)) {
    return;
  }
  if (hasDirectResultAccess(node, state.parents)) {
    reportMissingAwait(node, state);
    return;
  }
  const destructuredDeclarator = getDestructuredResultAccessorDeclarator(
    node,
    state.parents
  );
  if (destructuredDeclarator) {
    reportMissingAwait(destructuredDeclarator, state);
    return;
  }
  recordPendingBinding(node, state);
};

const visitNode = (node: AstNode, state: AnalyzeState): void => {
  visitBlazeCall(node, state);
  checkPendingAccess(node, state);
};

/**
 * Post-order visitor for assignment re-assignment clearing.
 *
 * `handleAssignmentReassignment` must run *after* the RHS subtree has been
 * walked. Otherwise a self-referential `result = result.value` would clear
 * the pending entry before the RHS `result.value` access is observed — the
 * missing-await diagnostic would disappear even though the write produced
 * a non-Result value from the same pending slot.
 */
const visitNodePost = (node: AstNode, state: AnalyzeState): void => {
  handleAssignmentReassignment(node, state);
};

const pushScopeIfBoundary = (node: AstNode, state: AnalyzeState): boolean => {
  if (!isScopeBoundary(node)) {
    return false;
  }
  const kind = scopeKindForNode(node);
  if (kind === 'function') {
    const { bindings, paramBindings } = collectFunctionScopeBindingsEx(node);
    state.scopeStack.push({
      bindings,
      id: state.nextScopeId,
      kind,
      paramBindings,
    });
  } else {
    state.scopeStack.push({
      bindings: collectScopeBindings(node),
      id: state.nextScopeId,
      kind,
    });
  }
  state.nextScopeId += 1;
  return true;
};

const walkChild = (child: unknown, state: AnalyzeState): void => {
  if (child && typeof child === 'object' && (child as AstNode).type) {
    // eslint-disable-next-line no-use-before-define
    walkWithScopes(child as AstNode, state);
  }
};

const walkChildren = (node: AstNode, state: AnalyzeState): void => {
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        walkChild(item, state);
      }
    } else {
      walkChild(val, state);
    }
  }
};

// biome-ignore lint/style/useConst: hoisted for mutual recursion with walkChildren
// eslint-disable-next-line func-style
function walkWithScopes(node: AstNode, state: AnalyzeState): void {
  const pushed = pushScopeIfBoundary(node, state);
  visitNode(node, state);
  walkChildren(node, state);
  visitNodePost(node, state);
  if (pushed) {
    state.scopeStack.pop();
  }
}

const collectProgramBindings = (ast: AstNode): Set<string> => {
  const bindings = new Set<string>();
  const programBody = (ast as unknown as { body?: readonly AstNode[] }).body;
  // Top-level `let`/`const`/function declarations.
  collectBlockScopedStatementListBindings(programBody, bindings);
  // Top-level `var`s are program-scoped; also hoist any `var`s nested
  // inside blocks/loops at program level.
  collectHoistedVarBindings(ast, bindings);
  return bindings;
};

const analyze = (
  ast: AstNode,
  sourceCode: string,
  filePath: string
): readonly WardenDiagnostic[] => {
  const state: AnalyzeState = {
    diagnostics: [],
    filePath,
    nextScopeId: 1,
    parents: buildParentMap(ast),
    pendingByScopeAndName: new Map(),
    reportedAt: new Set(),
    scopeStack: [
      { bindings: collectProgramBindings(ast), id: 0, kind: 'program' },
    ],
    sourceCode,
  };

  walkWithScopes(ast, state);

  return state.diagnostics;
};

/**
 * Flags code that assumes `.blaze()` returns a synchronous result.
 */
export const noSyncResultAssumption: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath) || isFrameworkInternalFile(filePath)) {
      return [];
    }
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return analyze(ast, sourceCode, filePath);
  },
  description:
    'Disallow treating .blaze() as synchronous after normalization. Always await the returned Promise<Result>.',
  name: 'no-sync-result-assumption',
  severity: 'error',
};
