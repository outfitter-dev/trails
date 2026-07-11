/** Warden-private entity reference and user-namespace collectors. */

import type { AstNode } from '../../source/nodes.js';
import {
  extractStringLiteral,
  getPropertyName,
  identifierName,
} from '../../source/literals.js';
import {
  isMemberAccessNonComputed,
  isShadowed,
  walkWithScopes,
} from '../../source/scopes.js';
import {
  buildFrameworkNamespaceContext,
  extractEntityDefinition,
  findEntityDefinitions,
  getImportSourceValue,
  isFrameworkNamespaceSource,
} from '../../source/trails.js';
import type {
  EntityDefinition,
  FrameworkNamespaceContext,
} from '../../source/trails.js';
import { walk } from '../../source/walk.js';

export const collectEntityDefinitionIds = (ast: AstNode): ReadonlySet<string> =>
  new Set(findEntityDefinitions(ast).map((def) => def.name));

/**
 * Collect the `localBinding → entityName` map for `const foo = entity(...)`
 * declarations. Inline entity calls are intentionally excluded because they
 * have no local binding — use {@link collectEntityDefinitionIds} when the
 * full set of declared names is required.
 */
export const collectNamedEntityIds = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  for (const def of findEntityDefinitions(ast)) {
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
  // name. We cannot statically recover the exported name without compose-file
  // analysis, so the local name is the best identifier we have for resolving
  // against `knownEntityIds`. Treat the alias as an identity mapping; the
  // downstream resolver will fall through to `knownEntityIds` on the binding
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
 * Collect `import {
  foo as bar
} from '...';` and `import bar from '...'`
 * specifier mappings keyed by local binding name. The value is the original
 * exported name for named imports. Default imports map to themselves because
 * the exported name cannot be recovered statically — callers should fall
 * through to `knownEntityIds` membership on the local binding name.
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
 * are user-defined namespace imports of entity modules (e.g. `import * as
 * entities from './entities'`), used to resolve `entities.user` member-access
 * references to entity ids.
 *
 * Framework namespace imports (`import * as core from '@ontrails/core'`) are
 * intentionally excluded — they carry framework primitives like
 * `core.entity(...)` and are resolved by {@link buildFrameworkNamespaceContext}.
 * Mixing them here would treat `core.entity` as a reference to an entity
 * named "entity", producing false positives.
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
 * Resolution context for user-namespace member access like `entities.user`.
 * Bundles the set of local namespace-binding names (from `import * as x from
 * './entities'`) with an optional set of proven-safe `MemberExpression` start
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
 * framework-namespace path so `entities.user` inside
 * `function f(entities) { ... }` is rejected as shadowed.
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
 * `entities.user` is rejected when `entities` is shadowed by a local binding.
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

export interface EntityReferenceSite {
  /** Field on the source entity that declares the reference. */
  readonly field: string;
  /** Source entity name. */
  readonly source: string;
  /** Start offset of the field declaration. */
  readonly start: number;
  /** Target entity name. */
  readonly target: string;
}

const stripEntitySuffix = (name: string): string => {
  const suffix = 'Entity';
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
};

const resolveKnownEntityName = (
  name: string,
  knownEntityIds?: ReadonlySet<string>
): string | null => {
  if (knownEntityIds?.has(name)) {
    return name;
  }

  // Support the common `const userEntity = entity('user', ...)` naming
  // pattern when callers refer to the binding name instead of the entity ID.
  // Exact matches always win; suffix stripping is a fallback only.
  const stripped = stripEntitySuffix(name);
  if (stripped !== name && knownEntityIds?.has(stripped)) {
    return stripped;
  }

  return null;
};

/**
 * Resolve a local binding name to an entity ID, honoring import aliases.
 *
 * Strategies, in order:
 * 1. Local `const foo = entity('name', ...)` binding → the entity name.
 * 2. `knownEntityIds` membership on the binding name itself (or the
 *    conventional `Entity` suffix strip).
 * 3. `import { foo as bar }` → use the original exported name `foo`
 *    (and apply strategy 2 / suffix-stripping against it so aliased imports
 *    resolve correctly). If the imported name still isn't recognized, the
 *    imported name is returned so the caller can report it missing.
 *
 * Returns `null` only when the name belongs to no known resolution path —
 * no local binding, no known entity ID, no import, and no suffix match.
 * Returning `null` means "this identifier is not an entity reference we can
 * reason about" (e.g. a bare undeclared variable), as opposed to
 * "an entity reference whose target is missing".
 */
export const deriveEntityIdentifierName = (
  bindingName: string,
  namedEntityIds: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>
): string | null => {
  const localName = namedEntityIds.get(bindingName);
  if (localName) {
    return localName;
  }

  const known = resolveKnownEntityName(bindingName, knownEntityIds);
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
    return resolveKnownEntityName(importedName, knownEntityIds) ?? importedName;
  }

  return null;
};

