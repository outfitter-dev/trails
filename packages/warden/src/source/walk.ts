/** Shared AST walkers. */

import { walk as walkWithOxc } from 'oxc-walker';
import type {
  ScopeTracker,
  WalkerCallbackContext,
  WalkOptions,
} from 'oxc-walker';

import { isAstNode } from './nodes.js';
import type { AstNode, AstParentContext } from './nodes.js';

export type WalkFn = (node: unknown, visit: (node: AstNode) => void) => void;

export const walkChildren = (
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

const toAstParentContext = (
  parent: unknown,
  ctx: WalkerCallbackContext
): AstParentContext => ({
  index: ctx.index,
  key: ctx.key,
  parent: isAstNode(parent) ? parent : null,
});

export const walkWithOxcFacade = (
  node: unknown,
  enter: (node: AstNode, context: AstParentContext) => void,
  scopeTracker?: ScopeTracker
): void => {
  if (!isAstNode(node)) {
    return;
  }

  const options: Partial<WalkOptions> = {
    enter(candidate, parent, ctx) {
      if (!isAstNode(candidate)) {
        return;
      }
      enter(candidate, toAstParentContext(parent, ctx));
    },
  };

  if (scopeTracker) {
    options.scopeTracker = scopeTracker;
  }

  walkWithOxc(node as never, options);
};

/**
 * Walk an AST node tree with parent, key, and index context for each visited
 * node. This is the supported Warden facade over `oxc-walker` for rules and
 * regrades that need structural context.
 */
export const walkWithParents = (
  node: unknown,
  visit: (node: AstNode, context: AstParentContext) => void
): void => {
  walkWithOxcFacade(node, visit);
};
