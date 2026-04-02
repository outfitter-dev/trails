/**
 * Detects trail implementations with `follow` that call `.blaze()` directly.
 *
 * Uses AST parsing to find trail definitions that declare `follow` and check for
 * `.blaze()` call expressions in their bodies.
 */

import {
  findConfigProperty,
  findBlazeBodies,
  findTrailDefinitions,
  isBlazeCall,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const findImplCallsInTrailWithFollow = (
  def: { readonly config: AstNode },
  filePath: string,
  sourceCode: string,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const body of findBlazeBodies(def.config as AstNode)) {
    walk(body, (node) => {
      if (isBlazeCall(node as AstNode)) {
        diagnostics.push({
          filePath,
          line: offsetToLine(sourceCode, node.start),
          message:
            'Use ctx.follow("trailId", input) instead of direct .blaze() calls. ctx.follow() validates input and propagates tracing.',
          rule: 'no-direct-impl-in-route',
          severity: 'warn',
        });
      }
    });
  }
};

const hasFollowProperty = (config: AstNode): boolean =>
  findConfigProperty(config as AstNode, 'follow') !== null;

/**
 * Detects trails with `follow` that call another trail's `.blaze()` directly.
 */
export const noDirectImplInRoute: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!/\btrail\s*\(/.test(sourceCode)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const followDefs = findTrailDefinitions(ast as AstNode).filter((d) =>
      hasFollowProperty(d.config as AstNode)
    );

    for (const def of followDefs) {
      findImplCallsInTrailWithFollow(def, filePath, sourceCode, diagnostics);
    }

    return diagnostics;
  },
  description:
    'Prefer ctx.follow() over direct .blaze() calls in trail bodies with follow.',
  name: 'no-direct-impl-in-route',

  severity: 'warn',
};
