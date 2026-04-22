/**
 * Finds `throw` statements inside `blaze:` function bodies.
 *
 * Uses scope-aware AST walking so throws inside nested callbacks
 * (e.g. `.map()`, `.filter()`, inner helpers) are not attributed to
 * the blaze body itself. ADR-0007 requires this class of false positive
 * to be avoided — only throws in the blaze body scope should be flagged.
 */

import { findBlazeBodies, offsetToLine, parse, walkScope } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

export const noThrowInImplementation: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    for (const body of findBlazeBodies(ast)) {
      walkScope(body, (node) => {
        if (node.type === 'ThrowStatement') {
          diagnostics.push({
            filePath,
            line: offsetToLine(sourceCode, node.start),
            message:
              'Do not throw inside implementation. Use Result.err() instead.',
            rule: 'no-throw-in-implementation',
            severity: 'error',
          });
        }
      });
    }

    return diagnostics;
  },
  description:
    'Disallow throw statements inside trail/route implementation bodies. Use Result.err() instead.',
  name: 'no-throw-in-implementation',
  severity: 'error',
};
