/**
 * Detects hike implementations that call `.implementation()` directly.
 *
 * Uses AST parsing to find hike definition bodies and check for
 * `.implementation()` call expressions.
 */

import {
  findImplementationBodies,
  findTrailDefinitions,
  isImplementationCall,
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

const findImplCallsInHike = (
  def: { readonly config: AstNode },
  filePath: string,
  sourceCode: string,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const body of findImplementationBodies(def.config as AstNode)) {
    walk(body, (node) => {
      if (isImplementationCall(node as AstNode)) {
        diagnostics.push({
          filePath,
          line: offsetToLine(sourceCode, node.start),
          message:
            'Use ctx.follow("trailId", input) instead of direct .implementation() calls. ctx.follow() validates input and propagates tracing.',
          rule: 'no-direct-impl-in-route',
          severity: 'warn',
        });
      }
    });
  }
};

/**
 * Detects routes that call another trail's `.implementation()` directly.
 */
export const noDirectImplInRoute: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!/\bhike\s*\(/.test(sourceCode)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const hikeDefs = findTrailDefinitions(ast as AstNode).filter(
      (d) => d.kind === 'hike'
    );

    for (const def of hikeDefs) {
      findImplCallsInHike(def, filePath, sourceCode, diagnostics);
    }

    return diagnostics;
  },
  description:
    'Prefer ctx.follow() over direct .implementation() calls in route bodies.',
  name: 'no-direct-impl-in-route',

  severity: 'warn',
};
