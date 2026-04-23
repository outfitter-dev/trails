/**
 * Shared AST utilities for warden rules.
 *
 * Uses oxc-parser for native-speed TypeScript parsing. Provides a lightweight
 * walker and helpers for finding trail implementation bodies.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRAFT_ID_PREFIX } from '@ontrails/core';
import { parseSync } from 'oxc-parser';

// ---------------------------------------------------------------------------
// Types (minimal, avoiding full @oxc-project/types dep)
// ---------------------------------------------------------------------------

export interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly key?: { readonly name?: string };
  readonly value?: unknown;
  readonly body?: AstNode | readonly AstNode[];
  readonly [key: string]: unknown;
}

interface StringLiteralNode extends AstNode {
  readonly type: 'Literal' | 'StringLiteral';
  readonly value?: unknown;
}

const isAstNode = (value: unknown): value is AstNode =>
  Boolean(value && typeof value === 'object' && (value as AstNode).type);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Parse TypeScript source into an AST. Returns null on parse failure. */
export const parse = (filePath: string, sourceCode: string): AstNode | null => {
  try {
    const result = parseSync(filePath, sourceCode, { sourceType: 'module' });
    return result.program as unknown as AstNode;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

type WalkFn = (node: unknown, visit: (node: AstNode) => void) => void;

const walkChildren = (
  node: AstNode,
  visit: (node: AstNode) => void,
  recurse: WalkFn
): void => {
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        recurse(item, visit);
      }
    } else if (val && typeof val === 'object' && (val as AstNode).type) {
      recurse(val, visit);
    }
  }
};

/** Walk an AST node tree, calling `visit` on every node. */
export const walk: WalkFn = (node, visit) => {
  if (!node || typeof node !== 'object') {
    return;
  }
  const n = node as AstNode;
  if (n.type) {
    visit(n);
  }
  walkChildren(n, visit, walk);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the byte offset's line number (1-based) in source code. */
export const offsetToLine = (sourceCode: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset && i < sourceCode.length; i += 1) {
    if (sourceCode[i] === '\n') {
      line += 1;
    }
  }
  return line;
};

/** Get the name of an Identifier node, or null. */
export const identifierName = (node: AstNode | undefined): string | null => {
  if (node?.type !== 'Identifier') {
    return null;
  }
  return (node as unknown as { name?: string }).name ?? null;
};

/** Check if a node is a string literal. */
export const isStringLiteral = (
  node: AstNode | undefined
): node is StringLiteralNode => {
  if (!node) {
    return false;
  }
  if (node.type === 'StringLiteral') {
    return true;
  }
  if (node.type === 'Literal') {
    return typeof (node as unknown as { value?: unknown }).value === 'string';
  }
  return false;
};

/** Extract the string value from a string literal node. */
export const getStringValue = (node: AstNode): string | null => {
  const val = (node as unknown as { value?: unknown }).value;
  return typeof val === 'string' ? val : null;
};

/**
 * Best-effort resolution of `const NAME = 'value'` declarations via regex.
 *
 * Returns the string value if a simple `const <name> = '...'` or `"..."` is
 * found in the source. Returns null for anything more complex. Shared between
 * warden rules that need to resolve identifier references to signal / trail
 * IDs at lint time.
 */
export const deriveConstString = (
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

/** Extract a string literal value, or null when the node is not a string. */
export const extractStringLiteral = (
  node: AstNode | undefined
): string | null =>
  node && isStringLiteral(node) ? getStringValue(node) : null;

/**
 * Extract the cooked value from a `TemplateLiteral` with no interpolations
 * (e.g. `` `entity.fallback` ``). Template literals with `${...}` expressions
 * cannot be resolved at lint time and return null.
 *
 * Shared helper used by rules that accept both string literals and simple
 * backtick-literal IDs (e.g. `valid-detour-refs`, `valid-describe-refs`).
 */
const getSingleQuasi = (node: AstNode): AstNode | null => {
  const expressions =
    (node['expressions'] as readonly AstNode[] | undefined) ?? [];
  if (expressions.length > 0) {
    return null;
  }
  const quasis = (node['quasis'] as readonly AstNode[] | undefined) ?? [];
  return quasis.length === 1 ? (quasis[0] ?? null) : null;
};

export const extractPlainTemplateLiteral = (
  node: AstNode | undefined
): string | null => {
  if (!node || node.type !== 'TemplateLiteral') {
    return null;
  }
  const quasi = getSingleQuasi(node);
  if (!quasi) {
    return null;
  }
  const cooked = (quasi as unknown as { value?: { cooked?: unknown } }).value
    ?.cooked;
  return typeof cooked === 'string' ? cooked : null;
};

/**
 * Extract a string value from either a string literal or a plain template
 * literal (no `${...}` expressions). Returns null for anything else.
 */
export const extractStringOrTemplateLiteral = (
  node: AstNode | undefined
): string | null =>
  extractStringLiteral(node) ?? extractPlainTemplateLiteral(node);

export interface StringLiteralMatch {
  readonly end: number;
  readonly node: AstNode;
  readonly start: number;
  readonly value: string;
}

/**
 * Names of framework constants whose value is a draft-marker prefix literal.
 *
 * String literals that initialize a `const` declaration with one of these
 * names are treated as the framework's own draft-marker declarations, not as
 * draft-id usage. This list is intentionally small and explicit — adding a
 * new framework draft-prefix constant requires updating this set.
 */
export const FRAMEWORK_DRAFT_PREFIX_CONSTANT_NAMES: ReadonlySet<string> =
  new Set(['DRAFT_ID_PREFIX', 'DRAFT_FILE_PREFIX']);

/**
 * Exact string literal value allowed for framework draft-prefix constant
 * declarations. Tightens the exemption so a future framework file cannot
 * redeclare `DRAFT_ID_PREFIX = '_draft.something-else'` and accidentally
 * suppress its own draft-id diagnostic.
 */
const FRAMEWORK_DRAFT_PREFIX_LITERAL = DRAFT_ID_PREFIX;

/**
 * Absolute paths of the two framework files allowed to declare the
 * draft-prefix constants. Anchored against the rule module's own URL so the
 * exemption is scoped to this package's real on-disk location — a consumer
 * repository that happens to declare `const DRAFT_ID_PREFIX = '_draft.leak'`
 * anywhere else cannot hide a genuine leak by matching the identifier name.
 *
 * The two framework files are:
 *  - `packages/core/src/draft.ts`   (defines `DRAFT_ID_PREFIX`)
 *  - `packages/warden/src/draft.ts` (defines `DRAFT_FILE_PREFIX`)
 */
const FRAMEWORK_DRAFT_CONSTANT_FILES: ReadonlySet<string> = new Set([
  resolve(
    fileURLToPath(new URL('../../../core/src/draft.ts', import.meta.url))
  ),
  resolve(fileURLToPath(new URL('../draft.ts', import.meta.url))),
]);

/**
 * Collect the source offsets of string literals that initialize a framework
 * draft-prefix constant declaration (e.g. `export const DRAFT_ID_PREFIX =
 * '_draft.'`). Used by draft-awareness rules to skip their own marker
 * constants.
 *
 * Exemption is gated on all three of:
 *   1. The file's absolute path matches one of the two framework files that
 *      actually define these constants.
 *   2. The declaration name is `DRAFT_ID_PREFIX` or `DRAFT_FILE_PREFIX`.
 *   3. The string literal value is exactly `'_draft.'`.
 *
 * A consumer file that reuses one of these identifier names cannot hide a
 * `_draft.*` leak — the path gate rejects it outright.
 */
export const collectFrameworkDraftPrefixConstantOffsets = (
  ast: AstNode,
  filePath: string
): ReadonlySet<number> => {
  const offsets = new Set<number>();

  if (!FRAMEWORK_DRAFT_CONSTANT_FILES.has(resolve(filePath))) {
    return offsets;
  }

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = identifierName(id);
    if (
      !name ||
      !FRAMEWORK_DRAFT_PREFIX_CONSTANT_NAMES.has(name) ||
      !init ||
      !isStringLiteral(init)
    ) {
      return;
    }

    if (getStringValue(init) !== FRAMEWORK_DRAFT_PREFIX_LITERAL) {
      return;
    }

    offsets.add(init.start);
  });

  return offsets;
};

const WARDEN_IGNORE_NEXT_LINE_PRAGMA = '// warden-ignore-next-line';

/**
 * Split source code into lines for pragma lookups. Callers should split once
 * per `check` invocation and thread the result through to
 * {@link hasIgnoreCommentOnLine} so we avoid re-splitting the full source on
 * every match in files with many draft-like string literals.
 */
export const splitSourceLines = (sourceCode: string): readonly string[] =>
  sourceCode.split('\n');

