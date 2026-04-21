/**
 * Finds implementations that return raw values instead of `Result`.
 *
 * Uses AST parsing to find `blaze:` bodies and check that
 * every return statement returns Result.ok(), Result.err(), ctx.cross(),
 * or a tracked Result-typed variable.
 */

import { dirname, isAbsolute, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  findBlazeBodies,
  findTrailDefinitions,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Member expression helpers
// ---------------------------------------------------------------------------

/** Extract object.property names from a MemberExpression callee. */
const extractMemberNames = (
  callee: AstNode
): { objName: string | undefined; propName: string | undefined } => {
  const obj = (callee as unknown as { object?: AstNode }).object;
  const prop = (callee as unknown as { property?: AstNode }).property;
  const objName =
    obj?.type === 'Identifier'
      ? (obj as unknown as { name: string }).name
      : undefined;
  const propName =
    prop?.type === 'Identifier'
      ? (prop as unknown as { name: string }).name
      : undefined;
  return { objName, propName };
};

const isMemberExpression = (callee: AstNode): boolean =>
  callee.type === 'StaticMemberExpression' ||
  callee.type === 'MemberExpression';

const isResultMemberCall = (callee: AstNode): boolean => {
  if (!isMemberExpression(callee)) {
    return false;
  }
  const { objName, propName } = extractMemberNames(callee);
  if (objName === 'Result' && (propName === 'ok' || propName === 'err')) {
    return true;
  }
  if (objName === 'ctx' && propName === 'cross') {
    return true;
  }
  return propName === 'blaze';
};

// ---------------------------------------------------------------------------
// Expression classification
// ---------------------------------------------------------------------------

/** Check if an expression node is an allowed Result-returning expression. */
const isResultExpression = (node: AstNode): boolean => {
  if (node.type === 'CallExpression') {
    const callee = node['callee'] as AstNode | undefined;
    if (!callee) {
      return false;
    }
    return isResultMemberCall(callee);
  }

  if (node.type === 'AwaitExpression') {
    const arg = (node as unknown as { argument?: AstNode }).argument;
    return arg ? isResultExpression(arg) : false;
  }

  return false;
};

/** Map of namespace-import local name to the set of Result-helper names exported by the target module. */
type NamespaceHelperMap = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Check whether a namespace-member call like `ns.helper(...)` resolves to a
 * known Result helper.
 *
 * When a non-empty `scopes` stack is provided, the namespace binding must not
 * be shadowed by a parameter or local declaration in any enclosing scope at
 * the call site. Without this check, any local `ns` (e.g. a blaze parameter
 * named `ns`, or `const ns = ...` inside the body) would be misread as the
 * module-scope namespace import.
 */
const isNamespaceHelperMemberCall = (
  callee: AstNode,
  namespaceHelpers: NamespaceHelperMap,
  scopes: readonly ReadonlySet<string>[] = []
): boolean => {
  if (!isMemberExpression(callee)) {
    return false;
  }
  const { objName, propName } = extractMemberNames(callee);
  if (!(objName && propName)) {
    return false;
  }
  for (const scope of scopes) {
    if (scope.has(objName)) {
      // Nearest binding is a local, not the namespace import.
      return false;
    }
  }
  return namespaceHelpers.get(objName)?.has(propName) ?? false;
};

/** Check if a node is a call to a known Result-returning helper. */
const isHelperCall = (
  node: AstNode,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap = new Map(),
  scopes: readonly ReadonlySet<string>[] = []
): boolean => {
  const target =
    node.type === 'AwaitExpression'
      ? ((node as unknown as { argument?: AstNode }).argument ?? null)
      : node;

  if (!target || target.type !== 'CallExpression') {
    return false;
  }

  const callee = target['callee'] as AstNode | undefined;
  if (callee?.type === 'Identifier') {
    const { name } = callee as unknown as { name: string };
    return helperNames.has(name);
  }

  return callee
    ? isNamespaceHelperMemberCall(callee, namespaceHelpers, scopes)
    : false;
};

/** Unwrap an optional AwaitExpression to get the inner identifier name. */
const resolveIdentifierName = (node: AstNode): string | null => {
  if (node.type === 'Identifier') {
    return (node as unknown as { name: string }).name;
  }
  if (node.type === 'AwaitExpression') {
    const inner = (node as unknown as { argument?: AstNode }).argument;
    if (inner?.type === 'Identifier') {
      return (inner as unknown as { name: string }).name;
    }
  }
  return null;
};

/** Check if a return argument is an allowed Result value. */
const isAllowedReturnArgument = (
  argument: AstNode,
  helperNames: ReadonlySet<string>,
  resultVars: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  scopes: readonly ReadonlySet<string>[] = []
): boolean => {
  if (isResultExpression(argument)) {
    return true;
  }
  if (isHelperCall(argument, helperNames, namespaceHelpers, scopes)) {
    return true;
  }

  const varName = resolveIdentifierName(argument);
  return varName !== null && resultVars.has(varName);
};

// ---------------------------------------------------------------------------
// Variable tracking
// ---------------------------------------------------------------------------

/** Track a VariableDeclarator, adding to resultVars if it produces a Result. */
const trackResultVariable = (node: AstNode, resultVars: Set<string>): void => {
  const { init } = node as unknown as { init?: AstNode };
  const { id } = node as unknown as { id?: AstNode };
  if (init && id?.type === 'Identifier') {
    const { name } = id as unknown as { name: string };
    if (isResultExpression(init)) {
      resultVars.add(name);
    }
  }
};

// ---------------------------------------------------------------------------
// Shallow walk (stops at nested function boundaries)
// ---------------------------------------------------------------------------

const FUNCTION_BOUNDARY_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

/** Check if a value is a function-boundary AST node that should not be recursed into. */
const isFunctionBoundary = (val: unknown): boolean =>
  !!val &&
  typeof val === 'object' &&
  FUNCTION_BOUNDARY_TYPES.has((val as AstNode).type);

// ---------------------------------------------------------------------------
// Scope tracking (namespace-shadowing awareness)
// ---------------------------------------------------------------------------

/**
 * Per-pattern-type expanders yielding the nested binding nodes to keep
 * visiting. Identifier is the base case; all other patterns bottom out at
 * Identifier nodes through one or more expansion steps.
 */
const expandObjectPatternProperty = (prop: AstNode): readonly AstNode[] => {
  if (prop.type === 'Property') {
    const { value } = prop as unknown as { value?: AstNode };
    return value ? [value] : [];
  }
  if (prop.type === 'RestElement') {
    const { argument } = prop as unknown as { argument?: AstNode };
    return argument ? [argument] : [];
  }
  return [];
};

const PATTERN_EXPANDERS: Record<string, (node: AstNode) => readonly AstNode[]> =
  {
    ArrayPattern: (node) => {
      const elements =
        (node as unknown as { elements?: readonly (AstNode | null)[] })
          .elements ?? [];
      return elements.filter((el): el is AstNode => el !== null);
    },
    AssignmentPattern: (node) => {
      const { left } = node as unknown as { left?: AstNode };
      return left ? [left] : [];
    },
    ObjectPattern: (node) => {
      const properties =
        (node as unknown as { properties?: readonly AstNode[] }).properties ??
        [];
      return properties.flatMap(expandObjectPatternProperty);
    },
    RestElement: (node) => {
      const { argument } = node as unknown as { argument?: AstNode };
      return argument ? [argument] : [];
    },
  };

/**
 * Collect identifier names introduced by a binding pattern (parameter,
 * `const`/`let`/`var` declarator target, etc.). Iterative worklist over
 * {@link PATTERN_EXPANDERS}: each expander yields one level of child
 * patterns and the loop bottoms out at `Identifier` nodes.
 */
const visitPatternNode = (
  current: AstNode,
  into: Set<string>,
  worklist: AstNode[]
): void => {
  if (current.type === 'Identifier') {
    const { name } = current as unknown as { name?: string };
    if (name) {
      into.add(name);
    }
    return;
  }
  const expand = PATTERN_EXPANDERS[current.type];
  if (expand) {
    worklist.push(...expand(current));
  }
};

const collectPatternNames = (
  pattern: AstNode | undefined,
  into: Set<string>
): void => {
  if (!pattern) {
    return;
  }
  const worklist: AstNode[] = [pattern];
  while (worklist.length > 0) {
    const current = worklist.pop();
    if (current) {
      visitPatternNode(current, into, worklist);
    }
  }
};

const addVariableDeclarationNames = (
  stmt: AstNode,
  into: Set<string>
): void => {
  const declarations =
    (stmt as unknown as { declarations?: readonly AstNode[] }).declarations ??
    [];
  for (const decl of declarations) {
    collectPatternNames((decl as unknown as { id?: AstNode }).id, into);
  }
};

const addFunctionDeclarationName = (stmt: AstNode, into: Set<string>): void => {
  const { id } = stmt as unknown as { id?: AstNode };
  if (id?.type !== 'Identifier') {
    return;
  }
  const { name } = id as unknown as { name?: string };
  if (name) {
    into.add(name);
  }
};

/** Collect the declared identifier names that a BlockStatement introduces. */
const collectBlockBindingNames = (block: AstNode): ReadonlySet<string> => {
  const names = new Set<string>();
  const body = (block as unknown as { body?: readonly AstNode[] }).body ?? [];
  for (const stmt of body) {
    if (stmt.type === 'VariableDeclaration') {
      addVariableDeclarationNames(stmt, names);
    } else if (stmt.type === 'FunctionDeclaration') {
      addFunctionDeclarationName(stmt, names);
    }
  }
  return names;
};

/**
 * Collect bindings introduced by a `for (init; ...; ...)` statement's init
 * clause. Only `VariableDeclaration` inits introduce new bindings; identifier
 * or expression inits reference existing ones.
 */
const collectForStatementBindingNames = (
  node: AstNode
): ReadonlySet<string> => {
  const names = new Set<string>();
  const { init } = node as unknown as { init?: AstNode };
  if (init && init.type === 'VariableDeclaration') {
    addVariableDeclarationNames(init, names);
  }
  return names;
};

/**
 * Collect bindings introduced by a `for (left of right)` / `for (left in right)`
 * statement's left-hand side. Only `VariableDeclaration` lefts introduce new
 * bindings.
 */
const collectForInOfBindingNames = (node: AstNode): ReadonlySet<string> => {
  const names = new Set<string>();
  const { left } = node as unknown as { left?: AstNode };
  if (left && left.type === 'VariableDeclaration') {
    addVariableDeclarationNames(left, names);
  }
  return names;
};

/**
 * Collect the binding introduced by a `catch (param)` clause. The param may be
 * an identifier or a destructuring pattern; `catch {}` (no param) contributes
 * nothing.
 */
const collectCatchClauseBindingNames = (node: AstNode): ReadonlySet<string> => {
  const names = new Set<string>();
  const { param } = node as unknown as { param?: AstNode };
  collectPatternNames(param, names);
  return names;
};

const SCOPE_FRAME_COLLECTORS: Record<
  string,
  (node: AstNode) => ReadonlySet<string>
> = {
  BlockStatement: collectBlockBindingNames,
  CatchClause: collectCatchClauseBindingNames,
  ForInStatement: collectForInOfBindingNames,
  ForOfStatement: collectForInOfBindingNames,
  ForStatement: collectForStatementBindingNames,
};

/** Collect parameter names from a function-like node. */
const collectFunctionParamNames = (fn: AstNode): ReadonlySet<string> => {
  const names = new Set<string>();
  const params =
    (fn as unknown as { params?: readonly AstNode[] }).params ?? [];
  for (const param of params) {
    collectPatternNames(param, names);
  }
  return names;
};

type ScopeVisitor = (
  node: AstNode,
  scopes: readonly ReadonlySet<string>[]
) => void;

/** Recurse into a single AST property value, skipping function boundaries. */
const recurseIntoChildValue = (
  val: unknown,
  scopes: ReadonlySet<string>[],
  visit: ScopeVisitor
): void => {
  if (Array.isArray(val)) {
    for (const item of val) {
      if (!isFunctionBoundary(item)) {
        // eslint-disable-next-line no-use-before-define
        walkShallowWithScopes(item, scopes, visit);
      }
    }
    return;
  }
  if (
    val &&
    typeof val === 'object' &&
    (val as AstNode).type &&
    !isFunctionBoundary(val)
  ) {
    // eslint-disable-next-line no-use-before-define
    walkShallowWithScopes(val, scopes, visit);
  }
};

/**
 * Shallow walker that threads a scope-frame stack through the traversal so
 * visitors can resolve identifier shadowing. Stops at nested function
 * boundaries (their returns are not implementation-level).
 *
 * The stack is ordered inner-to-outer (index 0 = innermost) so callers can
 * iterate forwards and bail on the first declaring scope.
 */
const visitNodeWithScopes = (
  n: AstNode,
  scopes: ReadonlySet<string>[],
  visit: ScopeVisitor
): void => {
  visit(n, scopes);
  for (const val of Object.values(n)) {
    recurseIntoChildValue(val, scopes, visit);
  }
};

const asAstNode = (node: unknown): AstNode | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const n = node as AstNode;
  return n.type ? n : null;
};

