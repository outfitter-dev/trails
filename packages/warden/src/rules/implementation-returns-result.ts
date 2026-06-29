/**
 * Finds implementations that return raw values instead of `Result`.
 *
 * Uses AST parsing to find `blaze:` bodies and check that
 * every return statement returns Result.ok(), Result.err(), ctx.compose(),
 * or a tracked Result-typed variable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { escapeRegExp } from '@ontrails/core';
import type { AstNode } from './ast.js';
import {
  collectScopeFrameBindings,
  findBlazeBodies,
  findTrailDefinitions,
  getMemberExpression,
  getNodeAlternate,
  getNodeArgument,
  getNodeBodyNode,
  getNodeBodyStatements,
  getNodeConsequent,
  getNodeDeclaration,
  getNodeExportKind,
  getNodeExpression,
  getNodeId,
  getNodeImported,
  getNodeInit,
  getNodeLocal,
  getNodeName,
  getNodeReturnType,
  getNodeSource,
  getNodeTypeAnnotation,
  getNodeValue,
  identifierName,
  offsetToLine,
  parse,
  walk,
  walkWithScopes,
} from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const buildUnrecognizedResultMessage = (label: string, id: string): string =>
  `${label} "${id}": return value is not a recognized Result expression. Return Result.ok(...), Result.err(...), or a Result-producing expression such as await ctx.compose(...). If you are returning a composed/helper Result, keep the provenance visible or add a Result return annotation Warden can trace.`;

// ---------------------------------------------------------------------------
// Member expression helpers
// ---------------------------------------------------------------------------

const isResultMemberCall = (callee: AstNode): boolean => {
  const member = getMemberExpression(callee);
  if (!member) {
    return false;
  }
  const objName = identifierName(member.object) ?? undefined;
  const propName = identifierName(member.property) ?? undefined;
  if (objName === 'Result' && (propName === 'ok' || propName === 'err')) {
    return true;
  }
  if (objName === 'ctx' && propName === 'compose') {
    return true;
  }
  return propName === 'blaze';
};

// ---------------------------------------------------------------------------
// Expression classification
// ---------------------------------------------------------------------------

/** Check if an expression node is an allowed Result-returning expression. */
export const isResultExpression = (node: AstNode): boolean => {
  if (node.type === 'CallExpression') {
    const callee = node['callee'] as AstNode | undefined;
    if (!callee) {
      return false;
    }
    return isResultMemberCall(callee);
  }

  if (node.type === 'AwaitExpression') {
    const arg = getNodeArgument(node);
    return arg ? isResultExpression(arg) : false;
  }

  return false;
};

/** Map of namespace-import local name to the set of Result-helper names exported by the target module. */
export type NamespaceHelperMap = ReadonlyMap<string, ReadonlySet<string>>;

/** Map of lexical scope frames to local helper bindings with explicit Result return types. */
export type ScopedHelperMap = ReadonlyMap<
  ReadonlySet<string>,
  ReadonlySet<string>
>;

export type MutableScopedHelperMap = Map<ReadonlySet<string>, Set<string>>;

type ScopedResultVariableMap = ReadonlyMap<
  ReadonlySet<string>,
  ReadonlySet<string>
>;

type MutableScopedResultVariableMap = Map<ReadonlySet<string>, Set<string>>;

export const findNearestBindingScope = (
  name: string,
  scopes: readonly ReadonlySet<string>[]
): ReadonlySet<string> | null =>
  scopes.find((scope) => scope.has(name)) ?? null;

const isScopedHelperBinding = (
  name: string,
  scope: ReadonlySet<string>,
  scopedHelpers: ScopedHelperMap
): boolean => scopedHelpers.get(scope)?.has(name) ?? false;