/**
 * Check whether the line immediately preceding `line` contains a
 * `// warden-ignore-next-line` pragma (leading/trailing whitespace tolerated).
 * Pragma scope is strictly one line — an intervening blank line breaks it.
 *
 * Takes a pre-split `lines` array so callers can split the source once per
 * invocation instead of re-splitting for every literal they check.
 *
 * @example
 * ```ts
 * // warden-ignore-next-line
 * const x = '_draft.intentional'; // suppressed
 * ```
 */
export const hasIgnoreCommentOnLine = (
  lines: readonly string[],
  line: number
): boolean => {
  if (line <= 1) {
    return false;
  }

  const previous = lines[line - 2];
  if (previous === undefined) {
    return false;
  }

  return previous.trim() === WARDEN_IGNORE_NEXT_LINE_PRAGMA;
};

export const findStringLiterals = (
  ast: AstNode,
  predicate?: (value: string, node: AstNode) => boolean
): StringLiteralMatch[] => {
  const matches: StringLiteralMatch[] = [];

  walk(ast, (node) => {
    if (!isStringLiteral(node)) {
      return;
    }

    const value = getStringValue(node);
    if (value === null) {
      return;
    }

    if (predicate && !predicate(value, node)) {
      return;
    }

    matches.push({
      end: node.end,
      node,
      start: node.start,
      value,
    });
  });

  return matches;
};

/** Extract the first string argument from a CallExpression. */
export const extractFirstStringArg = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }

  const args = node['arguments'] as readonly AstNode[] | undefined;
  const [firstArg] = args ?? [];
  return extractStringLiteral(firstArg);
};

const isResourceCall = (node: AstNode | undefined): boolean =>
  !!node &&
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'resource';

const extractBindingName = (node: AstNode | undefined): string | null => {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return identifierName(node);
  }
  if (node.type === 'AssignmentPattern') {
    return identifierName((node as unknown as { left?: AstNode }).left);
  }
  return null;
};

/** Collect `const foo = resource('id', ...)` bindings from a parsed file. */
export const collectNamedResourceIds = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    if (!isResourceCall(init)) {
      return;
    }

    const name = extractBindingName(id);
    const resourceId = init ? extractFirstStringArg(init) : null;
    if (name && resourceId) {
      ids.set(name, resourceId);
    }
  });

  return ids;
};

/** Collect all inline `resource('id', ...)` definition IDs from a parsed file. */
export const collectResourceDefinitionIds = (
  ast: AstNode
): ReadonlySet<string> => {
  const ids = new Set<string>();

  walk(ast, (node) => {
    if (!isResourceCall(node)) {
      return;
    }

    const id = extractFirstStringArg(node);
    if (id) {
      ids.add(id);
    }
  });

  return ids;
};

/** Backward-compatible aliases while the migration is in flight. */
export const collectNamedServiceIds = collectNamedResourceIds;
/** Backward-compatible aliases while the migration is in flight. */
export const collectServiceDefinitionIds = collectResourceDefinitionIds;

// ---------------------------------------------------------------------------
// Config property extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the identifying name of a `Property` key, supporting both
 * identifier keys (`{ foo: 1 }`) and string-literal keys
 * (`{ "foo": 1 }`). Computed keys are intentionally not resolved — a
 * computed expression could evaluate to anything and we only want to
 * match keys that are statically equivalent to a plain identifier.
 */
const staticPropertyKeyName = (key: AstNode): string | null => {
  if (key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name ?? null;
  }
  return isStringLiteral(key) ? getStringValue(key) : null;
};

const propertyKeyName = (prop: AstNode): string | null => {
  if (prop.type !== 'Property') {
    return null;
  }
  const { computed } = prop as unknown as { computed?: boolean };
  if (computed) {
    return null;
  }
  const key = prop.key as AstNode | undefined;
  return key ? staticPropertyKeyName(key) : null;
};

