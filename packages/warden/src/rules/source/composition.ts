/** Warden-private composition and implementation-call helpers. */

import { intentValues } from '@ontrails/core';
import type { Intent } from '@ontrails/core';

import type { AstNode } from '../../source/nodes.js';
import {
  deriveConstString,
  extractBindingName,
  findConfigProperty,
  getStringValue,
  identifierName,
  isStringLiteral,
} from '../../source/literals.js';
import {
  buildFrameworkNamespaceContext,
  extractTrailDefinition,
  findTrailDefinitions,
} from '../../source/trails.js';
import { walk } from '../../source/walk.js';

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

/** Extract the raw `composes: [...]` array elements from a trail config. */
export const getComposeElements = (config: AstNode): readonly AstNode[] => {
  const composesProp = findConfigProperty(config, 'composes');
  if (!composesProp) {
    return [];
  }

  const arrayNode = composesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/**
 * Resolve a single `composes: [...]` element to its target trail ID.
 *
 * Handles string literals, identifier references (via `namedTrailIds` map or
 * `const NAME = '...'` resolution), and inline `trail(...)` call expressions.
 */
export const deriveComposeElementId = (
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
 * `composes: [...]` array, deduplicated.
 */
export const extractDefinitionComposeTargetIds = (
  config: AstNode,
  sourceCode: string,
  namedTrailIds: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getComposeElements(config).flatMap((element) => {
      const id = deriveComposeElementId(element, sourceCode, namedTrailIds);
      return id ? [id] : [];
    })
  ),
];

/** Collect all trail IDs referenced by declared `composes: [...]` arrays. */
export const collectComposeTargetTrailIds = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedTrailIds = collectNamedTrailIds(ast);

  for (const def of findTrailDefinitions(ast)) {
    if (def.kind !== 'trail') {
      continue;
    }

    for (const id of extractDefinitionComposeTargetIds(
      def.config,
      sourceCode,
      namedTrailIds
    )) {
      ids.add(id);
    }
  }

  return ids;
};

const INTENT_VALUE_SET = new Set<string>(intentValues);
const DEFAULT_INTENT: Intent = 'write';

const normalizeTrailIntent = (value: string): Intent =>
  INTENT_VALUE_SET.has(value) ? (value as Intent) : DEFAULT_INTENT;

const extractTrailIntent = (config: AstNode): Intent => {
  const intentProp = findConfigProperty(config, 'intent');
  if (!intentProp || !isStringLiteral(intentProp.value as AstNode)) {
    return DEFAULT_INTENT;
  }

  const value = getStringValue(intentProp.value as AstNode);
  return value ? normalizeTrailIntent(value) : DEFAULT_INTENT;
};

/** Collect the normalized intent for every trail definition in a parsed file. */
export const collectTrailIntentsById = (
  ast: AstNode
): ReadonlyMap<string, Intent> => {
  const intents = new Map<string, Intent>();

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
