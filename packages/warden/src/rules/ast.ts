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
  readonly value?: AstNode;
  readonly body?: AstNode | readonly AstNode[];
  readonly [key: string]: unknown;
}

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

/** Walk an AST node tree, calling `visit` on every node. */
export const walk = (node: unknown, visit: (node: AstNode) => void): void => {
  if (!node || typeof node !== 'object') {
    return;
  }
  const n = node as AstNode;
  if (n.type) {
    visit(n);
  }
  for (const val of Object.values(n)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        walk(item, visit);
      }
    } else if (val && typeof val === 'object' && (val as AstNode).type) {
      walk(val, visit);
    }
  }
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

/** Find all `implementation:` property values in an AST. */
export const findImplementationBodies = (ast: AstNode): AstNode[] => {
  const bodies: AstNode[] = [];
  walk(ast, (node) => {
    if (
      node.type === 'Property' &&
      node.key?.name === 'implementation' &&
      node.value
    ) {
      bodies.push(node.value);
    }
  });
  return bodies;
};

export interface TrailDefinition {
  /** Trail ID string, e.g. "entity.show" */
  readonly id: string;
  /** "trail" or "hike" */
  readonly kind: string;
  /** The config object argument (second arg to trail/hike call) */
  readonly config: AstNode;
  /** Start offset of the call expression */
  readonly start: number;
}

/**
 * Find all `trail("id", { ... })` and `hike("id", { ... })` call sites.
 *
 * Returns the trail ID, kind, and config object node for each definition.
 */
const TRAIL_CALLEE_NAMES = new Set(['trail', 'hike']);

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

const extractTrailArgs = (
  node: AstNode
): { idArg: AstNode; configArg: AstNode } | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (!args || args.length < 2) {
    return null;
  }
  const [idArg, configArg] = args;
  if (!idArg || !configArg) {
    return null;
  }
  return { configArg, idArg };
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

  const trailId = (trailArgs.idArg as unknown as { value?: string }).value;
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

/** Check if a node is a call to `.implementation()` on some object. */
export const isImplementationCall = (node: AstNode): boolean => {
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
    (prop as unknown as { name: string }).name === 'implementation'
  );
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
// Event definitions — event("id", { ... })
// ---------------------------------------------------------------------------

export interface EventDefinition {
  /** Event ID string, e.g. "entity.updated" */
  readonly id: string;
  /** The config object argument (second arg to event call) */
  readonly config: AstNode;
  /** Start offset of the call expression */
  readonly start: number;
}

const isEventCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee || callee.type !== 'Identifier') {
    return false;
  }
  return (callee as unknown as { name?: string }).name === 'event';
};

const extractEventDefinition = (node: AstNode): EventDefinition | null => {
  if (!isEventCall(node)) {
    return null;
  }
  const eventArgs = extractTrailArgs(node);
  if (!eventArgs) {
    return null;
  }
  const eventId = (eventArgs.idArg as unknown as { value?: string }).value;
  if (!eventId) {
    return null;
  }
  return { config: eventArgs.configArg, id: eventId, start: node.start };
};

export const findEventDefinitions = (ast: AstNode): EventDefinition[] => {
  const definitions: EventDefinition[] = [];
  walk(ast, (node) => {
    const def = extractEventDefinition(node);
    if (def) {
      definitions.push(def);
    }
  });
  return definitions;
};

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

const extractLiteralValue = (node: AstNode): string | null => {
  if (node.type !== 'Literal') {
    return null;
  }
  return (node as unknown as { value?: string }).value ?? null;
};

/** Extract string literal values from an ArrayExpression node. */
export const extractStringArrayValues = (node: AstNode): string[] => {
  if (node.type !== 'ArrayExpression') {
    return [];
  }
  const elements = node['elements'] as readonly AstNode[] | undefined;
  if (!elements) {
    return [];
  }
  return elements
    .map(extractLiteralValue)
    .filter((v): v is string => v !== null);
};

/** Extract string IDs from a config property that holds an array, e.g. follows: ["a", "b"]. */
export const extractConfigArrayIds = (
  config: AstNode,
  propertyName: string
): string[] => {
  const prop = findConfigProperty(config, propertyName);
  if (!prop?.value) {
    return [];
  }
  return extractStringArrayValues(prop.value);
};

// ---------------------------------------------------------------------------
// ctx.follow() call detection
// ---------------------------------------------------------------------------

/** Check if a callee node is a member expression like `obj.prop`. */
const isMemberCallee = (callee: AstNode): boolean =>
  callee.type === 'StaticMemberExpression' ||
  callee.type === 'MemberExpression';

/** Extract object and property names from a member expression. */
const getMemberNames = (
  callee: AstNode
): { objName: string; propName: string } | null => {
  const obj = (callee as unknown as { object?: AstNode }).object;
  const prop = (callee as unknown as { property?: AstNode }).property;
  if (!obj || !prop) {
    return null;
  }
  const objName = (obj as unknown as { name?: string }).name;
  const propName = (prop as unknown as { name?: string }).name;
  if (!objName || !propName) {
    return null;
  }
  return { objName, propName };
};