/** Find a Property node by key name inside an ObjectExpression config. */
export const findConfigProperty = (
  config: AstNode,
  propertyName: string
): AstNode | null => {
  if (config.type !== 'ObjectExpression') {
    return null;
  }
  const properties = config['properties'] as readonly AstNode[] | undefined;
  if (!properties) {
    return null;
  }
  for (const prop of properties) {
    if (propertyKeyName(prop) === propertyName) {
      return prop;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Trail definition extraction
// ---------------------------------------------------------------------------

export interface TrailDefinition {
  /** Trail ID string, e.g. "entity.show" */
  readonly id: string;
  /** "trail" or "signal" */
  readonly kind: string;
  /** The config object argument (second arg to trail() call) */
  readonly config: AstNode;
  /** Start offset of the call expression */
  readonly start: number;
}

/**
 * Find all `trail("id", { ... })`, `trail({ id: "x", ... })`, and
 * `signal("id", { ... })` call sites.
 *
 * Returns the trail ID, kind, and config object node for each definition.
 */
const TRAIL_CALLEE_NAMES = new Set(['signal', 'trail']);

/**
 * Source prefix for the Trails framework package whose namespace imports are
 * recognized as carriers of `trail()` / `signal()` / `contour()` primitives.
 *
 * A namespaced callee like `core.trail(...)` is only treated as a framework
 * call when the receiver identifier resolves to an `import * as core from
 * '@ontrails/...'` in the same file. An unrelated `analytics.trail(...)`
 * whose `analytics` comes from a different module (or no import at all)
 * is ignored.
 */
const FRAMEWORK_NAMESPACE_SOURCE_PREFIX = '@ontrails/';

const isFrameworkNamespaceSource = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.startsWith(FRAMEWORK_NAMESPACE_SOURCE_PREFIX);

/**
 * Collect local binding names introduced by `import * as <name> from
 * '@ontrails/...'` declarations. Used to gate namespaced framework-primitive
 * calls so an unrelated `analytics.trail(...)` doesn't match.
 */
const getImportSourceValue = (node: AstNode): unknown => {
  const sourceNode = (node as unknown as { source?: AstNode }).source;
  return sourceNode
    ? (sourceNode as unknown as { value?: unknown }).value
    : undefined;
};

const addNamespaceImportBindings = (
  node: AstNode,
  names: Set<string>
): void => {
  const specifiers =
    (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
  for (const spec of specifiers) {
    if (spec.type !== 'ImportNamespaceSpecifier') {
      continue;
    }
    const { local } = spec as unknown as { local?: AstNode };
    const localName = identifierName(local);
    if (localName) {
      names.add(localName);
    }
  }
};

const TOP_LEVEL_NAMED_DECL_TYPES = new Set([
  'ClassDeclaration',
  'FunctionDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
]);

const removeVarDeclarationShadowedNames = (
  stmt: AstNode,
  names: Set<string>
): void => {
  const declarations =
    (stmt as unknown as { declarations?: readonly AstNode[] }).declarations ??
    [];
  for (const d of declarations) {
    const { id } = d as unknown as { id?: AstNode };
    const n = identifierName(id);
    if (n) {
      names.delete(n);
    }
  }
};

const removeNamedDeclShadowedName = (
  stmt: AstNode,
  names: Set<string>
): void => {
  const { id } = stmt as unknown as { id?: AstNode };
  const n = identifierName(id);
  if (n) {
    names.delete(n);
  }
};

const removeTopLevelShadowedNames = (
  stmt: AstNode,
  names: Set<string>
): void => {
  if (
    stmt.type === 'ExportNamedDeclaration' ||
    stmt.type === 'ExportDefaultDeclaration'
  ) {
    const { declaration } = stmt as unknown as { declaration?: AstNode };
    if (declaration) {
      removeTopLevelShadowedNames(declaration, names);
    }
    return;
  }
  if (stmt.type === 'VariableDeclaration') {
    removeVarDeclarationShadowedNames(stmt, names);
    return;
  }
  if (TOP_LEVEL_NAMED_DECL_TYPES.has(stmt.type)) {
    removeNamedDeclShadowedName(stmt, names);
  }
};

const collectFrameworkNamespaceBindings = (
  ast: AstNode
): ReadonlySet<string> => {
  const names = new Set<string>();
  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') {
      return;
    }
    if (!isFrameworkNamespaceSource(getImportSourceValue(node))) {
      return;
    }
    addNamespaceImportBindings(node, names);
  });
  if (names.size === 0) {
    return names;
  }
  // A same-named top-level declaration (class / enum / namespace / var /
  // function / lexical binding) shadows the namespace import at module scope.
  // The scope walker treats Program as the outermost frame and skips it when
  // testing for inner shadows, so we have to strip these collisions here.
  if (ast.type === 'Program') {
    const body = (ast as unknown as { body?: readonly AstNode[] }).body ?? [];
    for (const stmt of body) {
      removeTopLevelShadowedNames(stmt, names);
    }
  }
  return names;
};

// ---------------------------------------------------------------------------
// Scope-aware framework-namespace resolution
// ---------------------------------------------------------------------------
//
// A module-level `import * as core from '@ontrails/core'` makes `core` a
// framework-namespace binding, but a function-local `const core = {...}` (or
// param, `let`, `var`, `function`, class, catch param) shadows the import for
// the duration of that scope. A name-only check is not enough to trust
// `core.trail(...)` — we have to walk scopes outward from each call site and
// verify the first declaration of the receiver IS the namespace import.
//
// {@link collectFrameworkNamespacedCallStarts} performs that walk once per
// AST and returns the set of `CallExpression` start offsets whose receiver is
// provably the framework binding. Downstream helpers gate on this set instead
// of the bare names, so a local shadow cannot sneak through.

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

const forEachAstChild = (
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
 * nearest function scope from anywhere inside `root`, without crossing a
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

const SCOPE_FRAME_COLLECTORS: Record<string, FrameCollector> = {
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

const isShadowed = (
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

const resolveNamespacedMemberNames = (
  callee: AstNode
): { readonly receiver: string; readonly property: string } | null => {
  if (!isMemberAccessNonComputed(callee)) {
    return null;
  }
  const { object } = callee as unknown as { object?: AstNode };
  const receiver = identifierName(object);
  if (!receiver) {
    return null;
  }
  const prop = (callee as unknown as { property?: AstNode }).property;
  const property =
    prop?.type === 'Identifier'
      ? ((prop as unknown as { name?: string }).name ?? null)
      : null;
  return property ? { property, receiver } : null;
};

const getFrameworkCallReceiver = (
  node: AstNode,
  frameworkNamespaces: ReadonlySet<string>
): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }
  const names = resolveNamespacedMemberNames(callee);
  if (!names || !frameworkNamespaces.has(names.receiver)) {
    return null;
  }
  return names.receiver;
};

/**
 * Walk the AST with a scope stack and collect `CallExpression` start offsets
 * whose callee is `<receiver>.<property>` where `<receiver>` is proven to
 * resolve to a framework namespace import (i.e. not shadowed by any
 * enclosing scope). Used to gate namespaced `core.trail(...)` /
 * `core.signal(...)` / `core.contour(...)` resolution against local shadows.
 */
const collectFrameworkNamespacedCallStarts = (
  ast: AstNode,
  frameworkNamespaces: ReadonlySet<string>
): ReadonlySet<number> => {
  const starts = new Set<number>();
  if (frameworkNamespaces.size === 0) {
    return starts;
  }

  walkWithScopes(ast, (node, scopes) => {
    const receiver = getFrameworkCallReceiver(node, frameworkNamespaces);
    if (!receiver || isShadowed(receiver, scopes)) {
      return;
    }
    starts.add(node.start);
  });

  return starts;
};

const matchTrailPrimitiveName = (
  name: string | undefined | null
): string | null => (name && TRAIL_CALLEE_NAMES.has(name) ? name : null);

const getBareTrailCalleeName = (callee: AstNode): string | null => {
  if (callee.type !== 'Identifier') {
    return null;
  }
  return matchTrailPrimitiveName((callee as unknown as { name?: string }).name);
};

/**
 * Extract the `{ receiverName, propertyName }` of a non-computed member-call
 * callee, or null for anything else. Computed access (`ns[trail]()`) is
 * intentionally rejected: the bracketed expression may resolve to any runtime
 * value, so we cannot prove the call targets a specific member.
 */
const isNonComputedMemberAccess = (callee: AstNode): boolean => {
  if (
    callee.type !== 'MemberExpression' &&
    callee.type !== 'StaticMemberExpression'
  ) {
    return false;
  }
  return (callee as unknown as { computed?: boolean }).computed !== true;
};

const getNamespacedMemberNames = (
  callee: AstNode
): { readonly receiver: string; readonly property: string } | null => {
  if (!isNonComputedMemberAccess(callee)) {
    return null;
  }
  const { object } = callee as unknown as { object?: AstNode };
  const receiver = identifierName(object);
  if (!receiver) {
    return null;
  }
  const prop = (callee as unknown as { property?: AstNode }).property;
  const property =
    prop?.type === 'Identifier'
      ? ((prop as unknown as { name?: string }).name ?? null)
      : null;
  return property ? { property, receiver } : null;
};

/**
 * Resolution context for namespaced framework-primitive calls. Bundles the
 * bare namespace-binding set with an optional set of proven-safe
 * `CallExpression` start offsets from a scope-aware pre-pass. When the set of
 * safe starts is present, a namespaced call only resolves if its start is in
 * that set — so a function-local shadow of the namespace import does not
 * leak through. When absent (e.g. from test helpers), the name-only gate is
 * used as a backward-compatible fallback.
 */
export interface FrameworkNamespaceContext {
  readonly namespaces: ReadonlySet<string>;
  readonly safeCallStarts?: ReadonlySet<number>;
}

const asNamespaceContext = (
  input: ReadonlySet<string> | FrameworkNamespaceContext | undefined
): FrameworkNamespaceContext | undefined => {
  if (!input) {
    return undefined;
  }
  return input instanceof Set
    ? { namespaces: input }
    : (input as FrameworkNamespaceContext);
};

const isNamespacedCallAllowed = (
  callStart: number,
  receiver: string,
  ctx: FrameworkNamespaceContext
): boolean => {
  if (!ctx.namespaces.has(receiver)) {
    return false;
  }
  // When `safeCallStarts` is present, it is the authoritative gate — it was
  // built by a scope-aware pre-pass and already excludes shadowed receivers.
  // Without it, fall back to the bare name check (used by unit-test hooks).
  return ctx.safeCallStarts ? ctx.safeCallStarts.has(callStart) : true;
};

/**
 * Resolve a namespaced `ns.trail(...)` / `ns.signal(...)` callee to its
 * primitive name. When a {@link FrameworkNamespaceContext} is provided, the
 * receiver must be a framework namespace binding AND — when a
 * `safeCallStarts` set is present — the call site must appear in that set,
 * meaning the receiver is not shadowed by any enclosing scope.
 *
 * When `context` is `undefined`, this falls back to permissive matching
 * (any `ns.trail(...)` shape resolves). Inline resolution paths that do
 * not have the surrounding AST available (e.g. `crosses: [core.trail(...)]`
 * or `on: [core.signal(...)]`) rely on this fallback. Scope-aware call
 * sites always pass a context, so this only affects inline contexts where
 * a best-effort name match is the intended behavior.
 */
const getNamespacedTrailCalleeName = (
  callExpr: AstNode,
  callee: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): string | null => {
  const names = getNamespacedMemberNames(callee);
  if (!names) {
    return null;
  }
  const ctx = asNamespaceContext(context);
  if (ctx && !isNamespacedCallAllowed(callExpr.start, names.receiver, ctx)) {
    return null;
  }
  return matchTrailPrimitiveName(names.property);
};

/**
 * Resolve the callee name of a trail/signal call expression.
 *
 * Matches both bare `trail(...)` / `signal(...)` identifiers and namespaced
 * member-expression callees like `core.trail(...)` or `ns.signal(...)`, where
 * the namespace must come from an `@ontrails/*` import and, when the scope
 * pre-pass is wired in, be unshadowed at the call site.
 */
const getTrailCalleeName = (
  node: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }
  return (
    getBareTrailCalleeName(callee) ??
    getNamespacedTrailCalleeName(node, callee, context)
  );
};

/**
 * Test hook: exposes {@link getTrailCalleeName} for unit tests.
 *
 * Kept unexported from the module's public surface (no re-export from
 * `index.ts`) so internal refactors stay free.
 */
export const __getTrailCalleeNameForTest = getTrailCalleeName;

/**
 * Test hook: exposes {@link collectFrameworkNamespaceBindings} for unit tests.
 *
 * Not re-exported from `index.ts`; the double-underscore prefix marks it as an
 * internal-only handle so consumer code cannot rely on it.
 */
export const __collectFrameworkNamespaceBindingsForTest =
  collectFrameworkNamespaceBindings;

/** Extract args from a trail() call, handling both two-arg and single-object forms. */
const extractTrailArgs = (
  node: AstNode
): { idArg: AstNode | null; configArg: AstNode } | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (!args || args.length === 0) {
    return null;
  }

  const [firstArg, secondArg] = args;
  if (!firstArg) {
    return null;
  }

  // Two-arg form: trail('id', { ... })
  if (secondArg && firstArg.type !== 'ObjectExpression') {
    return { configArg: secondArg, idArg: firstArg };
  }

  // Single-object form: trail({ id: 'x', ... })
  return firstArg.type === 'ObjectExpression'
    ? { configArg: firstArg, idArg: null }
    : null;
};