const walkShallowWithScopes = (
  node: unknown,
  scopes: ReadonlySet<string>[],
  visit: ScopeVisitor
): void => {
  const n = asAstNode(node);
  if (!n) {
    return;
  }
  const collector = SCOPE_FRAME_COLLECTORS[n.type];
  if (collector) {
    scopes.unshift(collector(n));
  }
  try {
    visitNodeWithScopes(n, scopes, visit);
  } finally {
    if (collector) {
      scopes.shift();
    }
  }
};

// ---------------------------------------------------------------------------
// Return statement checking
// ---------------------------------------------------------------------------

/** Check return statements in a block body for non-Result returns. */
const checkReturnStatements = (
  blockBody: AstNode,
  trailInfo: { id: string; label: string },
  filePath: string,
  sourceCode: string,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  diagnostics: WardenDiagnostic[],
  implParams: ReadonlySet<string> = new Set<string>()
): void => {
  const resultVars = new Set<string>();
  // Seed the stack with the blaze's own parameter names so a parameter that
  // shadows a namespace import is visible to every nested block-scope visit.
  const scopes: ReadonlySet<string>[] = implParams.size > 0 ? [implParams] : [];

  walkShallowWithScopes(blockBody, scopes, (node, currentScopes) => {
    if (node.type === 'VariableDeclarator') {
      trackResultVariable(node, resultVars);
    }

    if (node.type !== 'ReturnStatement') {
      return;
    }

    const { argument } = node as unknown as { argument?: AstNode };
    // Bare return — not a value return
    if (!argument) {
      return;
    }

    if (
      isAllowedReturnArgument(
        argument,
        helperNames,
        resultVars,
        namespaceHelpers,
        currentScopes
      )
    ) {
      return;
    }

    diagnostics.push({
      filePath,
      line: offsetToLine(sourceCode, node.start),
      message: `${trailInfo.label} "${trailInfo.id}" implementation must return Result.ok(...) or Result.err(...), not a raw value.`,
      rule: 'implementation-returns-result',
      severity: 'error',
    });
  });
};

