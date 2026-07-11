/** Shared lexical-scope helpers for AST analysis. */

import { ScopeTracker } from 'oxc-walker';
import type { ScopeTrackerNode } from 'oxc-walker';

import type { AstNode, AstScopeContext, AstScopeDeclaration } from './nodes.js';
import { identifierName } from './literals.js';
import { walkChildren, walkWithOxcFacade } from './walk.js';
import type { WalkFn } from './walk.js';

const toScopeDeclaration = (
  declaration: ScopeTrackerNode | null
): AstScopeDeclaration | null => {
  if (!declaration) {
    return null;
  }

  return {
    end: declaration.end,
    node: declaration.node as unknown as AstNode,
    start: declaration.start,
    type: declaration.type,
  };
};

export const walkWithScopeContext = (
  node: unknown,
  visit: (node: AstNode, context: AstScopeContext) => void
): void => {
  const scopeTracker = new ScopeTracker();

  walkWithOxcFacade(
    node,
    (candidate, context) => {
      visit(candidate, {
        ...context,
        currentScope: scopeTracker.getCurrentScope(),
        getDeclaration: (name) =>
          toScopeDeclaration(scopeTracker.getDeclaration(name)),
        isCurrentScopeUnder: (scope) => scopeTracker.isCurrentScopeUnder(scope),
        isDeclared: (name) => scopeTracker.isDeclared(name),
      });
    },
    scopeTracker
  );
};

const NESTED_SCOPE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

const walkScopeInner: WalkFn = (node, visit) => {
  if (!node || typeof node !== 'object') {
    return;
  }
  const n = node as AstNode;
  if (n.type) {
    visit(n);
    if (NESTED_SCOPE_TYPES.has(n.type)) {
      return;
    }
  }
  walkChildren(n, visit, walkScopeInner);
};

/**
 * Walk an AST node tree without descending into nested function scopes.
 * The root node is always traversed; only inner function boundaries are skipped.
 * Useful for resource-access analysis where inner functions may shadow
 * the trail context parameter name.
 */
export const walkScope: WalkFn = (node, visit) => {
  if (!node || typeof node !== 'object') {
    return;
  }
  const n = node as AstNode;
  if (n.type) {
    visit(n);
  }
  walkChildren(n, visit, walkScopeInner);
};

type PatternExpander = (node: AstNode) => readonly AstNode[];

const expandAssignmentPattern: PatternExpander = (node) => {
  const { left } = node as unknown as { left?: AstNode };
  return left ? [left] : [];
};

const expandRestElement: PatternExpander = (node) => {
  const { argument } = node as unknown as { argument?: AstNode };
  return argument ? [argument] : [];
};

const expandArrayPattern: PatternExpander = (node) => {
  const elements =
    (node as unknown as { elements?: readonly (AstNode | null)[] }).elements ??
    [];
  return elements.filter((e): e is AstNode => e !== null);
};

const expandObjectPatternProperty = (prop: AstNode): AstNode | null => {
  if (prop.type === 'RestElement') {
    return prop;
  }
  const { value } = prop as unknown as { value?: AstNode };
  return value ?? null;
};

const expandObjectPattern: PatternExpander = (node) => {
  const properties =
    (node as unknown as { properties?: readonly AstNode[] }).properties ?? [];
  return properties
    .map(expandObjectPatternProperty)
    .filter((n): n is AstNode => n !== null);
};

const PATTERN_EXPANDERS: Record<string, PatternExpander> = {
  ArrayPattern: expandArrayPattern,
  AssignmentPattern: expandAssignmentPattern,
  ObjectPattern: expandObjectPattern,
  RestElement: expandRestElement,
};

const processPatternNode = (
  node: AstNode,
  into: Set<string>,
  stack: AstNode[]
): void => {
  if (node.type === 'Identifier') {
    const { name } = node as unknown as { name?: string };
    if (name) {
      into.add(name);
    }
    return;
  }
  const expand = PATTERN_EXPANDERS[node.type];
  if (expand) {
    stack.push(...expand(node));
  }
};

const addPatternBindingNames = (
  pattern: AstNode | undefined,
  into: Set<string>
): void => {
  if (!pattern) {
    return;
  }
  const stack: AstNode[] = [pattern];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node) {
      processPatternNode(node, into, stack);
    }
  }
};

const addVarDeclarationBindingNames = (
  decl: AstNode,
  into: Set<string>
): void => {
  const declarations =
    (decl as unknown as { declarations?: readonly AstNode[] }).declarations ??
    [];
  for (const d of declarations) {
    addPatternBindingNames((d as unknown as { id?: AstNode }).id, into);
  }
};

const addFunctionOrClassBindingName = (
  node: AstNode,
  into: Set<string>
): void => {
  const { id } = node as unknown as { id?: AstNode };
  const name = identifierName(id);
  if (name) {
    into.add(name);
  }
};