/** Extract the string value from an `id` property inside a config ObjectExpression. */
const extractIdFromConfig = (config: AstNode): string | null => {
  const idProp = findConfigProperty(config, 'id');
  if (!idProp || !idProp.value) {
    return null;
  }
  return extractStringOrTemplateLiteral(idProp.value as AstNode);
};

const extractTrailId = (trailArgs: {
  idArg: AstNode | null;
  configArg: AstNode;
}): string | null => {
  if (trailArgs.idArg) {
    return extractStringOrTemplateLiteral(trailArgs.idArg);
  }
  return extractIdFromConfig(trailArgs.configArg);
};

const extractTrailDefinition = (
  node: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): TrailDefinition | null => {
  const calleeName = getTrailCalleeName(node, context);
  if (!calleeName) {
    return null;
  }

  const trailArgs = extractTrailArgs(node);
  if (!trailArgs) {
    return null;
  }

  const trailId = extractTrailId(trailArgs);
  if (!trailId) {
    return null;
  }

  return {
    config: trailArgs.configArg,
    id: trailId,
    kind: calleeName,
    start: node.start,
  };
};

const buildFrameworkNamespaceContext = (
  ast: AstNode
): FrameworkNamespaceContext => {
  const namespaces = collectFrameworkNamespaceBindings(ast);
  return {
    namespaces,
    safeCallStarts: collectFrameworkNamespacedCallStarts(ast, namespaces),
  };
};

export const findTrailDefinitions = (ast: AstNode): TrailDefinition[] => {
  const definitions: TrailDefinition[] = [];
  const context = buildFrameworkNamespaceContext(ast);

  walk(ast, (node) => {
    const def = extractTrailDefinition(node, context);
    if (def) {
      definitions.push(def);
    }
  });

  return definitions;
};

// ---------------------------------------------------------------------------
// Contour definition extraction
// ---------------------------------------------------------------------------

export interface ContourDefinition {
  /** Local binding name when the contour is assigned to a variable. */
  readonly bindingName?: string;
  /** Contour name string, e.g. "user". */
  readonly name: string;
  /** Original call expression for the contour declaration. */
  readonly call: AstNode;
  /** Options object argument passed to contour(), when present. */
  readonly options: AstNode | null;
  /** Shape object argument passed to contour(). */
  readonly shape: AstNode;
  /** Start offset of the call expression. */
  readonly start: number;
}

const CONTOUR_PRIMITIVE_NAME = 'contour';

const matchContourPrimitiveName = (
  name: string | undefined | null
): string | null => (name === CONTOUR_PRIMITIVE_NAME ? name : null);

const getBareContourCalleeName = (callee: AstNode): string | null => {
  if (callee.type !== 'Identifier') {
    return null;
  }
  return matchContourPrimitiveName(
    (callee as unknown as { name?: string }).name
  );
};

/**
 * Resolve a namespaced `ns.contour(...)` callee to its primitive name. Mirrors
 * {@link getNamespacedTrailCalleeName}: the receiver identifier must resolve
 * to an `@ontrails/*` namespace import, and — when a scope-aware
 * `safeCallStarts` set is provided — the call site must not be shadowed by a
 * local binding of the same name.
 */
const getNamespacedContourCalleeName = (
  callExpr: AstNode,
  callee: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): string | null => {
  const names = getNamespacedMemberNames(callee);
  if (!names) {
    return null;
  }
  // Unlike the trail/signal variant, contour has no inline-resolution callers
  // that legitimately invoke this without a FrameworkNamespaceContext, so the
  // strict namespace gate stays on. If a future caller needs the permissive
  // fallback, mirror the trail shape and add a regression test first.
  const ctx = asNamespaceContext(context);
  if (!ctx || !isNamespacedCallAllowed(callExpr.start, names.receiver, ctx)) {
    return null;
  }
  return matchContourPrimitiveName(names.property);
};

/**
 * Resolve the callee name of a contour call expression. Matches both bare
 * `contour(...)` identifiers and namespaced `core.contour(...)` callees where
 * the namespace comes from an `@ontrails/*` import and is unshadowed.
 */
const getContourCalleeName = (
  node: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }
  return (
    getBareContourCalleeName(callee) ??
    getNamespacedContourCalleeName(node, callee, context)
  );
};

const extractContourDefinition = (
  node: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): Omit<ContourDefinition, 'bindingName'> | null => {
  if (!getContourCalleeName(node, context)) {
    return null;
  }

  const args = node['arguments'] as readonly AstNode[] | undefined;
  const [nameArg, shapeArg, optionsArg] = args ?? [];
  const name = extractStringLiteral(nameArg);
  if (!name || shapeArg?.type !== 'ObjectExpression') {
    return null;
  }

  return {
    call: node,
    name,
    options: optionsArg?.type === 'ObjectExpression' ? optionsArg : null,
    shape: shapeArg,
    start: node.start,
  };
};

const getCallStartFromCandidate = (
  node: AstNode | undefined
): number | null => {
  if (!node) {
    return null;
  }
  if (node.type === 'CallExpression') {
    return node.start;
  }
  if (node.type !== 'ExpressionStatement') {
    return null;
  }
  const { expression } = node as unknown as { expression?: AstNode };
  return expression?.type === 'CallExpression' ? expression.start : null;
};

// Statement forms that can directly contain a top-level contour call:
//   `core.contour(...)` as a bare statement,
//   `export const ... = core.contour(...)` (handled via VariableDeclarator),
//   `export default core.contour(...);`.
const getCandidateCallHosts = (
  statement: AstNode
): readonly (AstNode | undefined)[] => {
  if (
    statement.type !== 'ExportNamedDeclaration' &&
    statement.type !== 'ExportDefaultDeclaration'
  ) {
    return [statement];
  }
  const { declaration } = statement as unknown as {
    declaration?: AstNode;
  };
  return [statement, declaration];
};

const getTopLevelCallStartsFrom = (statement: AstNode): readonly number[] => {
  const hosts = getCandidateCallHosts(statement);
  const starts: number[] = [];
  for (const host of hosts) {
    const start = getCallStartFromCandidate(host);
    if (start !== null) {
      starts.push(start);
    }
  }
  return starts;
};

/**
 * Collect the `start` offsets of `CallExpression` nodes that appear as
 * top-level `ExpressionStatement`s in a program body — including inside a
 * top-level `ExportNamedDeclaration` / `ExportDefaultDeclaration` wrapper.
 * Used to discriminate top-level statement-form calls from inline nested
 * calls when `topLevelOnly` is enabled.
 */
const collectTopLevelStatementCallStarts = (
  ast: AstNode
): ReadonlySet<number> => {
  const body = (ast as unknown as { body?: readonly AstNode[] }).body ?? [];
  return new Set(body.flatMap(getTopLevelCallStartsFrom));
};

export interface FindContourDefinitionsOptions {
  /**
   * When true, skip contour calls nested inside other expressions (e.g.
   * `core.contour('inner', {...}).id()` used as a field of an outer contour).
   * Top-level forms are still surfaced: both `const foo = contour(...)`
   * declarations and bare `contour('name', {...});` statement-form calls that
   * appear directly in the program body (optionally wrapped in `export`) are
   * returned.
   *
   * Defaults to `false`: both top-level and inline contours are returned so
   * that reference-site resolution can reach anonymous inline contours.
   */
  readonly topLevelOnly?: boolean;
}

/**
 * Return every `contour('name', ...)` definition reachable from the AST, in
 * source order, deduplicated by call-expression start offset.
 *
 * Includes both top-level bindings (`const user = contour('user', ...)`) and
 * inline contour calls nested inside other expressions (e.g.
 * `contour('outer', { inner: contour('inner', ...).id() })`). Inline contours
 * carry no `bindingName` because they have no local binding — this asymmetry
 * is why {@link collectNamedContourIds} returns only the top-level subset
 * while {@link collectContourDefinitionIds} returns the full set.
 *
 * Pass `{ topLevelOnly: true }` via `options` to opt out of inline discovery
 * without disturbing callers that rely on the default behavior.
 *
 * @remarks
 * Supplying a pre-built `context` skips the second full-AST traversal inside
 * `buildFrameworkNamespaceContext` — useful for callers (such as
 * {@link collectContourReferenceSites}) that already built one.
 */
