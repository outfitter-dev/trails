/** Warden-private resource declaration helpers. */

import type { AstNode } from '../../source/nodes.js';
import {
  extractBindingName,
  extractFirstStringArg,
  identifierName,
} from '../../source/literals.js';
import { walk } from '../../source/walk.js';

const isResourceCall = (node: AstNode | undefined): boolean =>
  !!node &&
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'resource';

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