const isScopedResultVariableBinding = (
  name: string,
  scopes: readonly ReadonlySet<string>[],
  resultVars: ScopedResultVariableMap
): boolean => {
  const bindingScope = findNearestBindingScope(name, scopes);
  return Boolean(bindingScope && resultVars.get(bindingScope)?.has(name));
};

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
  const member = getMemberExpression(callee);
  if (!member) {
    return false;
  }
  const objName = identifierName(member.object) ?? undefined;
  const propName = identifierName(member.property) ?? undefined;
  if (!(objName && propName)) {
    return false;
  }
  // Nearest binding is a local, not the namespace import.
  if (scopes.some((scope) => scope.has(objName))) {
    return false;
  }
  return namespaceHelpers.get(objName)?.has(propName) ?? false;
};

/** Check if a node is a call to a known Result-returning helper. */
export const isHelperCall = (
  node: AstNode,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap = new Map(),
  scopes: readonly ReadonlySet<string>[] = [],
  scopedHelpers: ScopedHelperMap = new Map()
): boolean => {
  const target =
    node.type === 'AwaitExpression' ? (getNodeArgument(node) ?? null) : node;

  if (!target || target.type !== 'CallExpression') {
    return false;
  }

  const callee = target['callee'] as AstNode | undefined;
  if (callee?.type === 'Identifier') {
    const name = getNodeName(callee);
    if (!name) {
      return false;
    }
    const bindingScope = findNearestBindingScope(name, scopes);
    if (
      bindingScope &&
      !isScopedHelperBinding(name, bindingScope, scopedHelpers)
    ) {
      return false;
    }
    return helperNames.has(name);
  }

  return callee
    ? isNamespaceHelperMemberCall(callee, namespaceHelpers, scopes)
    : false;
};

/** Unwrap an optional AwaitExpression to get the inner identifier name. */
const resolveIdentifierName = (node: AstNode): string | null => {
  if (node.type === 'Identifier') {
    return getNodeName(node) ?? null;
  }
  if (node.type === 'AwaitExpression') {
    const inner = getNodeArgument(node);
    if (inner?.type === 'Identifier') {
      return getNodeName(inner) ?? null;
    }
  }
  return null;
};

const unwrapReturnExpression = (node: AstNode): AstNode => {
  let current = node;
  while (
    current.type === 'AwaitExpression' ||
    current.type === 'ParenthesizedExpression'
  ) {
    const next =
      current.type === 'AwaitExpression'
        ? getNodeArgument(current)
        : getNodeExpression(current);
    if (!next) {
      return current;
    }
    current = next;
  }
  return current;
};

/** Check if a return argument is an allowed Result value. */
const isAllowedReturnArgument = (
  argument: AstNode,
  helperNames: ReadonlySet<string>,
  resultVars: ScopedResultVariableMap,
  namespaceHelpers: NamespaceHelperMap,
  scopes: readonly ReadonlySet<string>[] = [],
  scopedHelpers: ScopedHelperMap = new Map()
): boolean => {
  const target = unwrapReturnExpression(argument);
  if (target.type === 'ConditionalExpression') {
    const alternate = getNodeAlternate(target);
    const consequent = getNodeConsequent(target);
    return (
      consequent !== undefined &&
      alternate !== undefined &&
      isAllowedReturnArgument(
        consequent,
        helperNames,
        resultVars,
        namespaceHelpers,
        scopes,
        scopedHelpers
      ) &&
      isAllowedReturnArgument(
        alternate,
        helperNames,
        resultVars,
        namespaceHelpers,
        scopes,
        scopedHelpers
      )
    );
  }
  if (isResultExpression(target)) {
    return true;
  }
  if (
    isHelperCall(target, helperNames, namespaceHelpers, scopes, scopedHelpers)
  ) {
    return true;
  }

  const varName = resolveIdentifierName(target);
  return (
    varName !== null &&
    isScopedResultVariableBinding(varName, scopes, resultVars)
  );
};

// ---------------------------------------------------------------------------
// Result helper name collection
// ---------------------------------------------------------------------------

const getImportSourceValue = (node: AstNode): string | null => {
  const sourceNode = getNodeSource(node);
  const sourceValue = sourceNode ? getNodeValue(sourceNode) : undefined;
  return typeof sourceValue === 'string' ? sourceValue : null;
};