const addBlockStatementBindings = (stmt: AstNode, into: Set<string>): void => {
  if (stmt.type === 'VariableDeclaration') {
    addVarDeclarationBindingNames(stmt, into);
    return;
  }
  if (
    stmt.type === 'FunctionDeclaration' ||
    stmt.type === 'ClassDeclaration' ||
    stmt.type === 'TSEnumDeclaration' ||
    stmt.type === 'TSModuleDeclaration'
  ) {
    addFunctionOrClassBindingName(stmt, into);
  }
};

const collectTopLevelStatementBindings = (
  stmt: AstNode,
  into: Set<string>
): void => {
  if (
    stmt.type === 'ExportNamedDeclaration' ||
    stmt.type === 'ExportDefaultDeclaration'
  ) {
    const { declaration } = stmt as unknown as { declaration?: AstNode };
    if (declaration) {
      collectTopLevelStatementBindings(declaration, into);
    }
    return;
  }
  addBlockStatementBindings(stmt, into);
};

const FUNCTION_BOUNDARY_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'StaticBlock',
]);

export const forEachAstChild = (
  node: AstNode,
  visit: (child: AstNode) => void
): void => {
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && (item as AstNode).type) {
          visit(item as AstNode);
        }
      }
    } else if (val && typeof val === 'object' && (val as AstNode).type) {
      visit(val as AstNode);
    }
  }
};

const recordHoistedBinding = (
  node: AstNode,
  into: Set<string>,
  inNestedBlock: boolean
): void => {
  if (node.type === 'VariableDeclaration') {
    const { kind } = node as unknown as { kind?: string };
    if (kind === 'var') {
      addVarDeclarationBindingNames(node, into);
    }
    return;
  }
  // In strict/module code, function/class/enum/module declarations inside a
  // nested block (`if { function foo() {} }`, `switch` case, etc.) are
  // block-scoped. Only hoist them to the enclosing function frame when they
  // sit directly in the function body, not inside a further block.
  if (inNestedBlock) {
    return;
  }
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'TSEnumDeclaration' ||
    node.type === 'TSModuleDeclaration'
  ) {
    addFunctionOrClassBindingName(node, into);
  }
};

const NESTED_BLOCK_BOUNDARY_TYPES = new Set([
  'BlockStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'SwitchStatement',
  'CatchClause',
]);

const visitForHoisted = (
  node: AstNode,
  isRoot: boolean,
  into: Set<string>,
  inNestedBlock: boolean
): void => {
  if (!isRoot && FUNCTION_BOUNDARY_TYPES.has(node.type)) {
    return;
  }
  recordHoistedBinding(node, into, inNestedBlock);
  const childInNestedBlock =
    inNestedBlock || (!isRoot && NESTED_BLOCK_BOUNDARY_TYPES.has(node.type));
  forEachAstChild(node, (child) => {
    visitForHoisted(child, false, into, childInNestedBlock);
  });
};

/**
 * Collect `var` declarations and `function` declarations hoisted to the
 * nearest function scope from anywhere inside `root`, without composing a
 * nested function or static-block boundary.
 */
const collectHoistedVarAndFunctionBindings = (
  root: AstNode,
  into: Set<string>
): void => {
  visitForHoisted(root, true, into, false);
};

type FrameCollector = (node: AstNode, into: Set<string>) => void;

const collectProgramFrame: FrameCollector = (node, into) => {
  const body = (node as unknown as { body?: readonly AstNode[] }).body ?? [];
  for (const stmt of body) {
    collectTopLevelStatementBindings(stmt, into);
  }
};

const collectFunctionFrame: FrameCollector = (node, into) => {
  const params =
    (node as unknown as { params?: readonly AstNode[] }).params ?? [];
  for (const param of params) {
    addPatternBindingNames(param, into);
  }
  // Hoisted vars and function declarations inside the body live in the
  // function's var-environment. A `var ns = ...;` inside an `if` still
  // shadows a module-level `ns` for the whole function.
  const { body } = node as unknown as { body?: AstNode };
  if (body) {
    collectHoistedVarAndFunctionBindings(body, into);
  }
};

const collectBlockFrame: FrameCollector = (node, into) => {
  const body = (node as unknown as { body?: readonly AstNode[] }).body ?? [];
  for (const stmt of body) {
    addBlockStatementBindings(stmt, into);
  }
};

const collectForStatementFrame: FrameCollector = (node, into) => {
  const { init } = node as unknown as { init?: AstNode };
  if (init && init.type === 'VariableDeclaration') {
    addVarDeclarationBindingNames(init, into);
  }
};

const collectForInOfFrame: FrameCollector = (node, into) => {
  const { left } = node as unknown as { left?: AstNode };
  if (left && left.type === 'VariableDeclaration') {
    addVarDeclarationBindingNames(left, into);
  }
};

const collectSwitchStatementFrame: FrameCollector = (node, into) => {
  // `switch` shares one scope across every case. A binding in one case
  // shadows the namespace across sibling cases (fall-through or otherwise).
  const cases = (node as unknown as { cases?: readonly AstNode[] }).cases ?? [];
  for (const c of cases) {
    const consequent =
      (c as unknown as { consequent?: readonly AstNode[] }).consequent ?? [];
    for (const stmt of consequent) {
      addBlockStatementBindings(stmt, into);
    }
  }
};

