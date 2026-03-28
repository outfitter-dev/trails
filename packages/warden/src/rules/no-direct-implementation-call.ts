/**
 * Flags direct `.implementation()` calls in application code.
 *
 * Uses AST parsing to find `.implementation()` call expressions,
 * ignoring occurrences in strings and comments.
 */

import { isImplementationCall, offsetToLine, parse, walk } from './ast.js';
import { isFrameworkInternalFile, isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

/**
 * Flags direct `.implementation()` calls in application code.
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
      if (isImplementationCall(node)) {
        diagnostics.push({
          filePath,
          line: offsetToLine(sourceCode, node.start),
          message:
            'Use ctx.follow("trailId", input) instead of direct .implementation() calls. Direct implementation access bypasses validation, tracing, and layers.',
          rule: 'no-direct-implementation-call',
          severity: 'warn',
        });
      }
    });

    return diagnostics;
  },
  description:
    'Disallow direct .implementation() calls in application code. Use ctx.follow() instead.',
  name: 'no-direct-implementation-call',
  severity: 'warn',
};
