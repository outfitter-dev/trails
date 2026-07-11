/** Shared source location helpers. */

import type { SourceLocation } from './nodes.js';

/** Find the byte offset's line number (1-based) in source code. */
export const offsetToLine = (sourceCode: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset && i < sourceCode.length; i += 1) {
    if (sourceCode[i] === '\n') {
      line += 1;
    }
  }
  return line;
};

/** Find the byte offset's line and column (1-based) in source code. */
export const offsetToLineColumn = (
  sourceCode: string,
  offset: number
): SourceLocation => {
  let line = 1;
  let column = 1;
  const limit = Math.min(Math.max(offset, 0), sourceCode.length);

  for (let i = 0; i < limit; i += 1) {
    if (sourceCode[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { column, line };
};