// ---------------------------------------------------------------------------
// Result helper name collection
// ---------------------------------------------------------------------------

/** Check if a return type annotation mentions Result. */
const hasResultReturnType = (node: AstNode, sourceCode: string): boolean => {
  const { returnType } = node as unknown as { returnType?: AstNode };
  if (!returnType) {
    return false;
  }
  const annotationText = sourceCode.slice(returnType.start, returnType.end);
  return /\bResult\s*</.test(annotationText);
};

const isFunctionLikeExpression = (node: AstNode): boolean =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

/** Collect names of top-level functions/consts with explicit Result return types. */
const collectResultHelperNames = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const names = new Set<string>();

  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator') {
      const { id } = node as unknown as { id?: AstNode };
      const { init } = node as unknown as { init?: AstNode };
      if (
        id?.type === 'Identifier' &&
        init &&
        isFunctionLikeExpression(init) &&
        hasResultReturnType(init, sourceCode)
      ) {
        names.add((id as unknown as { name: string }).name);
      }
    }

    if (node.type === 'FunctionDeclaration') {
      const { id } = node as unknown as { id?: AstNode };
      if (id?.type === 'Identifier' && hasResultReturnType(node, sourceCode)) {
        names.add((id as unknown as { name: string }).name);
      }
    }
  });

  return names;
};

// ---------------------------------------------------------------------------
// Imported Result helper resolution
// ---------------------------------------------------------------------------

