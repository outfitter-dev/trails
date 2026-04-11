/**
 * Shared AST utilities for warden rules.
 *
 * Uses oxc-parser for native-speed TypeScript parsing. Provides a lightweight
 * walker and helpers for finding trail implementation bodies.
 */

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
export const resolveConstString = (
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

export interface StringLiteralMatch {
  readonly end: number;
  readonly node: AstNode;
  readonly start: number;
  readonly value: string;
}

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
    if (prop.type === 'Property' && prop.key?.name === propertyName) {
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
 * `signal("id", { ... })`, and legacy `event("id", { ... })` call sites.
 *
 * Returns the trail ID, kind, and config object node for each definition.
 */
const TRAIL_CALLEE_NAMES = new Set(['event', 'signal', 'trail']);

const getTrailCalleeName = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee || callee.type !== 'Identifier') {
    return null;
  }
  const { name } = callee as unknown as { name?: string };
  return name && TRAIL_CALLEE_NAMES.has(name) ? name : null;
};

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
  const val = (idProp.value as unknown as { value?: unknown }).value;
  return typeof val === 'string' ? val : null;
};

const extractTrailId = (trailArgs: {
  idArg: AstNode | null;
  configArg: AstNode;
}): string | null => {
  if (trailArgs.idArg) {
    return (trailArgs.idArg as unknown as { value?: string }).value ?? null;
  }
  return extractIdFromConfig(trailArgs.configArg);
};

const extractTrailDefinition = (node: AstNode): TrailDefinition | null => {
  const calleeName = getTrailCalleeName(node);
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

export const findTrailDefinitions = (ast: AstNode): TrailDefinition[] => {
  const definitions: TrailDefinition[] = [];

  walk(ast, (node) => {
    const def = extractTrailDefinition(node);
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

const getContourCalleeName = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee || callee.type !== 'Identifier') {
    return null;
  }
  const { name } = callee as unknown as { name?: string };
  return name === 'contour' ? name : null;
};

const extractContourDefinition = (
  node: AstNode
): Omit<ContourDefinition, 'bindingName'> | null => {
  if (!getContourCalleeName(node)) {
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

export const findContourDefinitions = (ast: AstNode): ContourDefinition[] => {
  const definitions: ContourDefinition[] = [];
  const seenStarts = new Set<number>();

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

    const definition = extractContourDefinition(init);
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

  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator') {
      const { id, init } = node as unknown as {
        readonly id?: AstNode;
        readonly init?: AstNode;
      };
      addNamedContourDefinition(id, init);
      return;
    }

    const definition = extractContourDefinition(node);
    if (definition) {
      addContourDefinition(definition);
    }
  });

  return definitions.toSorted((left, right) => left.start - right.start);
};

/** Collect all inline `contour('name', ...)` definition names from a parsed file. */
export const collectContourDefinitionIds = (
  ast: AstNode
): ReadonlySet<string> =>
  new Set(findContourDefinitions(ast).map((def) => def.name));

/** Collect `const foo = contour('name', ...)` bindings from a parsed file. */
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

const extractImportSpecifierAlias = (
  specifier: AstNode
): { readonly localName: string; readonly importedName: string } | null => {
  if (specifier.type !== 'ImportSpecifier') {
    return null;
  }

  const { imported } = specifier as unknown as { imported?: AstNode };
  const { local } = specifier as unknown as { local?: AstNode };
  const localName = identifierName(local);
  if (!localName) {
    return null;
  }

  const importedName = imported
    ? (identifierName(imported) ?? extractStringLiteral(imported))
    : null;
  return { importedName: importedName ?? localName, localName };
};

/**
 * Collect `import { foo as bar } from '...'` specifier mappings keyed by
 * local binding name. The value is the original exported name. Bindings
 * without an alias map to themselves.
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

const getPropertyName = (node: unknown): string | null => {
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
export const resolveContourIdentifierName = (
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
): { readonly object?: AstNode; readonly property?: AstNode } | null => {
  if (
    node.type !== 'MemberExpression' &&
    node.type !== 'StaticMemberExpression'
  ) {
    return null;
  }

  return node as unknown as {
    readonly object?: AstNode;
    readonly property?: AstNode;
  };
};

const getContourReferenceTargetFromObject = (
  object: AstNode,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>
): string | null => {
  if (object.type === 'Identifier') {
    const bindingName = identifierName(object);
    return bindingName
      ? resolveContourIdentifierName(
          bindingName,
          namedContourIds,
          knownContourIds,
          importAliases
        )
      : null;
  }

  return extractContourDefinition(object)?.name ?? null;
};

const getContourIdCallObject = (node: AstNode | undefined): AstNode | null => {
  if (!node || node.type !== 'CallExpression') {
    return null;
  }

  const callee = node['callee'] as AstNode | undefined;
  const member = callee ? getContourReferenceMember(callee) : null;
  if (!member || identifierName(member.property) !== 'id') {
    return null;
  }

  return member.object ?? null;
};

const extractContourReferenceTarget = (
  node: AstNode | undefined,
  namedContourIds: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>
): string | null => {
  const object = getContourIdCallObject(node);
  return object
    ? getContourReferenceTargetFromObject(
        object,
        namedContourIds,
        knownContourIds,
        importAliases
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
  importAliases?: ReadonlyMap<string, string>
): ContourReferenceSite | null => {
  if (property.type !== 'Property') {
    return null;
  }

  const field = getPropertyName(property.key);
  const target = extractContourReferenceTarget(
    property.value as AstNode | undefined,
    namedContourIds,
    knownContourIds,
    importAliases
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
  importAliases?: ReadonlyMap<string, string>
): readonly ContourReferenceSite[] =>
  getContourShapeProperties(definition).flatMap((property) => {
    const reference = buildContourReferenceSite(
      definition,
      property,
      namedContourIds,
      knownContourIds,
      importAliases
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
  return findContourDefinitions(ast).flatMap((definition) =>
    findContourReferenceSitesForDefinition(
      definition,
      namedContourIds,
      knownContourIds,
      importAliases
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
    if (def.kind === 'signal' || def.kind === 'event') {
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

    const def = extractTrailDefinition(init);
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
export const resolveCrossElementId = (
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
      ? (namedTrailIds.get(name) ?? resolveConstString(name, sourceCode))
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
      const id = resolveCrossElementId(element, sourceCode, namedTrailIds);
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
  /** Start offset of the table property declaration. */
  readonly start: number;
  /** Whether the authored table opts into version tracking. */
  readonly versioned: boolean;
}