export const findContourDefinitions = (
  ast: AstNode,
  context?: FrameworkNamespaceContext,
  options?: FindContourDefinitionsOptions
): ContourDefinition[] => {
  const definitions: ContourDefinition[] = [];
  const seenStarts = new Set<number>();
  const resolvedContext = context ?? buildFrameworkNamespaceContext(ast);
  const topLevelOnly = options?.topLevelOnly === true;

  const addContourDefinition = (definition: ContourDefinition): void => {
    if (seenStarts.has(definition.start)) {
      return;
    }

    definitions.push(definition);
    seenStarts.add(definition.start);
  };

  const addNamedContourDefinition = (
    id: AstNode | undefined,
    init: AstNode | undefined
  ): void => {
    if (!init) {
      return;
    }

    const definition = extractContourDefinition(init, resolvedContext);
    if (!definition) {
      return;
    }

    const bindingName = extractBindingName(id);
    if (bindingName) {
      addContourDefinition({ ...definition, bindingName });
      return;
    }

    addContourDefinition(definition);
  };

  // When `topLevelOnly` is set, collect the start offsets of call expressions
  // that sit directly in the program body as `ExpressionStatement`s (optionally
  // wrapped in `export`). These are top-level statement-form contour calls and
  // should still surface alongside `VariableDeclarator` bindings; only calls
  // nested inside other expressions are excluded.
  const topLevelStatementCallStarts = topLevelOnly
    ? collectTopLevelStatementCallStarts(ast)
    : null;

  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator') {
      const { id, init } = node as unknown as {
        readonly id?: AstNode;
        readonly init?: AstNode;
      };
      addNamedContourDefinition(id, init);
      return;
    }

    if (
      topLevelStatementCallStarts &&
      !topLevelStatementCallStarts.has(node.start)
    ) {
      return;
    }

    const definition = extractContourDefinition(node, resolvedContext);
    if (definition) {
      addContourDefinition(definition);
    }
  });

  return definitions.toSorted((left, right) => left.start - right.start);
};

/**
 * Collect the `name` of every contour definition in a parsed file, including
 * inline contours nested inside other expressions. Returns the same set of
 * names that {@link findContourDefinitions} discovers under default options.
 */
export const collectContourDefinitionIds = (
  ast: AstNode
): ReadonlySet<string> =>
  new Set(findContourDefinitions(ast).map((def) => def.name));

/**
 * Collect the `localBinding → contourName` map for `const foo = contour(...)`
 * declarations. Inline contour calls are intentionally excluded because they
 * have no local binding — use {@link collectContourDefinitionIds} when the
 * full set of declared names is required.
 */
export const collectNamedContourIds = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  for (const def of findContourDefinitions(ast)) {
    if (def.bindingName) {
      ids.set(def.bindingName, def.name);
    }
  }

  return ids;
};

const resolveNamedImportedName = (
  specifier: AstNode,
  localName: string
): string => {
  const { imported } = specifier as unknown as { imported?: AstNode };
  const importedName = imported
    ? (identifierName(imported) ?? extractStringLiteral(imported))
    : null;
  return importedName ?? localName;
};

const extractImportSpecifierAlias = (
  specifier: AstNode
): { readonly localName: string; readonly importedName: string } | null => {
  if (
    specifier.type !== 'ImportSpecifier' &&
    specifier.type !== 'ImportDefaultSpecifier'
  ) {
    return null;
  }

  const { local } = specifier as unknown as { local?: AstNode };
  const localName = identifierName(local);
  if (!localName) {
    return null;
  }

  // Default imports bind the default export of the source module to the local
  // name. We cannot statically recover the exported name without cross-file
  // analysis, so the local name is the best identifier we have for resolving
  // against `knownContourIds`. Treat the alias as an identity mapping; the
  // downstream resolver will fall through to `knownContourIds` on the binding
  // name and report it as missing when not found.
  if (specifier.type === 'ImportDefaultSpecifier') {
    return { importedName: localName, localName };
  }

  return {
    importedName: resolveNamedImportedName(specifier, localName),
    localName,
  };
};

/**
 * Collect `import { foo as bar } from '...'` and `import bar from '...'`
 * specifier mappings keyed by local binding name. The value is the original
 * exported name for named imports. Default imports map to themselves because
 * the exported name cannot be recovered statically — callers should fall
 * through to `knownContourIds` membership on the local binding name.
 */
export const collectImportAliasMap = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') {
      return;
    }

    const specifiers =
      (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
    for (const specifier of specifiers) {
      const alias = extractImportSpecifierAlias(specifier);
      if (alias) {
        aliases.set(alias.localName, alias.importedName);
      }
    }
  });

  return aliases;
};

const addUserNamespaceBindingsFromDeclaration = (
  node: AstNode,
  into: Set<string>
): void => {
  if (isFrameworkNamespaceSource(getImportSourceValue(node))) {
    return;
  }
  const specifiers =
    (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
  for (const specifier of specifiers) {
    if (specifier.type !== 'ImportNamespaceSpecifier') {
      continue;
    }
    const { local } = specifier as unknown as { local?: AstNode };
    const localName = identifierName(local);
    if (localName) {
      into.add(localName);
    }
  }
};

/**
 * Collect local binding names introduced by `import * as <name> from '<src>'`
 * declarations whose source is NOT an `@ontrails/*` framework package. These
 * are user-defined namespace imports of contour modules (e.g. `import * as
 * contours from './contours'`), used to resolve `contours.user` member-access
 * references to contour ids.
 *
 * Framework namespace imports (`import * as core from '@ontrails/core'`) are
 * intentionally excluded — they carry framework primitives like
 * `core.contour(...)` and are resolved by {@link buildFrameworkNamespaceContext}.
 * Mixing them here would treat `core.contour` as a reference to a contour
 * named "contour", producing false positives.
 */
export const collectUserNamespaceImportBindings = (
  ast: AstNode
): ReadonlySet<string> => {
  const bindings = new Set<string>();

  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') {
      return;
    }
    addUserNamespaceBindingsFromDeclaration(node, bindings);
  });

  return bindings;
};

/**
 * Resolution context for user-namespace member access like `contours.user`.
 * Bundles the set of local namespace-binding names (from `import * as x from
 * './contours'`) with an optional set of proven-safe `MemberExpression` start
 * offsets from a scope-aware pre-pass. When `safeMemberStarts` is present, a
 * member access only resolves to a user-namespace target if its start is in
 * the set — so a function-local shadow of the namespace import does not leak
 * through. When absent, the name-only gate is used as a
 * backward-compatible fallback for ad-hoc callers.
 */
export interface UserNamespaceContext {
  readonly bindings: ReadonlySet<string>;
  readonly safeMemberStarts?: ReadonlySet<number>;
}

/**
 * Walk the AST with a scope stack and collect `MemberExpression` start offsets
 * whose receiver is a user-namespace binding that is NOT shadowed by any
 * enclosing scope. Mirrors `collectFrameworkNamespacedCallStarts` for the
 * framework-namespace path so `contours.user` inside
 * `function f(contours) { ... }` is rejected as shadowed.
 */
/**
 * Return the receiver-identifier name of a non-computed member access, or
 * `null` for any other node shape (computed access, non-member, etc.).
 */
const getNonComputedMemberReceiver = (node: AstNode): string | null => {
  if (!isMemberAccessNonComputed(node)) {
    return null;
  }
  const { object } = node as unknown as { object?: AstNode };
  return object ? identifierName(object) : null;
};

const collectUserNamespacedMemberStarts = (
  ast: AstNode,
  bindings: ReadonlySet<string>
): ReadonlySet<number> => {
  const starts = new Set<number>();
  if (bindings.size === 0) {
    return starts;
  }

  walkWithScopes(ast, (node, scopes) => {
    const receiver = getNonComputedMemberReceiver(node);
    if (!receiver || !bindings.has(receiver) || isShadowed(receiver, scopes)) {
      return;
    }
    starts.add(node.start);
  });

  return starts;
};

/**
 * Build a {@link UserNamespaceContext} for `ast`, including the scope-aware
 * `safeMemberStarts` gate. Prefer this over bare
 * {@link collectUserNamespaceImportBindings} so member access like
 * `contours.user` is rejected when `contours` is shadowed by a local binding.
 */
export const buildUserNamespaceContext = (
  ast: AstNode
): UserNamespaceContext => {
  const bindings = collectUserNamespaceImportBindings(ast);
  return {
    bindings,
    safeMemberStarts: collectUserNamespacedMemberStarts(ast, bindings),
  };
};

export interface ContourReferenceSite {
  /** Field on the source contour that declares the reference. */
  readonly field: string;
  /** Source contour name. */
  readonly source: string;
  /** Start offset of the field declaration. */
  readonly start: number;
  /** Target contour name. */
  readonly target: string;
}

/**
 * Read a property key or member access identifier.
 *
 * Returns the identifier name for `Identifier` keys, or the underlying
 * string literal value for computed access via `['name']` / `"name"`.
 */
export const getPropertyName = (node: unknown): string | null => {
  if (typeof node !== 'object' || node === null) {
    return null;
  }

  const { name } = node as { readonly name?: unknown };
  if (typeof name === 'string') {
    return name;
  }

  return isAstNode(node) ? extractStringLiteral(node) : null;
};

const stripContourSuffix = (name: string): string => {
  const suffix = 'Contour';
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
};

