import type { WardenDiagnostic, WardenRule } from './types.js';

interface BraceState {
  depth: number;
  found: boolean;
}

const trackBraces = (line: string, state: BraceState): void => {
  for (const ch of line) {
    if (ch === '{') {
      state.depth += 1;
      state.found = true;
    }
    if (ch === '}') {
      state.depth -= 1;
    }
  }
};

const scanRouteBodyForImpl = (
  lines: readonly string[],
  startIndex: number,
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const braceState: BraceState = { depth: 0, found: false };

  for (let j = startIndex; j < lines.length && j < startIndex + 200; j += 1) {
    const specLine = lines[j];
    if (!specLine) {
      continue;
    }
    trackBraces(specLine, braceState);

    if (/\w+\.implementation\s*\(/.test(specLine)) {
      diagnostics.push({
        filePath,
        line: j + 1,
        message:
          'Use ctx.follow("trailId", input) instead of direct .implementation() calls. ctx.follow() validates input and propagates tracing.',
        rule: 'no-direct-impl-in-route',
        severity: 'warn',
      });
    }

    if (braceState.found && braceState.depth <= 0) {
      break;
    }
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

    const diagnostics: WardenDiagnostic[] = [];
    const lines = sourceCode.split('\n');
    const routePattern = /\bhike\s*\(\s*["'`]([^"'`]+)["'`]/;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line && routePattern.test(line)) {
        scanRouteBodyForImpl(lines, i, filePath, diagnostics);
      }
    }

    return diagnostics;
  },
  description:
    'Prefer ctx.follow() over direct .implementation() calls in route bodies.',
  name: 'no-direct-impl-in-route',

  severity: 'warn',
};
