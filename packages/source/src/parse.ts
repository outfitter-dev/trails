/** Shared OXC parser facade. */

import { parseSync } from 'oxc-parser';

import type { AstNode, AstParseResult } from './nodes.js';

/** Parse TypeScript source into an AST. Returns null on parse failure. */
export const parse = (filePath: string, sourceCode: string): AstNode | null => {
  try {
    const result = parseSync(filePath, sourceCode, { sourceType: 'module' });
    return result.program as unknown as AstNode;
  } catch {
    return null;
  }
};

/**
 * Parse TypeScript source and surface parser diagnostics. OXC can recover a
 * partial program for malformed input, so rewrite tooling should use this
 * helper when applying edits would be unsafe after syntax errors.
 */
export const parseWithDiagnostics = (
  filePath: string,
  sourceCode: string
): AstParseResult => {
  try {
    const result = parseSync(filePath, sourceCode, { sourceType: 'module' });
    return {
      ast: result.program as unknown as AstNode,
      diagnostics: result.errors.map((error) => ({
        helpMessage: error.helpMessage,
        labels: error.labels.map((label) => ({
          end: label.end,
          message: label.message,
          start: label.start,
        })),
        message: error.message,
        severity: error.severity,
      })),
    };
  } catch (error) {
    return {
      ast: null,
      diagnostics: [
        {
          helpMessage: null,
          labels: [],
          message:
            error instanceof Error ? error.message : 'Unable to parse source.',
          severity: 'Error',
        },
      ],
    };
  }
};