const extractIdentifierName = (node: AstNode | undefined): string | null =>
  node?.type === 'Identifier' ? (getNodeName(node) ?? null) : null;

const DEFAULT_RESULT_TYPE_NAMES = new Set(['Result']);

const hasGenericTypeReference = (
  annotationText: string,
  typeName: string
): boolean =>
  new RegExp(`(^|[^\\w$])${escapeRegExp(typeName)}\\s*<`).test(annotationText);

export const collectResultTypeNames = (ast: AstNode): ReadonlySet<string> => {
  const names = new Set(DEFAULT_RESULT_TYPE_NAMES);
  walk(ast, (node) => {
    if (
      node.type !== 'ImportDeclaration' ||
      getImportSourceValue(node) !== '@ontrails/core'
    ) {
      return;
    }
    const specifiers =
      (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
    for (const specifier of specifiers) {
      if (specifier.type !== 'ImportSpecifier') {
        continue;
      }
      const imported = getNodeImported(specifier);
      const local = getNodeLocal(specifier);
      if (extractIdentifierName(imported) !== 'Result') {
        continue;
      }
      names.add(extractIdentifierName(local) ?? 'Result');
    }
  });
  return names;
};

/** Check if a return type annotation mentions Result or an imported Result alias. */
const hasResultReturnType = (
  node: AstNode,
  sourceCode: string,
  resultTypeNames: ReadonlySet<string> = DEFAULT_RESULT_TYPE_NAMES
): boolean => {
  const returnType = getNodeReturnType(node);
  if (!returnType) {
    return false;
  }
  const annotationText = sourceCode.slice(returnType.start, returnType.end);
  for (const name of resultTypeNames) {
    if (hasGenericTypeReference(annotationText, name)) {
      return true;
    }
  }
  return false;
};

const isFunctionLikeExpression = (node: AstNode): boolean =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

const addScopedHelper = (
  scopedHelpers: MutableScopedHelperMap,
  scope: ReadonlySet<string>,
  name: string
): void => {
  const existing = scopedHelpers.get(scope);
  if (existing) {
    existing.add(name);
    return;
  }
  scopedHelpers.set(scope, new Set([name]));
};

const addScopedResultVariable = (
  resultVars: MutableScopedResultVariableMap,
  scope: ReadonlySet<string>,
  name: string
): void => {
  const existing = resultVars.get(scope);
  if (existing) {
    existing.add(name);
    return;
  }
  resultVars.set(scope, new Set([name]));
};

/** Record `const helper = (): Result<...> => ...` declarations for the current lexical scope. */
export const trackScopedResultHelperDeclaration = (
  node: AstNode,
  scopes: readonly ReadonlySet<string>[],
  sourceCode: string,
  resultTypeNames: ReadonlySet<string>,
  scopedHelpers: MutableScopedHelperMap
): void => {
  if (node.type !== 'VariableDeclarator') {
    return;
  }
  const id = getNodeId(node);
  const init = getNodeInit(node);
  const name = extractIdentifierName(id);
  if (!(name && init && isFunctionLikeExpression(init))) {
    return;
  }
  if (!hasResultReturnType(init, sourceCode, resultTypeNames)) {
    return;
  }
  const bindingScope = findNearestBindingScope(name, scopes);
  if (bindingScope) {
    addScopedHelper(scopedHelpers, bindingScope, name);
  }
};

// ---------------------------------------------------------------------------
// Variable tracking
// ---------------------------------------------------------------------------

const hasResultVariableAnnotation = (
  node: AstNode,
  sourceCode: string,
  resultTypeNames: ReadonlySet<string>
): boolean => {
  const typeAnnotation = getNodeTypeAnnotation(node);
  if (!typeAnnotation) {
    return false;
  }
  const annotationText = sourceCode.slice(
    typeAnnotation.start,
    typeAnnotation.end
  );
  for (const name of resultTypeNames) {
    if (hasGenericTypeReference(annotationText, name)) {
      return true;
    }
  }
  return false;
};

/** Track a VariableDeclarator, adding to resultVars if it produces a Result. */
const trackResultVariable = (
  node: AstNode,
  resultVars: MutableScopedResultVariableMap,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  scopes: readonly ReadonlySet<string>[],
  scopedHelpers: ScopedHelperMap,
  sourceCode: string,
  resultTypeNames: ReadonlySet<string>
): void => {
  const init = getNodeInit(node);
  const id = getNodeId(node);
  if (init && id?.type === 'Identifier') {
    const name = getNodeName(id);
    if (!name) {
      return;
    }
    if (
      hasResultVariableAnnotation(id, sourceCode, resultTypeNames) ||
      isResultExpression(init) ||
      isHelperCall(init, helperNames, namespaceHelpers, scopes, scopedHelpers)
    ) {
      const bindingScope = findNearestBindingScope(name, scopes);
      if (bindingScope) {
        addScopedResultVariable(resultVars, bindingScope, name);
      }
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
  resultTypeNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[],
  implScope: ReadonlySet<string> = new Set<string>()
): void => {
  const resultVars: MutableScopedResultVariableMap = new Map();
  const scopedHelpers: MutableScopedHelperMap = new Map();
  const initialScopes = implScope.size > 0 ? [implScope] : [];

  walkWithScopes(
    blockBody,
    (node, currentScopes) => {
      if (node.type === 'VariableDeclarator') {
        trackScopedResultHelperDeclaration(
          node,
          currentScopes,
          sourceCode,
          resultTypeNames,
          scopedHelpers
        );
        trackResultVariable(
          node,
          resultVars,
          helperNames,
          namespaceHelpers,
          currentScopes,
          scopedHelpers,
          sourceCode,
          resultTypeNames
        );
      }

      if (node.type !== 'ReturnStatement') {
        return;
      }

      const argument = getNodeArgument(node);
      // Bare return is not a value return.
      if (!argument) {
        return;
      }

      if (
        isAllowedReturnArgument(
          argument,
          helperNames,
          resultVars,
          namespaceHelpers,
          currentScopes,
          scopedHelpers
        )
      ) {
        return;
      }

      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, node.start),
        message: buildUnrecognizedResultMessage(trailInfo.label, trailInfo.id),
        rule: 'implementation-returns-result',
        severity: 'error',
      });
    },
    { initialScopes, stopAtNestedFunctions: true }
  );
};

