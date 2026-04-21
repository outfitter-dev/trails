/**
 * Detects trail implementations with `crosses` that call `.blaze()` directly.
 *
 * Uses AST parsing to find trail definitions that declare `crosses` and check for
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

const findImplCallsInTrailWithCrosses = (
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
            'Use ctx.cross("trailId", input) instead of direct .blaze() calls. ctx.cross() validates input and propagates tracing.',
          rule: 'no-direct-impl-in-route',
          severity: 'warn',
        });
      }
    });
  }
};

const hasCrossesProperty = (config: AstNode): boolean =>
  findConfigProperty(config as AstNode, 'crosses') !== null;

/**
 * Detects trails with `crosses` that call another trail's `.blaze()` directly.
 */
export const noDirectImplInRoute: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const crossDefs = findTrailDefinitions(ast as AstNode).filter((d) =>
      hasCrossesProperty(d.config as AstNode)
    );

    for (const def of crossDefs) {
      findImplCallsInTrailWithCrosses(def, filePath, sourceCode, diagnostics);
    }

    return diagnostics;
  },
  description:
    'Prefer ctx.cross() over direct .blaze() calls in trail bodies with crossings.',
  name: 'no-direct-impl-in-route',

  severity: 'warn',
};
