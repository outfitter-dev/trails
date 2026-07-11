/** Shared Trails framework and generic entity-definition recognition helpers. */

import { isAstNode, isProperty } from './nodes.js';
import type { AstNode } from './nodes.js';
import {
  extractBindingName,
  extractStringLiteral,
  extractStringOrTemplateLiteral,
  findConfigProperty,
  identifierName,
} from './literals.js';
import {
  isMemberAccessNonComputed,
  isShadowed,
  walkWithScopes,
} from './scopes.js';
import { walk } from './walk.js';

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
 * recognized as carriers of `trail()` / `signal()` / `entity()` primitives.
 *
 * A namespaced callee like `core.trail(...)` is only treated as a framework
 * call when the receiver identifier resolves to an `import * as core from
 * '@ontrails/...'` in the same file. An unrelated `analytics.trail(...)`
 * whose `analytics` comes from a different module (or no import at all)
 * is ignored.
 */
const FRAMEWORK_NAMESPACE_SOURCE_PREFIX = '@ontrails/';

export const isFrameworkNamespaceSource = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.startsWith(FRAMEWORK_NAMESPACE_SOURCE_PREFIX);

/**
 * Collect local binding names introduced by `import * as <name> from
 * '@ontrails/...'` declarations. Used to gate namespaced framework-primitive
 * calls so an unrelated `analytics.trail(...)` doesn't match.
 */
