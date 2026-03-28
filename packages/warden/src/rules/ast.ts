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

interface AstNode {
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

interface TrailDefinition {
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