/**
 * Per-target-file cache of exported Result-helper names keyed by the absolute
 * target path. Saves re-parsing when multiple rule invocations resolve the
 * same file during a single warden run.
 *
 * @remarks
 * Long-running processes calling `implementationReturnsResult.check` after
 * source files change (e.g. watch mode, editor language servers) should call
 * `clearImplementationReturnsResultCache()` between runs to avoid returning
 * stale helper-name sets. The cache is intentionally not auto-invalidated per
 * invocation — that would defeat its purpose within a single warden run.
 */
const targetFileResultExportCache = new Map<string, ReadonlySet<string>>();

/**
 * Clear the module-level cache used by the `implementation-returns-result`
 * rule to remember which exported names on a target file carry a `Result<...>`
 * return annotation.
 *
 * Call this between runs in long-lived processes where the set of Trails
 * source files may have changed on disk since the last check.
 */
export const clearImplementationReturnsResultCache = (): void => {
  targetFileResultExportCache.clear();
};

interface ImportBinding {
  /** Local alias used in the importing file. */
  readonly localName: string;
  /** Original exported name from the target module. */
  readonly importedName: string;
  /** Raw import source specifier (e.g. './foo.js'). */
  readonly source: string;
}

const getImportSourceValue = (node: AstNode): string | null => {
  const sourceNode = (node as unknown as { source?: AstNode }).source;
  const sourceValue = sourceNode
    ? (sourceNode as unknown as { value?: unknown }).value
    : undefined;
  return typeof sourceValue === 'string' ? sourceValue : null;
};

const extractIdentifierName = (node: AstNode | undefined): string | null =>
  node?.type === 'Identifier'
    ? ((node as unknown as { name: string }).name ?? null)
    : null;

const buildDefaultImportBinding = (
  specifier: AstNode,
  source: string
): ImportBinding | null => {
  const { local } = specifier as unknown as { local?: AstNode };
  const localName = extractIdentifierName(local);
  if (!localName) {
    return null;
  }
  return { importedName: 'default', localName, source };
};

const buildNamedImportBinding = (
  specifier: AstNode,
  source: string
): ImportBinding | null => {
  const { local, imported } = specifier as unknown as {
    local?: AstNode;
    imported?: AstNode;
  };
  const localName = extractIdentifierName(local);
  const importedName = extractIdentifierName(imported) ?? localName;
  if (!(localName && importedName)) {
    return null;
  }
  return { importedName, localName, source };
};

/**
 * @remarks
 * `import foo from './bar.js'` is treated as a re-export of `default` so the
 * target file's `export default` declaration is considered as a potential
 * Result helper. `import * as ns from './bar.js'` is handled separately by
 * `collectNamespaceHelperImports`, which maps the namespace binding to the
 * target's exported Result-helper names so `ns.helper(...)` member calls are
 * recognized.
 */
const buildImportBinding = (
  specifier: AstNode,
  source: string
): ImportBinding | null => {
  if (specifier.type === 'ImportDefaultSpecifier') {
    return buildDefaultImportBinding(specifier, source);
  }
  if (specifier.type === 'ImportSpecifier') {
    return buildNamedImportBinding(specifier, source);
  }
  return null;
};

const collectBindingsFromImportDeclaration = (
  node: AstNode
): readonly ImportBinding[] => {
  const source = getImportSourceValue(node);
  if (!source) {
    return [];
  }
  const specifiers =
    (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
  return specifiers.flatMap((specifier) => {
    const binding = buildImportBinding(specifier, source);
    return binding ? [binding] : [];
  });
};

/** Collect `import { foo as bar } from './...'` bindings keyed by local name. */
const collectResolvableImports = (ast: AstNode): readonly ImportBinding[] => {
  const imports: ImportBinding[] = [];
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      imports.push(...collectBindingsFromImportDeclaration(node));
    }
  });
  return imports;
};

/**
 * Resolve a relative import source specifier to an absolute on-disk file path,
 * or null when the source is not a relative path we can resolve locally.
 *
 * Handles `.js` -> `.ts` rewriting (the convention in this repo), plain `.ts`
 * imports, and extensionless paths.
 */
const buildResolutionCandidates = (resolved: string): readonly string[] => {
  if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) {
    return [resolved];
  }
  if (resolved.endsWith('.js')) {
    return [
      resolved.replace(/\.js$/, '.ts'),
      resolved.replace(/\.js$/, '.tsx'),
      resolved,
    ];
  }
  if (resolved.endsWith('.jsx')) {
    return [resolved.replace(/\.jsx$/, '.tsx'), resolved];
  }
  return [`${resolved}.ts`, `${resolved}.tsx`];
};

const resolveRelativeImportPath = (
  source: string,
  fromFile: string
): string | null => {
  if (!(source.startsWith('./') || source.startsWith('../'))) {
    return null;
  }
  const baseDir = isAbsolute(fromFile)
    ? dirname(fromFile)
    : dirname(resolve(fromFile));
  const resolved = resolve(baseDir, source);
  return (
    buildResolutionCandidates(resolved).find((candidate) =>
      existsSync(candidate)
    ) ?? null
  );
};

/** Extract the declaration wrapped by an ExportNamedDeclaration, if any. */
const getExportedDeclaration = (node: AstNode): AstNode | null => {
  if (node.type !== 'ExportNamedDeclaration') {
    return null;
  }
  const decl = (node as unknown as { declaration?: AstNode }).declaration;
  return decl ?? null;
};