const isBooleanLiteral = (node: AstNode | undefined): boolean =>
  Boolean(
    node &&
    ((node.type === 'BooleanLiteral' &&
      (node as unknown as { value?: unknown }).value === true) ||
      (node.type === 'Literal' &&
        (node as unknown as { value?: unknown }).value === true))
  );

const isNamedCall = (node: AstNode | undefined, name: string): boolean =>
  !!node &&
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) === name;

const getMemberExpression = (
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

const extractStoreTableNameFromMember = (
  node: AstNode | undefined
): string | null => {
  const member = getMemberExpression(node);
  const tableName = member ? getPropertyName(member.property) : null;
  const tablesMember = member ? getMemberExpression(member.object) : null;
  if (!tableName || !tablesMember) {
    return null;
  }

  return getPropertyName(tablesMember.property) === 'tables' ? tableName : null;
};

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
    const tableId = extractStoreTableNameFromMember(init);
    if (name && tableId) {
      ids.set(name, tableId);
    }
  });

  return ids;
};

const resolveStoreTableId = (
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

  return extractStoreTableNameFromMember(node);
};

const extractStoreTableDefinitions = (
  node: AstNode
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
        name,
        start: property.start,
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

  walk(ast, (node) => {
    definitions.push(...extractStoreTableDefinitions(node));
  });

  return definitions;
};

export const collectVersionedStoreTableIds = (
  ast: AstNode
): ReadonlySet<string> =>
  new Set(
    findStoreTableDefinitions(ast).flatMap((definition) =>
      definition.versioned ? [definition.name] : []
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
    const tableId = resolveStoreTableId(tableArg, namedStoreTableIds);
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
    const tableId = resolveStoreTableId(
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

  const tableId = resolveStoreTableId(signalsMember.object, namedStoreTableIds);
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
    ? (namedStoreSignalIds.get(name) ?? resolveConstString(name, sourceCode))
    : null;
};

const resolveInlineOnSignalId = (element: AstNode): string | null => {
  const definition = extractTrailDefinition(element);
  return definition?.kind === 'signal' || definition?.kind === 'event'
    ? definition.id
    : null;
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