const getEntityReferenceMember = (
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
 * Resolve a user-namespace member access like `entities.user` to its entity
 * id. Returns the property name (e.g. `'user'`) when the receiver identifier
 * is a known user-defined namespace binding AND — when the caller provides a
 * {@link UserNamespaceContext} with `safeMemberStarts` — the member access
 * site is in that set (i.e. the receiver is not shadowed by any enclosing
 * scope). Otherwise returns `null`.
 *
 * The property name is taken as the entity id verbatim — we cannot statically
 * resolve what `entities.user` binds to without reading the other file, so we
 * treat the member name as the candidate target and let
 * {@link deriveEntityIdentifierName}'s downstream `knownEntityIds` check
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

const getEntityReferenceTargetFromNamespaceMember = (
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

const getEntityReferenceTargetFromObject = (
  object: AstNode,
  namedEntityIds: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): string | null => {
  if (object.type === 'Identifier') {
    const bindingName = identifierName(object);
    return bindingName
      ? deriveEntityIdentifierName(
          bindingName,
          namedEntityIds,
          knownEntityIds,
          importAliases
        )
      : null;
  }

  const member = getEntityReferenceMember(object);
  if (member) {
    const namespaceTarget = getEntityReferenceTargetFromNamespaceMember(
      member,
      userNamespace
    );
    if (namespaceTarget) {
      return namespaceTarget;
    }
  }

  return extractEntityDefinition(object, context)?.name ?? null;
};

const ENTITY_ID_WRAPPER_METHODS = new Set([
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

const getEntityIdCallMember = (
  node: AstNode
): {
  readonly member: NonNullable<ReturnType<typeof getEntityReferenceMember>>;
  readonly propertyName: string;
} | null => {
  const callee = node['callee'] as AstNode | undefined;
  const member = callee ? getEntityReferenceMember(callee) : null;
  const propertyName = member ? identifierName(member.property) : null;
  return member && propertyName ? { member, propertyName } : null;
};

const getEntityIdCallObject = function getEntityIdCallObject(
  node: AstNode | undefined
): AstNode | null {
  const current = node;
  if (!current || current.type !== 'CallExpression') {
    return null;
  }

  const member = getEntityIdCallMember(current);
  if (!member) {
    return null;
  }
  if (member.propertyName === 'id') {
    return member.member.object ?? null;
  }

  return ENTITY_ID_WRAPPER_METHODS.has(member.propertyName)
    ? getEntityIdCallObject(member.member.object)
    : null;
};

const extractEntityReferenceTarget = (
  node: AstNode | undefined,
  namedEntityIds: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): string | null => {
  const object = getEntityIdCallObject(node);
  return object
    ? getEntityReferenceTargetFromObject(
        object,
        namedEntityIds,
        knownEntityIds,
        importAliases,
        context,
        userNamespace
      )
    : null;
};

const getEntityShapeProperties = (
  definition: EntityDefinition
): readonly AstNode[] =>
  (definition.shape['properties'] as readonly AstNode[] | undefined) ?? [];

const buildEntityReferenceSite = (
  definition: EntityDefinition,
  property: AstNode,
  namedEntityIds: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): EntityReferenceSite | null => {
  if (property.type !== 'Property') {
    return null;
  }

  const field = getPropertyName(property.key);
  const target = extractEntityReferenceTarget(
    property.value as AstNode | undefined,
    namedEntityIds,
    knownEntityIds,
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

const findEntityReferenceSitesForDefinition = (
  definition: EntityDefinition,
  namedEntityIds: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  context?: ReadonlySet<string> | FrameworkNamespaceContext,
  userNamespace?: ReadonlySet<string> | UserNamespaceContext
): readonly EntityReferenceSite[] =>
  getEntityShapeProperties(definition).flatMap((property) => {
    const reference = buildEntityReferenceSite(
      definition,
      property,
      namedEntityIds,
      knownEntityIds,
      importAliases,
      context,
      userNamespace
    );
    return reference ? [reference] : [];
  });

/** Collect all entity field references declared via `.id()` in a parsed file. */
export const collectEntityReferenceSites = (
  ast: AstNode,
  knownEntityIds?: ReadonlySet<string>
): readonly EntityReferenceSite[] => {
  const namedEntityIds = collectNamedEntityIds(ast);
  const importAliases = collectImportAliasMap(ast);
  const userNamespace = buildUserNamespaceContext(ast);
  const context = buildFrameworkNamespaceContext(ast);
  return findEntityDefinitions(ast, context).flatMap((definition) =>
    findEntityReferenceSitesForDefinition(
      definition,
      namedEntityIds,
      knownEntityIds,
      importAliases,
      context,
      userNamespace
    )
  );
};

/** Collect entity reference targets keyed by source entity name. */
export const collectEntityReferenceTargetsByName = (
  ast: AstNode,
  knownEntityIds?: ReadonlySet<string>
): ReadonlyMap<string, readonly string[]> => {
  const targetsByName = new Map<string, Set<string>>();

  for (const reference of collectEntityReferenceSites(ast, knownEntityIds)) {
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
// Implementation body extraction
// ---------------------------------------------------------------------------

/**
 * Extract top-level `implementation:` property values from an ObjectExpression's direct properties.
 *
 * Does not recurse into nested objects, so `meta: { implementation: ... }` is ignored.
 */