const addExportedVariableResultHelper = (
  decl: AstNode,
  source: string,
  collected: Set<string>
): void => {
  const declarations =
    (decl['declarations'] as readonly AstNode[] | undefined) ?? [];
  for (const declarator of declarations) {
    const { id, init } = declarator as unknown as {
      id?: AstNode;
      init?: AstNode;
    };
    const name = extractIdentifierName(id);
    if (
      name &&
      init &&
      isFunctionLikeExpression(init) &&
      hasResultReturnType(init, source)
    ) {
      collected.add(name);
    }
  }
};

const addExportedFunctionResultHelper = (
  decl: AstNode,
  source: string,
  collected: Set<string>
): void => {
  const name = extractIdentifierName((decl as unknown as { id?: AstNode }).id);
  if (name && hasResultReturnType(decl, source)) {
    collected.add(name);
  }
};

// ---------------------------------------------------------------------------
// Same-file declaration index (for specifier re-exports without a source)
// ---------------------------------------------------------------------------

/**
 * Index a file's top-level function-like declarations (both exported-inline
 * and plain) by name to the declaration node, so we can look up the original
 * binding referenced by a specifier re-export like `export { helper }`.
 *
 * Each entry carries the init/declaration node so the caller can check the
 * return-type annotation without re-walking.
 */
type DeclarationIndex = ReadonlyMap<string, AstNode>;

const indexVariableDeclarationInto = (
  decl: AstNode,
  index: Map<string, AstNode>
): void => {
  const declarators =
    (decl['declarations'] as readonly AstNode[] | undefined) ?? [];
  for (const declarator of declarators) {
    const { id, init } = declarator as unknown as {
      id?: AstNode;
      init?: AstNode;
    };
    const name = extractIdentifierName(id);
    if (name && init && isFunctionLikeExpression(init)) {
      index.set(name, init);
    }
  }
};

const indexFunctionDeclarationInto = (
  decl: AstNode,
  index: Map<string, AstNode>
): void => {
  const name = extractIdentifierName((decl as unknown as { id?: AstNode }).id);
  if (name) {
    index.set(name, decl);
  }
};

const indexDeclarationInto = (
  decl: AstNode | null | undefined,
  index: Map<string, AstNode>
): void => {
  if (!decl) {
    return;
  }
  if (decl.type === 'VariableDeclaration') {
    indexVariableDeclarationInto(decl, index);
  } else if (decl.type === 'FunctionDeclaration') {
    indexFunctionDeclarationInto(decl, index);
  }
};

const indexBodyNodeInto = (
  node: AstNode,
  index: Map<string, AstNode>
): void => {
  if (node.type === 'ExportNamedDeclaration') {
    indexDeclarationInto(getExportedDeclaration(node), index);
    return;
  }
  indexDeclarationInto(node, index);
};

const indexLocalDeclarations = (ast: AstNode): DeclarationIndex => {
  const index = new Map<string, AstNode>();
  const program = ast as unknown as { body?: readonly AstNode[] };
  const bodyNodes = program.body ?? [];
  for (const node of bodyNodes) {
    indexBodyNodeInto(node, index);
  }
  return index;
};

// ---------------------------------------------------------------------------
// Export-specifier handling
// ---------------------------------------------------------------------------

interface ExportSpecifierInfo {
  /** Name this export is exposed as to consumers (after `as` alias). */
  readonly exportedName: string;
  /** Name referenced inside the re-export (`helper` in `export { helper }`). */
  readonly localName: string;
  /** True when the specifier is `default` (i.e. `export { default as X }`). */
  readonly isDefault: boolean;
}

const getSpecifierNameNode = (
  spec: AstNode,
  key: 'exported' | 'local'
): string | null => {
  const node = (spec as unknown as Record<string, AstNode | undefined>)[key];
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return (node as unknown as { name?: string }).name ?? null;
  }
  // Support string-literal specifiers (`export { "default" as X }`, etc).
  const { value } = node as unknown as { value?: unknown };
  return typeof value === 'string' ? value : null;
};

const buildExportSpecifierInfo = (
  spec: AstNode
): ExportSpecifierInfo | null => {
  if (spec.type !== 'ExportSpecifier') {
    return null;
  }
  const localName = getSpecifierNameNode(spec, 'local');
  const exportedName = getSpecifierNameNode(spec, 'exported') ?? localName;
  if (!(localName && exportedName)) {
    return null;
  }
  return {
    exportedName,
    isDefault: localName === 'default',
    localName,
  };
};

const getExportDefaultDeclaration = (ast: AstNode): AstNode | null => {
  const program = ast as unknown as { body?: readonly AstNode[] };
  const bodyNodes = program.body ?? [];
  for (const node of bodyNodes) {
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = (node as unknown as { declaration?: AstNode }).declaration;
      return decl ?? null;
    }
  }
  return null;
};

// Bounded recursion: one transitive hop through `export { ... } from`.
const MAX_RERESOLVE_DEPTH = 1;

/** Check whether a local declaration node has a `Result<...>` return annotation. */
const isResultHelperDeclaration = (
  declarationNode: AstNode | undefined,
  source: string
): boolean => {
  if (!declarationNode) {
    return false;
  }
  if (isFunctionLikeExpression(declarationNode)) {
    return hasResultReturnType(declarationNode, source);
  }
  if (declarationNode.type === 'FunctionDeclaration') {
    return hasResultReturnType(declarationNode, source);
  }
  return false;
};