const resolveKnownContourName = (
  name: string,
  knownContourIds?: ReadonlySet<string>
): string | null => {
  if (knownContourIds?.has(name)) {
    return name;
  }

  // Support the common `const userContour = contour('user', ...)` naming
  // pattern when callers refer to the binding name instead of the contour ID.
  // Exact matches always win; suffix stripping is a fallback only.
  const stripped = stripContourSuffix(name);
  if (stripped !== name && knownContourIds?.has(stripped)) {
    return stripped;
  }

  return null;
};

/**
 * Resolve a local binding name to a contour ID, honoring import aliases.
 *
 * Strategies, in order:
 * 1. Local `const foo = contour('name', ...)` binding → the contour name.
 * 2. `knownContourIds` membership on the binding name itself (or the
 *    conventional `Contour` suffix strip).
 * 3. `import { foo as bar }` → use the original exported name `foo`
 *    (and apply strategy 2 / suffix-stripping against it so aliased imports
 *    resolve correctly). If the imported name still isn't recognized, the
 *    imported name is returned so the caller can report it missing.
 *
 * Returns `null` only when the name belongs to no known resolution path —
 * no local binding, no known contour ID, no import, and no suffix match.
 * Returning `null` means "this identifier is not a contour reference we can
 * reason about" (e.g. a bare undeclared variable), as opposed to
 * "a contour reference whose target is missing".
 */
export const deriveContourIdentifierName = (
  bindingName: string,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>
): string | null => {
  const localName = namedContourIds.get(bindingName);
  if (localName) {
    return localName;
  }

  const known = resolveKnownContourName(bindingName, knownContourIds);
  if (known) {
    return known;
  }

  // If the binding came from an import, use the original exported name as
  // the resolution target. This lets `import { foo as bar }` resolve to
  // the exported `foo` rather than the local alias `bar`. If the imported
  // name still isn't recognized, return it so callers can report it as
  // missing under its original name.
  const importedName = importAliases?.get(bindingName);
  if (importedName) {
    return (
      resolveKnownContourName(importedName, knownContourIds) ?? importedName
    );
  }

  return null;
};

const getContourReferenceMember = (
  node: AstNode
): {
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly start: number;
} | null => {
  if (
    node.type !== 'MemberExpression' &&
    node.type !== 'StaticMemberExpression'
  ) {
    return null;
  }

  return node as unknown as {
    readonly object?: AstNode;
    readonly property?: AstNode;
    readonly start: number;
  };
};

const asUserNamespaceContext = (
  input: ReadonlySet<string> | UserNamespaceContext | undefined
): UserNamespaceContext | undefined => {
  if (!input) {
    return undefined;
  }
  return input instanceof Set
    ? { bindings: input }
    : (input as UserNamespaceContext);
};

/**
 * Resolve a user-namespace member access like `contours.user` to its contour
 * id. Returns the property name (e.g. `'user'`) when the receiver identifier
 * is a known user-defined namespace binding AND — when the caller provides a
 * {@link UserNamespaceContext} with `safeMemberStarts` — the member access
 * site is in that set (i.e. the receiver is not shadowed by any enclosing
 * scope). Otherwise returns `null`.
 *
 * The property name is taken as the contour id verbatim — we cannot statically
 * resolve what `contours.user` binds to without reading the other file, so we
 * treat the member name as the candidate target and let
 * {@link deriveContourIdentifierName}'s downstream `knownContourIds` check
 * report a missing target.
 */
export const isUserNamespaceReceiverAllowed = (
  receiver: string,
  memberStart: number,
  ctx: UserNamespaceContext
): boolean => {
  if (!ctx.bindings.has(receiver)) {
    return false;
  }
  // Scope-aware gate: when the pre-pass produced a set, the member access
  // must appear in it. Without the set, fall back to the bare name check.
  return ctx.safeMemberStarts ? ctx.safeMemberStarts.has(memberStart) : true;
};

const getContourReferenceTargetFromNamespaceMember = (
  member: {
    readonly object?: AstNode;
    readonly property?: AstNode;
    readonly start: number;
  },
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): string | null => {
  const ctx = asUserNamespaceContext(userNamespace);
  if (!ctx || ctx.bindings.size === 0) {
    return null;
  }
  const receiver = member.object ? identifierName(member.object) : null;
  if (
    !receiver ||
    !isUserNamespaceReceiverAllowed(receiver, member.start, ctx)
  ) {
    return null;
  }
  const { property } = member;
  if (!property || property.type !== 'Identifier') {
    return null;
  }
  return identifierName(property);
};

const getContourReferenceTargetFromObject = (
  object: AstNode,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): string | null => {
  if (object.type === 'Identifier') {
    const bindingName = identifierName(object);
    return bindingName
      ? deriveContourIdentifierName(
          bindingName,
          namedContourIds,
          knownContourIds,
          importAliases
        )
      : null;
  }

  const member = getContourReferenceMember(object);
  if (member) {
    const namespaceTarget = getContourReferenceTargetFromNamespaceMember(
      member,
      userNamespace
    );
    if (namespaceTarget) {
      return namespaceTarget;
    }
  }

  return extractContourDefinition(object, context)?.name ?? null;
};

const CONTOUR_ID_WRAPPER_METHODS = new Set([
  'brand',
  'catch',
  'default',
  'describe',
  'meta',
  'nullable',
  'nullish',
  'optional',
  'readonly',
]);

const getContourIdCallMember = (
  node: AstNode
): {
  readonly member: NonNullable<ReturnType<typeof getContourReferenceMember>>;
  readonly propertyName: string;
} | null => {
  const callee = node['callee'] as AstNode | undefined;
  const member = callee ? getContourReferenceMember(callee) : null;
  const propertyName = member ? identifierName(member.property) : null;
  return member && propertyName ? { member, propertyName } : null;
};

const getContourIdCallObject = function getContourIdCallObject(
  node: AstNode | undefined
): AstNode | null {
  const current = node;
  if (!current || current.type !== 'CallExpression') {
    return null;
  }

  const member = getContourIdCallMember(current);
  if (!member) {
    return null;
  }
  if (member.propertyName === 'id') {
    return member.member.object ?? null;
  }

  return CONTOUR_ID_WRAPPER_METHODS.has(member.propertyName)
    ? getContourIdCallObject(member.member.object)
    : null;
};

const extractContourReferenceTarget = (
  node: AstNode | undefined,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): string | null => {
  const object = getContourIdCallObject(node);
  return object
    ? getContourReferenceTargetFromObject(
        object,
        namedContourIds,
        knownContourIds,
        importAliases,
        context,
        userNamespace
      )
    : null;
};

const getContourShapeProperties = (
  definition: ContourDefinition
): readonly AstNode[] =>
  (definition.shape['properties'] as readonly AstNode[] | undefined) ?? [];

const buildContourReferenceSite = (
  definition: ContourDefinition,
  property: AstNode,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): ContourReferenceSite | null => {
  if (property.type !== 'Property') {
    return null;
  }

  const field = getPropertyName(property.key);
  const target = extractContourReferenceTarget(
    property.value as AstNode | undefined,
    namedContourIds,
    knownContourIds,
    importAliases,
    context,
    userNamespace
  );
  if (!field || !target) {
    return null;
  }

  return {
    field,
    source: definition.name,
    start: property.start,
    target,
  };
};

const findContourReferenceSitesForDefinition = (
  definition: ContourDefinition,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): readonly ContourReferenceSite[] =>
  getContourShapeProperties(definition).flatMap((property) => {
    const reference = buildContourReferenceSite(
      definition,
      property,
      namedContourIds,
      knownContourIds,
      importAliases,
      context,
      userNamespace
    );
    return reference ? [reference] : [];
  });

/** Collect all contour field references declared via `.id()` in a parsed file. */
export const collectContourReferenceSites = (
  ast: AstNode,
  knownContourIds?: ReadonlySet<string>
): readonly ContourReferenceSite[] => {
  const namedContourIds = collectNamedContourIds(ast);
  const importAliases = collectImportAliasMap(ast);
  const userNamespace = buildUserNamespaceContext(ast);
  const context = buildFrameworkNamespaceContext(ast);
  return findContourDefinitions(ast, context).flatMap((definition) =>
    findContourReferenceSitesForDefinition(
      definition,
      namedContourIds,
      knownContourIds,
      importAliases,
      context,
      userNamespace
    )
  );
};

/** Collect contour reference targets keyed by source contour name. */
export const collectContourReferenceTargetsByName = (
  ast: AstNode,
  knownContourIds?: ReadonlySet<string>
): ReadonlyMap<string, readonly string[]> => {
  const targetsByName = new Map<string, Set<string>>();

  for (const reference of collectContourReferenceSites(ast, knownContourIds)) {
    const existing = targetsByName.get(reference.source);
    if (existing) {
      existing.add(reference.target);
      continue;
    }

    targetsByName.set(reference.source, new Set([reference.target]));
  }

  return new Map(
    [...targetsByName.entries()].map(([name, targets]) => [name, [...targets]])
  );
};