/** Extract the first string literal argument from a CallExpression. */
const getFirstStringArg = (node: AstNode): string | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  const firstArg = args?.[0];
  if (!firstArg || firstArg.type !== 'Literal') {
    return null;
  }
  return (firstArg as unknown as { value?: string }).value ?? null;
};

/**
 * Check if a CallExpression is `ctx.follow("id")` or `ctx.follow<T>("id")`.
 * Returns the followed trail ID string, or null.
 */
export const extractFollowCallId = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee || !isMemberCallee(callee)) {
    return null;
  }
  const names = getMemberNames(callee);
  if (!names || names.objName !== 'ctx' || names.propName !== 'follow') {
    return null;
  }
  return getFirstStringArg(node);
};

/** Check if a node argument is `ctx.follow` (a member expression reference). */
const isCtxFollowRef = (arg: AstNode): boolean => {
  if (!isMemberCallee(arg)) {
    return false;
  }
  const names = getMemberNames(arg);
  return names?.objName === 'ctx' && names?.propName === 'follow';
};

/** Resolve helper invocations that receive `ctx.follow` as an argument. */
const resolveHelperFollowCallIds = (
  node: AstNode,
  helperFollowIds: ReadonlyMap<string, readonly string[]>
): readonly string[] => {
  if (node.type !== 'CallExpression') {
    return [];
  }
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (!args?.some(isCtxFollowRef)) {
    return [];
  }
  const callee = node['callee'] as AstNode | undefined;
  if (callee?.type !== 'Identifier') {
    return [];
  }
  const helperName = (callee as unknown as { name?: string }).name;
  return helperName ? (helperFollowIds.get(helperName) ?? []) : [];
};

// ---------------------------------------------------------------------------
// Helper function follow detection (for delegated follow calls)
// ---------------------------------------------------------------------------

/** Check if a function node has a parameter named `follow`. */
const hasFollowParam = (funcNode: AstNode): boolean => {
  const params = funcNode['params'] as readonly AstNode[] | undefined;
  if (!params || !Array.isArray(params)) {
    return false;
  }
  return params.some((p) => {
    if (p.type === 'FormalParameter') {
      const { pattern } = p as unknown as { pattern?: AstNode };
      return (pattern as unknown as { name?: string }).name === 'follow';
    }
    return (p as unknown as { name?: string }).name === 'follow';
  });
};

const isFunctionLike = (node: AstNode): boolean =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

const extractVarFollowHelper = (node: AstNode): string | null => {
  const id = node['id'] as AstNode | undefined;
  const init = node['init'] as AstNode | undefined;
  if (!id || !init || !isFunctionLike(init) || !hasFollowParam(init)) {
    return null;
  }
  return (id as unknown as { name?: string }).name ?? null;
};

const extractFuncFollowHelper = (node: AstNode): string | null => {
  if (!hasFollowParam(node)) {
    return null;
  }
  const id = node['id'] as AstNode | undefined;
  return (id as unknown as { name?: string }).name ?? null;
};

/** Extract the name of a helper that has a `follow` parameter. */
const extractHelperWithFollowParam = (node: AstNode): string | null => {
  if (node.type === 'VariableDeclarator') {
    return extractVarFollowHelper(node);
  }
  if (node.type === 'FunctionDeclaration') {
    return extractFuncFollowHelper(node);
  }
  return null;
};

/** Extract a follow("id") call ID from a bare `follow(...)` invocation. */
const extractBareFollowCallId = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (callee?.type !== 'Identifier') {
    return null;
  }
  const calleeName = (callee as unknown as { name?: string }).name;
  if (calleeName !== 'follow') {
    return null;
  }
  return getFirstStringArg(node);
};

/** Extract follow("id") calls inside a helper function body. */
const extractFollowIdsFromHelper = (node: AstNode): string[] => {
  const followIds: string[] = [];
  walk(node, (inner) => {
    const val = extractBareFollowCallId(inner);
    if (val) {
      followIds.push(val);
    }
  });
  return followIds;
};

/**
 * Collect helper functions that accept a `follow` parameter and call it with
 * string literal IDs. Returns a map of helper name to follow IDs.
 */
const collectHelperFollowIds = (
  ast: AstNode
): ReadonlyMap<string, readonly string[]> => {
  const helperMap = new Map<string, string[]>();
  walk(ast, (node) => {
    const helperName = extractHelperWithFollowParam(node);
    if (!helperName) {
      return;
    }
    const followIds = extractFollowIdsFromHelper(node);
    if (followIds.length > 0) {
      helperMap.set(helperName, followIds);
    }
  });
  return helperMap;
};

/**
 * Find all ctx.follow("id") calls within a subtree.
 * Also resolves helper functions that receive `ctx.follow` as an argument.
 *
 * When `helperScope` is provided, helper function definitions are resolved
 * from that broader scope (e.g. the full AST) instead of just `searchScope`.
 */
export const findFollowCallIds = (
  searchScope: AstNode,
  helperScope?: AstNode
): string[] => {
  const ids: string[] = [];
  const helperFollowIds = collectHelperFollowIds(helperScope ?? searchScope);

  walk(searchScope, (node) => {
    const id = extractFollowCallId(node);
    if (id) {
      ids.push(id);
      return;
    }
    ids.push(...resolveHelperFollowCallIds(node, helperFollowIds));
  });

  return ids;
};
