/**
 * Flags direct `.blaze()` calls in application code.
 *
 * Uses AST parsing to find `.blaze()` call expressions,
 * ignoring occurrences in strings and comments.
 */

import { isBlazeCall, offsetToLine, parse, walk } from './ast.js';
import { isFrameworkInternalFile, isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

/**
 * Flags direct `.blaze()` calls in application code.
 */
export const noDirectImplementationCall: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath) || isFrameworkInternalFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    walk(ast, (node) => {
      if (isBlazeCall(node)) {
        diagnostics.push({
          filePath,
          line: offsetToLine(sourceCode, node.start),
          message:
            'Use ctx.cross("trailId", input) instead of direct .blaze() calls. Direct implementation access bypasses validation, tracing, and layers.',
          rule: 'no-direct-implementation-call',
          severity: 'warn',
        });
      }
    });

    return diagnostics;
  },
  description:
    'Disallow direct .blaze() calls in application code. Use ctx.cross() instead.',
  name: 'no-direct-implementation-call',
  severity: 'warn',
};