// ---------------------------------------------------------------------------
// Blaze body extraction
// ---------------------------------------------------------------------------

/**
 * Extract top-level `blaze:` property values from an ObjectExpression's direct properties.
 *
 * Does not recurse into nested objects, so `meta: { blaze: ... }` is ignored.
 */
const extractBlazeFromConfig = (config: AstNode): AstNode[] => {
  const bodies: AstNode[] = [];
  const properties = config['properties'] as readonly AstNode[] | undefined;
  if (!properties) {
    return bodies;
  }
  for (const prop of properties) {
    if (
      prop.type === 'Property' &&
      prop.key?.name === 'blaze' &&
      isAstNode(prop.value)
    ) {
      bodies.push(prop.value);
    }
  }
  return bodies;
};

/**
 * Find `blaze:` property values.
 *
 * When given an ObjectExpression (trail config), returns only its direct `blaze:`
 * properties. When given a full AST, finds trail definitions first and extracts
 * `blaze:` from each config — in both cases ignoring nested `blaze:` properties
 * (e.g. `meta: { blaze: ... }`).
 */
export const findBlazeBodies = (node: AstNode): AstNode[] => {
  if (node.type === 'ObjectExpression') {
    return extractBlazeFromConfig(node);
  }

  // Full AST — find trail definitions and extract blaze from their configs
  const bodies: AstNode[] = [];
  for (const def of findTrailDefinitions(node)) {
    bodies.push(...extractBlazeFromConfig(def.config));
  }
  return bodies;
};

/**
 * Collect all `signal('id', { ... })` / `signal({ id: 'x', ... })` definition IDs.
 *
 * Uses `findTrailDefinitions` under the hood — it already recognizes both
 * `trail` and `signal` call sites, distinguished by the `kind` field.
 */
export const collectSignalDefinitionIds = (
  ast: AstNode
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const def of findTrailDefinitions(ast)) {
    if (def.kind === 'signal') {
      ids.add(def.id);
    }
  }
  return ids;
};

/** Collect `const foo = trail('id', ...)` bindings from a parsed file. */
export const collectNamedTrailIds = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();
  const context = buildFrameworkNamespaceContext(ast);

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    if (!init) {
      return;
    }

    const def = extractTrailDefinition(init, context);
    const name = extractBindingName(id);
    if (def?.kind === 'trail' && name) {
      ids.set(name, def.id);
    }
  });

  return ids;
};

/** Extract the raw `crosses: [...]` array elements from a trail config. */
export const getCrossElements = (config: AstNode): readonly AstNode[] => {
  const crossesProp = findConfigProperty(config, 'crosses');
  if (!crossesProp) {
    return [];
  }

  const arrayNode = crossesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/**
 * Resolve a single `crosses: [...]` element to its target trail ID.
 *
 * Handles string literals, identifier references (via `namedTrailIds` map or
 * `const NAME = '...'` resolution), and inline `trail(...)` call expressions.
 */
export const deriveCrossElementId = (
  element: AstNode,
  sourceCode: string,
  namedTrailIds: ReadonlyMap<string, string>
): string | null => {
  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name
      ? (namedTrailIds.get(name) ?? deriveConstString(name, sourceCode))
      : null;
  }

  const inlineDef = extractTrailDefinition(element);
  return inlineDef?.kind === 'trail' ? inlineDef.id : null;
};

/**
 * Collect all trail IDs referenced by a single trail definition's
 * `crosses: [...]` array, deduplicated.
 */
export const extractDefinitionCrossTargetIds = (
  config: AstNode,
  sourceCode: string,
  namedTrailIds: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getCrossElements(config).flatMap((element) => {
      const id = deriveCrossElementId(element, sourceCode, namedTrailIds);
      return id ? [id] : [];
    })
  ),
];

/** Collect all trail IDs referenced by declared `crosses: [...]` arrays. */
export const collectCrossTargetTrailIds = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedTrailIds = collectNamedTrailIds(ast);

  for (const def of findTrailDefinitions(ast)) {
    if (def.kind !== 'trail') {
      continue;
    }

    for (const id of extractDefinitionCrossTargetIds(
      def.config,
      sourceCode,
      namedTrailIds
    )) {
      ids.add(id);
    }
  }

  return ids;
};

const extractTrailIntent = (config: AstNode): 'destroy' | 'read' | 'write' => {
  const intentProp = findConfigProperty(config, 'intent');
  if (!intentProp || !isStringLiteral(intentProp.value as AstNode)) {
    return 'write';
  }

  const value = getStringValue(intentProp.value as AstNode);
  return value === 'destroy' || value === 'read' ? value : 'write';
};

/** Collect the normalized intent for every trail definition in a parsed file. */
export const collectTrailIntentsById = (
  ast: AstNode
): ReadonlyMap<string, 'destroy' | 'read' | 'write'> => {
  const intents = new Map<string, 'destroy' | 'read' | 'write'>();

  for (const def of findTrailDefinitions(ast)) {
    if (def.kind === 'trail') {
      intents.set(def.id, extractTrailIntent(def.config));
    }
  }

  return intents;
};

// ---------------------------------------------------------------------------
// Store / factory pattern extraction
// ---------------------------------------------------------------------------

export interface StoreTableDefinition {
  /** Table name declared inside store({ ... }). */
  readonly name: string;
  /**
   * Local binding name of the enclosing `store(...)` declaration, if the
   * `store(...)` call is bound to a `const`/`let`/`var` (e.g. `db` in
   * `const db = store({ ... })`). Null for anonymous stores.
   */
  readonly storeBinding: string | null;
  /**
   * Stable composite key for this table in the form `${storeBinding}:${name}`,
   * falling back to the bare `name` when the store is anonymous. Use this for
   * cross-rule / cross-file keying so two stores with the same table name
   * never collide.
   */
  readonly key: string;
  /** Start offset of the table property declaration. */
  readonly start: number;
  /** Whether the authored table opts into version tracking. */
  readonly versioned: boolean;
}

/**
 * Build a composite key for a store table: `${storeBinding}:${tableName}`,
 * falling back to the bare `tableName` when the enclosing store has no local
 * binding. Centralized so rule keying stays stable.
 *
 * @remarks
 * The key is intentionally file-local (no module path prefix). Cross-file
 * aggregation in `ProjectContext` merges keys from all files, so two files
 * with `const db = store({ notes: ... })` both produce `db:notes` — this is
 * the desired behavior because the warden checks for *pattern completeness*
 * across the project and matching keys signals that the same logical table
 * is covered. If two genuinely different tables share a binding and name,
 * that is a code-level naming collision the developer should resolve.
 */
export const makeStoreTableKey = (
  storeBinding: string | null,
  tableName: string
): string => (storeBinding ? `${storeBinding}:${tableName}` : tableName);

const isBooleanLiteral = (node: AstNode | undefined): boolean =>
  Boolean(
    node &&
    ((node.type === 'BooleanLiteral' &&
      (node as unknown as { value?: unknown }).value === true) ||
      (node.type === 'Literal' &&
        (node as unknown as { value?: unknown }).value === true))
  );

/**
 * Check if a node is a `CallExpression` to the identifier `name`.
 *
 * e.g. `isNamedCall(node, 'store')` matches `store({...})` but not
 * `someObj.store()` or `storeAlt()`.
 */
export const isNamedCall = (node: AstNode | undefined, name: string): boolean =>
  !!node &&
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) === name;

/**
 * Narrow a member-expression node (`a.b` or `a['b']`) to its `object` /
 * `property` pair, returning `null` for anything else.
 */
export const getMemberExpression = (
  node: AstNode | undefined
): { readonly object?: AstNode; readonly property?: AstNode } | null => {
  if (
    !node ||
    (node.type !== 'MemberExpression' && node.type !== 'StaticMemberExpression')
  ) {
    return null;
  }

  return node as unknown as {
    readonly object?: AstNode;
    readonly property?: AstNode;
  };
};

/**
 * Resolve a `<store>.tables.<name>` member expression to its store binding
 * and table name.
 *
 * Returns `null` for anything that isn't a two-level member access ending in
 * `.tables.<name>`. The store binding is the identifier of the object owning
 * `.tables` — typically the local binding from `const db = store(...)`.
 */
export const extractStoreTableFromMember = (
  node: AstNode | undefined
): {
  readonly storeBinding: string | null;
  readonly tableName: string;
} | null => {
  const member = getMemberExpression(node);
  const tableName = member ? getPropertyName(member.property) : null;
  const tablesMember = member ? getMemberExpression(member.object) : null;
  if (!tableName || !tablesMember) {
    return null;
  }

  if (getPropertyName(tablesMember.property) !== 'tables') {
    return null;
  }

  const storeBinding = identifierName(tablesMember.object) ?? null;
  return { storeBinding, tableName };
};