/** Resolve an `export default ...` declaration, following one identifier hop. */
const checkDefaultDeclarationIsResultHelper = (
  defaultDecl: AstNode,
  targetSource: string,
  targetLocalDeclarations: DeclarationIndex
): boolean => {
  if (isResultHelperDeclaration(defaultDecl, targetSource)) {
    return true;
  }
  if (defaultDecl.type === 'Identifier') {
    const name = extractIdentifierName(defaultDecl);
    const referenced = name ? targetLocalDeclarations.get(name) : undefined;
    return isResultHelperDeclaration(referenced, targetSource);
  }
  return false;
};

interface LoadedTargetFile {
  readonly ast: AstNode;
  readonly source: string;
  readonly localDeclarations: DeclarationIndex;
}

const loadTargetFile = (targetPath: string): LoadedTargetFile | null => {
  try {
    const source = readFileSync(targetPath, 'utf8');
    const ast = parse(targetPath, source) as AstNode | null;
    if (!ast) {
      return null;
    }
    return {
      ast,
      localDeclarations: indexLocalDeclarations(ast),
      source,
    };
  } catch {
    return null;
  }
};

interface ReExportContext {
  readonly loadedTarget: LoadedTargetFile | null;
  readonly downstreamResultNames: ReadonlySet<string>;
}

const applyDefaultSpecifier = (
  info: ExportSpecifierInfo,
  loadedTarget: LoadedTargetFile | null,
  collected: Set<string>
): void => {
  if (!loadedTarget) {
    return;
  }
  const defaultDecl = getExportDefaultDeclaration(loadedTarget.ast);
  if (!defaultDecl) {
    return;
  }
  if (
    checkDefaultDeclarationIsResultHelper(
      defaultDecl,
      loadedTarget.source,
      loadedTarget.localDeclarations
    )
  ) {
    collected.add(info.exportedName);
  }
};

const applySpecifierInfo = (
  info: ExportSpecifierInfo,
  ctx: ReExportContext,
  collected: Set<string>
): void => {
  if (info.isDefault) {
    applyDefaultSpecifier(info, ctx.loadedTarget, collected);
    return;
  }
  if (ctx.downstreamResultNames.has(info.localName)) {
    collected.add(info.exportedName);
  }
};

const resolveReExportTargetPath = (
  node: AstNode,
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number
): string | null => {
  if (depth >= MAX_RERESOLVE_DEPTH) {
    return null;
  }
  const reSource = getImportSourceValue(node);
  if (!reSource) {
    return null;
  }
  const reTargetPath = resolveRelativeImportPath(reSource, targetPath);
  if (!reTargetPath || visited.has(reTargetPath)) {
    return null;
  }
  return reTargetPath;
};

const buildReExportContext = (
  reTargetPath: string,
  specifierInfos: readonly ExportSpecifierInfo[],
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number
): ReExportContext => {
  const needsDefault = specifierInfos.some((info) => info.isDefault);
  // Load once when the default specifier branch needs the target AST; the
  // same loaded object is threaded into the downstream walk so it isn't
  // read and parsed a second time within this check() call.
  const loadedTarget = needsDefault ? loadTargetFile(reTargetPath) : null;
  // eslint-disable-next-line no-use-before-define
  const downstreamResultNames = collectTargetExportedResultHelperNames(
    reTargetPath,
    visited,
    targetPath,
    depth + 1,
    loadedTarget
  );
  return {
    downstreamResultNames,
    loadedTarget,
  };
};

/**
 * Resolve a re-export with source (`export { ... } from './x.js'`) by pulling
 * the matching names off the target file, honoring aliases and `default`.
 */
const resolveReExportWithSource = (
  node: AstNode,
  specifiers: readonly AstNode[],
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number,
  collected: Set<string>
): void => {
  const reTargetPath = resolveReExportTargetPath(
    node,
    targetPath,
    visited,
    depth
  );
  if (!reTargetPath) {
    return;
  }
  const specifierInfos = specifiers.flatMap((spec) => {
    const info = buildExportSpecifierInfo(spec);
    return info ? [info] : [];
  });
  const ctx = buildReExportContext(
    reTargetPath,
    specifierInfos,
    targetPath,
    visited,
    depth
  );
  for (const info of specifierInfos) {
    applySpecifierInfo(info, ctx, collected);
  }
};

/** Resolve a specifier-only re-export (`export { helper };`) against same-file declarations. */
const resolveReExportWithoutSource = (
  specifiers: readonly AstNode[],
  localDeclarations: DeclarationIndex,
  source: string,
  collected: Set<string>
): void => {
  for (const spec of specifiers) {
    const info = buildExportSpecifierInfo(spec);
    if (!info || info.isDefault) {
      continue;
    }
    if (
      isResultHelperDeclaration(localDeclarations.get(info.localName), source)
    ) {
      collected.add(info.exportedName);
    }
  }
};

const processInlineExportedDeclaration = (
  exportedDecl: AstNode,
  source: string,
  collected: Set<string>
): boolean => {
  if (exportedDecl.type === 'VariableDeclaration') {
    addExportedVariableResultHelper(exportedDecl, source, collected);
    return true;
  }
  if (exportedDecl.type === 'FunctionDeclaration') {
    addExportedFunctionResultHelper(exportedDecl, source, collected);
    return true;
  }
  return false;
};

