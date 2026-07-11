/** Shared literal, string, and static property-key helpers. */

import { isAstNode } from './nodes.js';
import type { AstNode, StringLiteralNode } from './nodes.js';
import { walk } from './walk.js';

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
 * backtick-literal IDs (e.g. `valid-describe-refs`).
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

export const extractBindingName = (
  node: AstNode | undefined
): string | null => {
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

export const staticPropertyKeyName = (key: AstNode): string | null => {
  if (key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name ?? null;
  }
  return isStringLiteral(key) ? getStringValue(key) : null;
};

export const propertyKeyName = (prop: AstNode): string | null => {
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
