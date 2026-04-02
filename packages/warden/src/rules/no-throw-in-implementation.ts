/**
 * Finds `throw` statements inside `blaze:` function bodies.
 *
 * Uses AST parsing for accurate detection — no false positives from
 * throw in comments, strings, or nested non-implementation functions.
 */

import { findBlazeBodies, offsetToLine, parse, walk } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

export const noThrowInImplementation: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    for (const body of findBlazeBodies(ast)) {
      walk(body, (node) => {
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