const processExportNamedDeclaration = (
  node: AstNode,
  source: string,
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number,
  localDeclarations: DeclarationIndex,
  collected: Set<string>
): void => {
  const exportedDecl = getExportedDeclaration(node);
  if (
    exportedDecl &&
    processInlineExportedDeclaration(exportedDecl, source, collected)
  ) {
    return;
  }
  const specifiers =
    (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
  if (specifiers.length === 0) {
    return;
  }
  if (getImportSourceValue(node)) {
    resolveReExportWithSource(
      node,
      specifiers,
      targetPath,
      visited,
      depth,
      collected
    );
    return;
  }
  resolveReExportWithoutSource(
    specifiers,
    localDeclarations,
    source,
    collected
  );
};

const processExportDefaultDeclaration = (
  node: AstNode,
  source: string,
  localDeclarations: DeclarationIndex,
  collected: Set<string>
): void => {
  const defaultDecl = (node as unknown as { declaration?: AstNode })
    .declaration;
  if (!defaultDecl) {
    return;
  }
  if (
    checkDefaultDeclarationIsResultHelper(
      defaultDecl,
      source,
      localDeclarations
    )
  ) {
    collected.add('default');
  }
};

const collectExportedResultHelpersFromAst = (
  ast: AstNode,
  source: string,
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number,
  preloadedLocalDeclarations: DeclarationIndex | null = null
): ReadonlySet<string> => {
  const collected = new Set<string>();
  // Reuse the preloaded declaration index when available (e.g., threaded in
  // from `loadTargetFile`) to avoid re-walking the same AST.
  const localDeclarations =
    preloadedLocalDeclarations ?? indexLocalDeclarations(ast);
  const program = ast as unknown as { body?: readonly AstNode[] };
  const bodyNodes = program.body ?? [];

  for (const node of bodyNodes) {
    if (node.type === 'ExportNamedDeclaration') {
      processExportNamedDeclaration(
        node,
        source,
        targetPath,
        visited,
        depth,
        localDeclarations,
        collected
      );
    } else if (node.type === 'ExportDefaultDeclaration') {
      processExportDefaultDeclaration(
        node,
        source,
        localDeclarations,
        collected
      );
    } else if (node.type === 'ExportAllDeclaration') {
      // eslint-disable-next-line no-use-before-define
      processExportAllDeclaration(node, targetPath, visited, depth, collected);
    }
  }

  return collected;
};

/**
 * Handle `export * from './x.js'` by recursing into the target module and
 * unioning its exported Result-helper names. Type-only re-exports
 * (`export type * from '...'`) contribute nothing. Bounded by
 * `MAX_RERESOLVE_DEPTH` and the visited-set cycle guard shared with the
 * specifier re-export path.
 */
const processExportAllDeclaration = (
  node: AstNode,
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number,
  collected: Set<string>
): void => {
  const { exportKind } = node as unknown as { exportKind?: string };
  if (exportKind === 'type') {
    return;
  }
  const reTargetPath = resolveReExportTargetPath(
    node,
    targetPath,
    visited,
    depth
  );
  if (!reTargetPath) {
    return;
  }
  // eslint-disable-next-line no-use-before-define
  const downstream = collectTargetExportedResultHelperNames(
    reTargetPath,
    visited,
    targetPath,
    depth + 1
  );
  // `export * from` does NOT re-export the default binding, so we union
  // only the named Result helpers from the downstream module.
  for (const name of downstream) {
    if (name !== 'default') {
      collected.add(name);
    }
  }
};

const parseTargetResultHelperNames = (
  targetPath: string,
  visited: ReadonlySet<string>,
  depth: number,
  preloaded: LoadedTargetFile | null = null
): ReadonlySet<string> => {
  const loaded = preloaded ?? loadTargetFile(targetPath);
  if (!loaded) {
    return new Set<string>();
  }
  return collectExportedResultHelpersFromAst(
    loaded.ast,
    loaded.source,
    targetPath,
    visited,
    depth,
    loaded.localDeclarations
  );
};

const buildVisitedPathSet = (
  parentVisited: ReadonlySet<string>,
  targetPath: string,
  parentPath: string | undefined
): ReadonlySet<string> => {
  const seeds = [...parentVisited, targetPath];
  if (parentPath) {
    seeds.push(parentPath);
  }
  return new Set<string>(seeds);
};

/**
 * Collect the set of exported names from a target file whose declaration has
 * an explicit `Result<...>` / `Promise<Result<...>>` return annotation.
 *
 * Uses a visited-set on the recursion path to guard against `export { ... }
 * from` import cycles between files. Depth is capped at a single transitive
 * hop (see `MAX_RERESOLVE_DEPTH`) — deeper chains silently fall back.
 */
// Only the direct-import path (no parents visited) is safe to cache: the
// computed set is a function of (targetPath, parentVisited), and
// cycle-truncated results from transitive walks must not bleed into later
// direct lookups. See PR #204 review.
const readCachedResultExports = (
  targetPath: string,
  parentVisited: ReadonlySet<string>
): ReadonlySet<string> | undefined => {
  if (parentVisited.size !== 0) {
    return;
  }
  return targetFileResultExportCache.get(targetPath);
};

// biome-ignore lint/style/useConst: declared as a function so hoisting lets `buildReExportContext` (a const declared earlier) reference it before its textual definition
// eslint-disable-next-line func-style, no-use-before-define
function collectTargetExportedResultHelperNames(
  targetPath: string,
  parentVisited: ReadonlySet<string> = new Set<string>(),
  parentPath?: string,
  depth = 0,
  preloaded: LoadedTargetFile | null = null
): ReadonlySet<string> {
  if (parentVisited.has(targetPath)) {
    return new Set<string>();
  }
  const cached = readCachedResultExports(targetPath, parentVisited);
  if (cached) {
    return cached;
  }
  const visited = buildVisitedPathSet(parentVisited, targetPath, parentPath);
  const names = parseTargetResultHelperNames(
    targetPath,
    visited,
    depth,
    preloaded
  );
  if (parentVisited.size === 0) {
    targetFileResultExportCache.set(targetPath, names);
  }
  return names;
}

/**
 * Extend a local-helper-name set with Result-returning helpers imported from
 * relative modules. Falls back silently on any resolution/parse failure.
 */
const collectImportedResultHelperNames = (
  ast: AstNode,
  filePath: string
): ReadonlySet<string> => {
  const names = new Set<string>();

  for (const binding of collectResolvableImports(ast)) {
    const targetPath = resolveRelativeImportPath(binding.source, filePath);
    if (!targetPath) {
      continue;
    }
    const exportedResultNames =
      collectTargetExportedResultHelperNames(targetPath);
    if (exportedResultNames.has(binding.importedName)) {
      names.add(binding.localName);
    }
  }

  return names;
};

interface NamespaceEntry {
  readonly localName: string;
  readonly names: ReadonlySet<string>;
}

/** Extract a namespace specifier's local name if it is a namespace import. */
const getNamespaceLocalName = (spec: AstNode): string | null => {
  if (spec.type !== 'ImportNamespaceSpecifier') {
    return null;
  }
  const { local } = spec as unknown as { local?: AstNode };
  return extractIdentifierName(local);
};

/** Resolve a single namespace specifier to (localName, resultHelperNames) or null. */
const resolveNamespaceSpecifier = (
  spec: AstNode,
  source: string,
  filePath: string
): NamespaceEntry | null => {
  const localName = getNamespaceLocalName(spec);
  if (!localName) {
    return null;
  }
  const targetPath = resolveRelativeImportPath(source, filePath);
  if (!targetPath) {
    return null;
  }
  const names = collectTargetExportedResultHelperNames(targetPath);
  return names.size > 0 ? { localName, names } : null;
};

/** Extract namespace helper entries from a single ImportDeclaration node. */
const namespaceEntriesFromImport = (
  node: AstNode,
  filePath: string
): readonly NamespaceEntry[] => {
  const source = getImportSourceValue(node);
  if (!source) {
    return [];
  }
  const specifiers =
    (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
  return specifiers.flatMap((spec) => {
    const entry = resolveNamespaceSpecifier(spec, source, filePath);
    return entry ? [entry] : [];
  });
};

/**
 * Collect `import * as ns from './foo.js'` bindings and map each local
 * namespace name to the set of Result-returning helper names exported by the
 * resolved target module. Returns an empty map if no namespace imports are
 * found or none resolve to local files.
 */
const collectNamespaceHelperImports = (
  ast: AstNode,
  filePath: string
): NamespaceHelperMap => {
  const map = new Map<string, ReadonlySet<string>>();
  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') {
      return;
    }
    for (const { localName, names } of namespaceEntriesFromImport(
      node,
      filePath
    )) {
      map.set(localName, names);
    }
  });
  return map;
};

