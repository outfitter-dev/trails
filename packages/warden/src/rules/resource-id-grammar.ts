import {
  extractFirstStringArg,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const isResourceCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'resource';

const buildDiagnostic = (
  resourceId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Resource "${resourceId}" is invalid because resource ids may not contain ":".`,
  rule: 'resource-id-grammar',
  severity: 'error',
});

export const resourceIdGrammar: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    walk(ast, (node) => {
      if (!isResourceCall(node)) {
        return;
      }

      const resourceId = extractFirstStringArg(node);
      if (!resourceId || !resourceId.includes(':')) {
        return;
      }

      diagnostics.push(
        buildDiagnostic(
          resourceId,
          filePath,
          offsetToLine(sourceCode, node.start)
        )
      );
    });

    return diagnostics;
  },
  description: 'Ensure resource ids do not contain the ":" scope separator.',
  name: 'resource-id-grammar',
  severity: 'error',
};