/** Collect names of top-level functions/consts with explicit Result return types. */
const collectResultHelperNames = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const names = new Set<string>();
  const resultTypeNames = collectResultTypeNames(ast);

  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator') {
      const id = getNodeId(node);
      const init = getNodeInit(node);
      if (
        id?.type === 'Identifier' &&
        init &&
        isFunctionLikeExpression(init) &&
        hasResultReturnType(init, sourceCode, resultTypeNames)
      ) {
        const name = getNodeName(id);
        if (name) {
          names.add(name);
        }
      }
    }

    if (node.type === 'FunctionDeclaration') {
      const id = getNodeId(node);
      if (
        id?.type === 'Identifier' &&
        hasResultReturnType(node, sourceCode, resultTypeNames)
      ) {
        const name = getNodeName(id);
        if (name) {
          names.add(name);
        }
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

const buildDefaultImportBinding = (
  specifier: AstNode,
  source: string
): ImportBinding | null => {
  const local = getNodeLocal(specifier);
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
  const local = getNodeLocal(specifier);
  const imported = getNodeImported(specifier);
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

/** Collect `import {
  foo as bar
} from './...';` bindings keyed by local name. */
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
  const decl = getNodeDeclaration(node);
  return decl ?? null;
};

const addExportedVariableResultHelper = (
  decl: AstNode,
  source: string,
  collected: Set<string>,
  resultTypeNames: ReadonlySet<string>
): void => {
  const declarations =
    (decl['declarations'] as readonly AstNode[] | undefined) ?? [];
  for (const declarator of declarations) {
    const id = getNodeId(declarator);
    const init = getNodeInit(declarator);
    const name = extractIdentifierName(id);
    if (
      name &&
      init &&
      isFunctionLikeExpression(init) &&
      hasResultReturnType(init, source, resultTypeNames)
    ) {
      collected.add(name);
    }
  }
};

const addExportedFunctionResultHelper = (
  decl: AstNode,
  source: string,
  collected: Set<string>,
  resultTypeNames: ReadonlySet<string>
): void => {
  const name = extractIdentifierName(getNodeId(decl));
  if (name && hasResultReturnType(decl, source, resultTypeNames)) {
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
    const id = getNodeId(declarator);
    const init = getNodeInit(declarator);
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
  const name = extractIdentifierName(getNodeId(decl));
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
  const bodyNodes = getNodeBodyStatements(ast);
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
    return getNodeName(node) ?? null;
  }
  // Support string-literal specifiers (`export { "default" as X }`, etc).
  const value = getNodeValue(node);
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
  const bodyNodes = getNodeBodyStatements(ast);
  for (const node of bodyNodes) {
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = getNodeDeclaration(node);
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
  source: string,
  resultTypeNames: ReadonlySet<string>
): boolean => {
  if (!declarationNode) {
    return false;
  }
  if (isFunctionLikeExpression(declarationNode)) {
    return hasResultReturnType(declarationNode, source, resultTypeNames);
  }
  if (declarationNode.type === 'FunctionDeclaration') {
    return hasResultReturnType(declarationNode, source, resultTypeNames);
  }
  return false;
};

/** Resolve an `export default ...` declaration, following one identifier hop. */
const checkDefaultDeclarationIsResultHelper = (
  defaultDecl: AstNode,
  targetSource: string,
  targetLocalDeclarations: DeclarationIndex,
  resultTypeNames: ReadonlySet<string>
): boolean => {
  if (isResultHelperDeclaration(defaultDecl, targetSource, resultTypeNames)) {
    return true;
  }
  if (defaultDecl.type === 'Identifier') {
    const name = extractIdentifierName(defaultDecl);
    const referenced = name ? targetLocalDeclarations.get(name) : undefined;
    return isResultHelperDeclaration(referenced, targetSource, resultTypeNames);
  }
  return false;
};

interface LoadedTargetFile {
  readonly ast: AstNode;
  readonly source: string;
  readonly localDeclarations: DeclarationIndex;
  readonly resultTypeNames: ReadonlySet<string>;
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
      resultTypeNames: collectResultTypeNames(ast),
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
      loadedTarget.localDeclarations,
      loadedTarget.resultTypeNames
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
  collected: Set<string>,
  resultTypeNames: ReadonlySet<string>
): void => {
  for (const spec of specifiers) {
    const info = buildExportSpecifierInfo(spec);
    if (!info || info.isDefault) {
      continue;
    }
    if (
      isResultHelperDeclaration(
        localDeclarations.get(info.localName),
        source,
        resultTypeNames
      )
    ) {
      collected.add(info.exportedName);
    }
  }
};

const processInlineExportedDeclaration = (
  exportedDecl: AstNode,
  source: string,
  collected: Set<string>,
  resultTypeNames: ReadonlySet<string>
): boolean => {
  if (exportedDecl.type === 'VariableDeclaration') {
    addExportedVariableResultHelper(
      exportedDecl,
      source,
      collected,
      resultTypeNames
    );
    return true;
  }
  if (exportedDecl.type === 'FunctionDeclaration') {
    addExportedFunctionResultHelper(
      exportedDecl,
      source,
      collected,
      resultTypeNames
    );
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
  collected: Set<string>,
  resultTypeNames: ReadonlySet<string>
): void => {
  const exportedDecl = getExportedDeclaration(node);
  if (
    exportedDecl &&
    processInlineExportedDeclaration(
      exportedDecl,
      source,
      collected,
      resultTypeNames
    )
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
    collected,
    resultTypeNames
  );
};

const processExportDefaultDeclaration = (
  node: AstNode,
  source: string,
  localDeclarations: DeclarationIndex,
  collected: Set<string>,
  resultTypeNames: ReadonlySet<string>
): void => {
  const defaultDecl = getNodeDeclaration(node);
  if (!defaultDecl) {
    return;
  }
  if (
    checkDefaultDeclarationIsResultHelper(
      defaultDecl,
      source,
      localDeclarations,
      resultTypeNames
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
  preloadedLocalDeclarations: DeclarationIndex | null = null,
  preloadedResultTypeNames: ReadonlySet<string> | null = null
): ReadonlySet<string> => {
  const collected = new Set<string>();
  // Reuse preloaded indexes from `loadTargetFile` when available to avoid
  // re-walking the same AST.
  const localDeclarations =
    preloadedLocalDeclarations ?? indexLocalDeclarations(ast);
  const resultTypeNames =
    preloadedResultTypeNames ?? collectResultTypeNames(ast);
  const bodyNodes = getNodeBodyStatements(ast);

  for (const node of bodyNodes) {
    if (node.type === 'ExportNamedDeclaration') {
      processExportNamedDeclaration(
        node,
        source,
        targetPath,
        visited,
        depth,
        localDeclarations,
        collected,
        resultTypeNames
      );
    } else if (node.type === 'ExportDefaultDeclaration') {
      processExportDefaultDeclaration(
        node,
        source,
        localDeclarations,
        collected,
        resultTypeNames
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
  const exportKind = getNodeExportKind(node);
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
    loaded.localDeclarations,
    loaded.resultTypeNames
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
  const local = getNodeLocal(spec);
  return extractIdentifierName(local);
};

/**
 * Resolve a single namespace specifier to (localName, resultHelperNames), or
 * null when the specifier is not a resolvable namespace import.
 *
 * We intentionally record the namespace even when the target file exports no
 * Result helpers (empty set). `isNamespaceHelperMemberCall` can then identify
 * `ns.anything()` as a namespace member call against a non-Result-helper
 * target — which correctly falls through to the general return-value
 * diagnostic path. Dropping the entry would misclassify the call as a
 * *non-namespace* member call and skip the namespace-shadowing scope check.
 */
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
  return { localName, names };
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
export const collectNamespaceHelperImports = (
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
export const collectAllResultHelperNames = (
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
  resultTypeNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const fnBody = getNodeBodyNode(implValue);
  if (!fnBody) {
    return;
  }

  // Seed analysis with the implementation's own bindings so parameter names
  // and hoisted vars shadow namespace imports in both block and concise bodies.
  const implScope = collectScopeFrameBindings(implValue);

  if (fnBody.type === 'BlockStatement' || fnBody.type === 'FunctionBody') {
    checkReturnStatements(
      fnBody,
      info,
      filePath,
      sourceCode,
      helperNames,
      namespaceHelpers,
      resultTypeNames,
      diagnostics,
      implScope
    );
    return;
  }

  const conciseScopes: readonly ReadonlySet<string>[] =
    implScope.size > 0 ? [implScope] : [];
  const isConciseResultBody = (node: AstNode): boolean => {
    const target = unwrapReturnExpression(node);
    if (target.type === 'ConditionalExpression') {
      const alternate = getNodeAlternate(target);
      const consequent = getNodeConsequent(target);
      return (
        consequent !== undefined &&
        alternate !== undefined &&
        isConciseResultBody(consequent) &&
        isConciseResultBody(alternate)
      );
    }
    return (
      isResultExpression(target) ||
      isHelperCall(target, helperNames, namespaceHelpers, conciseScopes)
    );
  };
  if (!isConciseResultBody(fnBody)) {
    diagnostics.push({
      filePath,
      line: offsetToLine(sourceCode, implValue.start),
      message: buildUnrecognizedResultMessage(info.label, info.id),
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
  const resultTypeNames = collectResultTypeNames(ast);

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
        resultTypeNames,
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