/**
 * Combine same-file helper names with helpers imported from relative modules.
 */
const collectAllResultHelperNames = (
  ast: AstNode,
  sourceCode: string,
  filePath: string
): ReadonlySet<string> => {
  const local = collectResultHelperNames(ast, sourceCode);
  const imported = collectImportedResultHelperNames(ast, filePath);
  if (imported.size === 0) {
    return local;
  }
  const merged = new Set<string>(local);
  for (const name of imported) {
    merged.add(name);
  }
  return merged;
};

// ---------------------------------------------------------------------------
// Per-implementation checking
// ---------------------------------------------------------------------------

const checkImplementation = (
  implValue: AstNode,
  info: { id: string; label: string },
  filePath: string,
  sourceCode: string,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  diagnostics: WardenDiagnostic[]
): void => {
  const fnBody = (implValue as unknown as { body?: AstNode }).body;
  if (!fnBody) {
    return;
  }

  // Blaze parameter names seed the scope stack so shadowing is respected by
  // both block-body and concise-body checks.
  const implParams = collectFunctionParamNames(implValue);

  if (fnBody.type === 'BlockStatement' || fnBody.type === 'FunctionBody') {
    checkReturnStatements(
      fnBody,
      info,
      filePath,
      sourceCode,
      helperNames,
      namespaceHelpers,
      diagnostics,
      implParams
    );
    return;
  }

  const conciseScopes: readonly ReadonlySet<string>[] =
    implParams.size > 0 ? [implParams] : [];
  if (
    !isResultExpression(fnBody) &&
    !isHelperCall(fnBody, helperNames, namespaceHelpers, conciseScopes)
  ) {
    diagnostics.push({
      filePath,
      line: offsetToLine(sourceCode, implValue.start),
      message: `${info.label} "${info.id}" implementation must return Result.ok(...) or Result.err(...), not a raw value.`,
      rule: 'implementation-returns-result',
      severity: 'error',
    });
  }
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

const checkAllDefinitions = (
  ast: AstNode,
  filePath: string,
  sourceCode: string
): WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const helperNames = collectAllResultHelperNames(ast, sourceCode, filePath);
  const namespaceHelpers = collectNamespaceHelperImports(ast, filePath);

  for (const def of findTrailDefinitions(ast)) {
    const info = { id: def.id, label: 'Trail' };
    for (const implValue of findBlazeBodies(def.config as AstNode)) {
      checkImplementation(
        implValue,
        info,
        filePath,
        sourceCode,
        helperNames,
        namespaceHelpers,
        diagnostics
      );
    }
  }

  return diagnostics;
};

/**
 * Finds implementations that return raw values instead of `Result`.
 */
export const implementationReturnsResult: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return checkAllDefinitions(ast as AstNode, filePath, sourceCode);
  },
  description:
    'Disallow implementations that return raw values instead of Result.ok() or Result.err().',
  name: 'implementation-returns-result',
  severity: 'error',
};