export const getImportSourceValue = (node: AstNode): unknown => {
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

export const collectFrameworkNamespaceBindings = (
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

export const resolveNamespacedMemberNames = (
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
 * `core.signal(...)` / `core.entity(...)` resolution against local shadows.
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

export const getNamespacedMemberNames = (
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

export const asNamespaceContext = (
  input: ReadonlySet<string> | FrameworkNamespaceContext | undefined
): FrameworkNamespaceContext | undefined => {
  if (!input) {
    return undefined;
  }
  return input instanceof Set
    ? { namespaces: input }
    : (input as FrameworkNamespaceContext);
};

export const isNamespacedCallAllowed = (
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
 * not have the surrounding AST available (e.g. `composes: [core.trail(...)]`
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

export const extractTrailDefinition = (
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

export const buildFrameworkNamespaceContext = (
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

export interface EntityDefinition {
  /** Local binding name when the entity is assigned to a variable. */
  readonly bindingName?: string;
  /** Entity name string, e.g. "user". */
  readonly name: string;
  /** Original call expression for the entity declaration. */
  readonly call: AstNode;
  /** Options object argument passed to entity(), when present. */
  readonly options: AstNode | null;
  /** Shape object argument passed to entity(). */
  readonly shape: AstNode;
  /** Start offset of the call expression. */
  readonly start: number;
}

const ENTITY_PRIMITIVE_NAME = 'entity';

const matchEntityPrimitiveName = (
  name: string | undefined | null
): string | null => (name === ENTITY_PRIMITIVE_NAME ? name : null);

const getBareEntityCalleeName = (callee: AstNode): string | null => {
  if (callee.type !== 'Identifier') {
    return null;
  }
  return matchEntityPrimitiveName(
    (callee as unknown as { name?: string }).name
  );
};

/**
 * Resolve a namespaced `ns.entity(...)` callee to its primitive name. Mirrors
 * {@link getNamespacedTrailCalleeName}: the receiver identifier must resolve
 * to an `@ontrails/*` namespace import, and — when a scope-aware
 * `safeCallStarts` set is provided — the call site must not be shadowed by a
 * local binding of the same name.
 */
const getNamespacedEntityCalleeName = (
  callExpr: AstNode,
  callee: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): string | null => {
  const names = getNamespacedMemberNames(callee);
  if (!names) {
    return null;
  }
  // Unlike the trail/signal variant, entity has no inline-resolution callers
  // that legitimately invoke this without a FrameworkNamespaceContext, so the
  // strict namespace gate stays on. If a future caller needs the permissive
  // fallback, mirror the trail shape and add a regression test first.
  const ctx = asNamespaceContext(context);
  if (!ctx || !isNamespacedCallAllowed(callExpr.start, names.receiver, ctx)) {
    return null;
  }
  return matchEntityPrimitiveName(names.property);
};

/**
 * Resolve the callee name of an entity call expression. Matches both bare
 * `entity(...)` identifiers and namespaced `core.entity(...)` callees where
 * the namespace comes from an `@ontrails/*` import and is unshadowed.
 */
const getEntityCalleeName = (
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
    getBareEntityCalleeName(callee) ??
    getNamespacedEntityCalleeName(node, callee, context)
  );
};

export const extractEntityDefinition = (
  node: AstNode,
  context?: ReadonlySet<string> | FrameworkNamespaceContext
): Omit<EntityDefinition, 'bindingName'> | null => {
  if (!getEntityCalleeName(node, context)) {
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

// Statement forms that can directly contain a top-level entity call:
//   `core.entity(...)` as a bare statement,
//   `export const ... = core.entity(...)` (handled via VariableDeclarator),
//   `export default core.entity(...);`.
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

export interface FindEntityDefinitionsOptions {
  /**
   * When true, skip entity calls nested inside other expressions (e.g.
   * `core.entity('inner', {...}).id()` used as a field of an outer entity).
   * Top-level forms are still surfaced: both `const foo = entity(...)`
   * declarations and bare `entity('name', {...});` statement-form calls that
   * appear directly in the program body (optionally wrapped in `export`) are
   * returned.
   *
   * Defaults to `false`: both top-level and inline entities are returned so
   * that reference-site resolution can reach anonymous inline entities.
   */
  readonly topLevelOnly?: boolean;
}

/**
 * Return every `entity('name', ...)` definition reachable from the AST, in
 * source order, deduplicated by call-expression start offset.
 *
 * Includes both top-level bindings (`const user = entity('user', ...)`) and
 * inline entity calls nested inside other expressions (e.g.
 * `entity('outer', { inner: entity('inner', ...).id() })`). Inline entities
 * carry no `bindingName` because they have no local binding — this asymmetry
 * is why {@link collectNamedEntityIds} returns only the top-level subset
 * while {@link collectEntityDefinitionIds} returns the full set.
 *
 * Pass `{ topLevelOnly: true }` via `options` to opt out of inline discovery
 * without disturbing callers that rely on the default behavior.
 *
 * @remarks
 * Supplying a pre-built `context` skips the second full-AST traversal inside
 * `buildFrameworkNamespaceContext` — useful for callers (such as
 * {@link collectEntityReferenceSites}) that already built one.
 */
export const findEntityDefinitions = (
  ast: AstNode,
  context?: FrameworkNamespaceContext,
  options?: FindEntityDefinitionsOptions
): EntityDefinition[] => {
  const definitions: EntityDefinition[] = [];
  const seenStarts = new Set<number>();
  const resolvedContext = context ?? buildFrameworkNamespaceContext(ast);
  const topLevelOnly = options?.topLevelOnly === true;

  const addEntityDefinition = (definition: EntityDefinition): void => {
    if (seenStarts.has(definition.start)) {
      return;
    }

    definitions.push(definition);
    seenStarts.add(definition.start);
  };

  const addNamedEntityDefinition = (
    id: AstNode | undefined,
    init: AstNode | undefined
  ): void => {
    if (!init) {
      return;
    }

    const definition = extractEntityDefinition(init, resolvedContext);
    if (!definition) {
      return;
    }

    const bindingName = extractBindingName(id);
    if (bindingName) {
      addEntityDefinition({ ...definition, bindingName });
      return;
    }

    addEntityDefinition(definition);
  };

  // When `topLevelOnly` is set, collect the start offsets of call expressions
  // that sit directly in the program body as `ExpressionStatement`s (optionally
  // wrapped in `export`). These are top-level statement-form entity calls and
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
      addNamedEntityDefinition(id, init);
      return;
    }

    if (
      topLevelStatementCallStarts &&
      !topLevelStatementCallStarts.has(node.start)
    ) {
      return;
    }

    const definition = extractEntityDefinition(node, resolvedContext);
    if (definition) {
      addEntityDefinition(definition);
    }
  });

  return definitions.toSorted((left, right) => left.start - right.start);
};

const extractImplementationFromConfig = (config: AstNode): AstNode[] => {
  const bodies: AstNode[] = [];
  const properties = config['properties'] as readonly AstNode[] | undefined;
  if (!properties) {
    return bodies;
  }
  for (const prop of properties) {
    if (
      isProperty(prop) &&
      identifierName(prop.key) === 'implementation' &&
      isAstNode(prop.value)
    ) {
      bodies.push(prop.value);
    }
  }
  return bodies;
};

/**
 * Find `implementation:` property values.
 *
 * When given an ObjectExpression (trail config), returns only its direct `implementation:`
 * properties. When given a full AST, finds trail definitions first and extracts
 * `implementation:` from each config — in both cases ignoring nested `implementation:` properties
 * (e.g. `meta: { implementation: ... }`).
 */
export const findImplementationBodies = (node: AstNode): AstNode[] => {
  if (node.type === 'ObjectExpression') {
    return extractImplementationFromConfig(node);
  }

  // Full AST — find trail definitions and extract implementation from their configs
  const bodies: AstNode[] = [];
  for (const def of findTrailDefinitions(node)) {
    bodies.push(...extractImplementationFromConfig(def.config));
  }
  return bodies;
};