const collectCatchClauseFrame: FrameCollector = (node, into) => {
  const { param } = node as unknown as { param?: AstNode };
  addPatternBindingNames(param, into);
};

const collectClassExpressionFrame: FrameCollector = (node, into) => {
  // A named `class expr` (`const C = class foo { ... }`) binds its own name
  // inside its body only. ClassDeclaration names are hoisted into the
  // enclosing block/program frame instead, so only class *expression* names
  // need their own frame here.
  addFunctionOrClassBindingName(node, into);
};

export const SCOPE_FRAME_COLLECTORS: Record<string, FrameCollector> = {
  ArrowFunctionExpression: collectFunctionFrame,
  BlockStatement: collectBlockFrame,
  CatchClause: collectCatchClauseFrame,
  ClassExpression: collectClassExpressionFrame,
  ForInStatement: collectForInOfFrame,
  ForOfStatement: collectForInOfFrame,
  ForStatement: collectForStatementFrame,
  // oxc-parser emits `FunctionBody` for `function` expression bodies; without
  // this entry, a `const ns = ...` at the top of a function-expression body
  // would not push a scope frame, and a module-level namespace import with
  // the same name would be incorrectly recognized inside.
  FunctionBody: collectBlockFrame,
  FunctionDeclaration: collectFunctionFrame,
  FunctionExpression: collectFunctionFrame,
  Program: collectProgramFrame,
  StaticBlock: collectBlockFrame,
  SwitchStatement: collectSwitchStatementFrame,
};

/**
 * Collect the identifier bindings introduced *directly* by a scope frame
 * node. Scope frames correspond to JS lexical scopes (function bodies, blocks,
 * catch clauses, for-statements, switch statements, module/script roots).
 */
export const collectScopeFrameBindings = (
  node: AstNode
): ReadonlySet<string> => {
  const names = new Set<string>();
  const collector = SCOPE_FRAME_COLLECTORS[node.type];
  if (collector) {
    collector(node, names);
  }
  return names;
};

export type ScopeAwareVisitor = (
  node: AstNode,
  scopes: readonly ReadonlySet<string>[]
) => void;

export interface ScopeWalkOptions {
  readonly initialScopes?: readonly ReadonlySet<string>[];
  readonly stopAtNestedFunctions?: boolean;
}

const asAstNode = (node: unknown): AstNode | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const astNode = node as AstNode;
  return astNode.type ? astNode : null;
};

/**
 * Walk an AST subtree while threading lexical scope bindings through each
 * visit. Callers can seed outer scopes and optionally stop at nested function
 * boundaries when only the current implementation body should be analyzed.
 */
export const walkWithScopes = (
  node: unknown,
  visit: ScopeAwareVisitor,
  options: ScopeWalkOptions = {}
): void => {
  const root = asAstNode(node);
  if (!root) {
    return;
  }

  const stack = [...(options.initialScopes ?? [])];

  const walkNode = (current: AstNode, isRoot: boolean): void => {
    if (
      !isRoot &&
      options.stopAtNestedFunctions &&
      FUNCTION_BOUNDARY_TYPES.has(current.type)
    ) {
      return;
    }

    const isScope = current.type in SCOPE_FRAME_COLLECTORS;
    if (isScope) {
      stack.unshift(collectScopeFrameBindings(current));
    }

    try {
      visit(current, stack);
      forEachAstChild(current, (child) => {
        walkNode(child, false);
      });
    } finally {
      if (isScope) {
        stack.shift();
      }
    }
  };

  walkNode(root, true);
};

export const isShadowed = (
  receiverName: string,
  scopeStack: readonly ReadonlySet<string>[]
): boolean => {
  // The module-level Program frame is the last entry and contains the
  // namespace imports themselves. A "shadow" must come from a frame *inside*
  // that one — i.e. any frame except the outermost.
  for (let i = 0; i < scopeStack.length - 1; i += 1) {
    const frame = scopeStack[i];
    if (frame?.has(receiverName)) {
      return true;
    }
  }
  return false;
};

/**
 * Return `true` when `node` is a non-computed member access (`a.b` /
 * `a?.b`) and `false` for anything else, including computed access
 * (`a[b]`) or non-member nodes. Exported as the canonical predicate so
 * rule modules do not re-implement the check.
 *
 * @remarks
 * Declared near the top of the file so the scope walker can use it
 * without hitting `no-use-before-define`. A few sibling helpers in this
 * module still inline the same shape under different local names for
 * historical reasons; prefer this export for new call sites.
 */
export const isMemberAccessNonComputed = (node: AstNode): boolean => {
  if (
    node.type !== 'MemberExpression' &&
    node.type !== 'StaticMemberExpression'
  ) {
    return false;
  }
  return (node as unknown as { computed?: boolean }).computed !== true;
};

export const isScopeFrameNode = (node: AstNode): boolean =>
  node.type in SCOPE_FRAME_COLLECTORS;
