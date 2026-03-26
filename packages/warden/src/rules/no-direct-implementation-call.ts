import type { WardenDiagnostic, WardenRule } from './types.js';
import {
  isFrameworkInternalFile,
  isTestFile,
  stripQuotedContent,
} from './scan.js';

const DIRECT_IMPLEMENTATION_PATTERN = /\b[A-Za-z_$][\w$]*\.implementation\s*\(/;

/**
 * Flags direct `.implementation()` calls in application code.
 */
export const noDirectImplementationCall: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath) || isFrameworkInternalFile(filePath)) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const lines = stripQuotedContent(sourceCode).split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || !DIRECT_IMPLEMENTATION_PATTERN.test(line)) {
        continue;
      }

      diagnostics.push({
        filePath,
        line: i + 1,
        message:
          'Use ctx.follow("trailId", input) instead of direct .implementation() calls. Direct implementation access bypasses validation, tracing, and layers.',
        rule: 'no-direct-implementation-call',
        severity: 'warn',
      });
    }

    return diagnostics;
  },
  description:
    'Disallow direct .implementation() calls in application code. Use ctx.follow() instead.',
  name: 'no-direct-implementation-call',
  severity: 'warn',
};