/**
 * Back-compat shim for rule code that only needs the table name. Prefer
 * `extractStoreTableFromMember` so the caller can build a composite key.
 */
export const extractStoreTableIdFromMember = (
  node: AstNode | undefined
): string | null => extractStoreTableFromMember(node)?.tableName ?? null;

/**
 * Collect `const foo = <store>.tables.<name>` bindings from a parsed file,
 * keyed by the local binding name. Values are the composite table key
 * (`${storeBinding}:${tableName}`) so callers can dedupe across stores that
 * share a table name.
 */
export const collectNamedStoreTableIds = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = extractBindingName(id);
    const table = extractStoreTableFromMember(init);
    if (name && table) {
      ids.set(name, makeStoreTableKey(table.storeBinding, table.tableName));
    }
  });

  return ids;
};

/**
 * Resolve an argument node to a composite store-table key
 * (`${storeBinding}:${tableName}` or bare `tableName` when anonymous).
 *
 * Handles the two authoring patterns:
 *   - direct member access: `db.tables.notes`
 *   - identifier reference: `const notesTable = db.tables.notes; crud(notesTable, …)`
 */
export const deriveStoreTableId = (
  node: AstNode | undefined,
  namedStoreTableIds: ReadonlyMap<string, string>
): string | null => {
  if (!node) {
    return null;
  }

  if (node.type === 'Identifier') {
    const name = identifierName(node);
    return name ? (namedStoreTableIds.get(name) ?? null) : null;
  }

  const member = extractStoreTableFromMember(node);
  return member
    ? makeStoreTableKey(member.storeBinding, member.tableName)
    : null;
};

const extractStoreTableDefinitions = (
  node: AstNode,
  storeBinding: string | null
): readonly StoreTableDefinition[] => {
  if (!isNamedCall(node, 'store')) {
    return [];
  }

  const [tablesArg] = ((node as unknown as { arguments?: readonly AstNode[] })
    .arguments ?? []) as readonly AstNode[];
  if (!tablesArg || tablesArg.type !== 'ObjectExpression') {
    return [];
  }

  const properties = tablesArg['properties'] as readonly AstNode[] | undefined;
  if (!properties) {
    return [];
  }

  return properties.flatMap((property) => {
    if (property.type !== 'Property') {
      return [];
    }

    const name = getPropertyName(property.key);
    const value = property.value as AstNode | undefined;
    if (!name || value?.type !== 'ObjectExpression') {
      return [];
    }

    const versionedProp = findConfigProperty(value, 'versioned');
    return [
      {
        key: makeStoreTableKey(storeBinding, name),
        name,
        start: property.start,
        storeBinding,
        versioned: isBooleanLiteral(
          versionedProp?.value as AstNode | undefined
        ),
      },
    ];
  });
};

export const findStoreTableDefinitions = (
  ast: AstNode
): readonly StoreTableDefinition[] => {
  const definitions: StoreTableDefinition[] = [];
  const seenStoreCalls = new WeakSet<AstNode>();

  // First pass: bound stores (walk VariableDeclarators so we know the binding).
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    if (!init || !isNamedCall(init, 'store')) {
      return;
    }

    seenStoreCalls.add(init);
    const storeBinding = extractBindingName(id);
    definitions.push(...extractStoreTableDefinitions(init, storeBinding));
  });

  // Second pass: anonymous `store({...})` calls not bound to a variable
  // (e.g. an inline default export). Use the bare table name as the key.
  walk(ast, (node) => {
    if (!isNamedCall(node, 'store') || seenStoreCalls.has(node)) {
      return;
    }
    definitions.push(...extractStoreTableDefinitions(node, null));
  });

  return definitions;
};

export const collectVersionedStoreTableIds = (
  ast: AstNode
): ReadonlySet<string> =>
  new Set(
    findStoreTableDefinitions(ast).flatMap((definition) =>
      definition.versioned ? [definition.key] : []
    )
  );

export const collectCrudTableIds = (ast: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);

  walk(ast, (node) => {
    if (!isNamedCall(node, 'crud')) {
      return;
    }

    const [tableArg] = ((node as unknown as { arguments?: readonly AstNode[] })
      .arguments ?? []) as readonly AstNode[];
    const tableId = deriveStoreTableId(tableArg, namedStoreTableIds);
    if (tableId) {
      ids.add(tableId);
    }
  });

  return ids;
};

export const collectReconcileTableIds = (ast: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);

  walk(ast, (node) => {
    if (!isNamedCall(node, 'reconcile')) {
      return;
    }

    const [configArg] = ((
      node as unknown as {
        arguments?: readonly AstNode[];
      }
    ).arguments ?? []) as readonly AstNode[];
    if (!configArg || configArg.type !== 'ObjectExpression') {
      return;
    }

    const tableProp = findConfigProperty(configArg, 'table');
    const tableId = deriveStoreTableId(
      tableProp?.value as AstNode | undefined,
      namedStoreTableIds
    );
    if (tableId) {
      ids.add(tableId);
    }
  });

  return ids;
};

const STORE_SIGNAL_OPERATIONS = new Set(['created', 'removed', 'updated']);

const extractStoreSignalIdFromMember = (
  node: AstNode | undefined,
  namedStoreTableIds: ReadonlyMap<string, string>
): string | null => {
  const member = getMemberExpression(node);
  const operation = member ? getPropertyName(member.property) : null;
  if (!operation || !STORE_SIGNAL_OPERATIONS.has(operation)) {
    return null;
  }

  const signalsMember = member ? getMemberExpression(member.object) : null;
  if (!signalsMember || getPropertyName(signalsMember.property) !== 'signals') {
    return null;
  }

  const tableId = deriveStoreTableId(signalsMember.object, namedStoreTableIds);
  return tableId ? `${tableId}.${operation}` : null;
};

const collectNamedStoreSignalIds = (
  ast: AstNode,
  namedStoreTableIds: ReadonlyMap<string, string>
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = extractBindingName(id);
    const signalId = extractStoreSignalIdFromMember(init, namedStoreTableIds);
    if (name && signalId) {
      ids.set(name, signalId);
    }
  });

  return ids;
};

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

const resolveNamedOnSignalId = (
  element: AstNode,
  sourceCode: string,
  namedStoreSignalIds: ReadonlyMap<string, string>
): string | null => {
  if (element.type !== 'Identifier') {
    return null;
  }

  const name = identifierName(element);
  return name
    ? (namedStoreSignalIds.get(name) ?? deriveConstString(name, sourceCode))
    : null;
};

const resolveInlineOnSignalId = (element: AstNode): string | null => {
  const definition = extractTrailDefinition(element);
  return definition?.kind === 'signal' ? definition.id : null;
};

const resolveOnElementSignalId = (
  element: AstNode,
  sourceCode: string,
  namedStoreSignalIds: ReadonlyMap<string, string>,
  namedStoreTableIds: ReadonlyMap<string, string>
): string | null => {
  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  return (
    extractStoreSignalIdFromMember(element, namedStoreTableIds) ??
    resolveNamedOnSignalId(element, sourceCode, namedStoreSignalIds) ??
    resolveInlineOnSignalId(element)
  );
};

const addOnTargetSignalIds = (
  config: AstNode,
  ids: Set<string>,
  sourceCode: string,
  namedStoreSignalIds: ReadonlyMap<string, string>,
  namedStoreTableIds: ReadonlyMap<string, string>
): void => {
  for (const element of getOnElements(config)) {
    const signalId = resolveOnElementSignalId(
      element,
      sourceCode,
      namedStoreSignalIds,
      namedStoreTableIds
    );
    if (signalId) {
      ids.add(signalId);
    }
  }
};

export const collectOnTargetSignalIds = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);
  const namedStoreSignalIds = collectNamedStoreSignalIds(
    ast,
    namedStoreTableIds
  );

  for (const definition of findTrailDefinitions(ast)) {
    if (definition.kind === 'trail') {
      addOnTargetSignalIds(
        definition.config,
        ids,
        sourceCode,
        namedStoreSignalIds,
        namedStoreTableIds
      );
    }
  }

  return ids;
};

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Check if a node is a call to `.blaze()` on some object. */
export const isBlazeCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return false;
  }
  if (
    callee.type !== 'StaticMemberExpression' &&
    callee.type !== 'MemberExpression'
  ) {
    return false;
  }
  const prop = (callee as unknown as { property?: AstNode }).property;
  return (
    prop?.type === 'Identifier' &&
    (prop as unknown as { name: string }).name === 'blaze'
  );
};
