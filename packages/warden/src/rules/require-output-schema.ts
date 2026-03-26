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

const isSurfaceLine = (line: string): boolean =>
  /surfaces\s*:/.test(line) || /\bsurfaces\b/.test(line);

const hasMcpOrHttp = (line: string): boolean =>
  /["'`](?:mcp|http)["'`]/.test(line);

const checkSurfacesNearby = (lines: readonly string[], j: number): boolean => {
  for (let k = j; k < Math.min(j + 5, lines.length); k += 1) {
    const nextLine = lines[k];
    if (nextLine && hasMcpOrHttp(nextLine)) {
      return true;
    }
  }
  return false;
};

interface SpecScanResult {
  hasOutput: boolean;
  hasSurfaceTarget: boolean;
}

const processSpecLine = (
  specLine: string,
  j: number,
  lines: readonly string[],
  braceState: BraceState,
  result: SpecScanResult
): void => {
  trackBraces(specLine, braceState);
  if (isSurfaceLine(specLine) && checkSurfacesNearby(lines, j)) {
    result.hasSurfaceTarget = true;
  }
  if (/\boutput\s*:/.test(specLine)) {
    result.hasOutput = true;
  }
};

const scanTrailSpec = (
  lines: readonly string[],
  startIndex: number
): SpecScanResult => {
  const braceState: BraceState = { depth: 0, found: false };
  const result: SpecScanResult = { hasOutput: false, hasSurfaceTarget: false };

  for (let j = startIndex; j < lines.length && j < startIndex + 100; j += 1) {
    const specLine = lines[j];
    if (!specLine) {
      continue;
    }
    processSpecLine(specLine, j, lines, braceState, result);
    if (braceState.found && braceState.depth <= 0) {
      break;
    }
  }

  return result;
};

const processLine = (
  line: string,
  i: number,
  lines: readonly string[],
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const trailMatch = line.match(/\btrail\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!trailMatch) {
    return;
  }
  const [, trailId] = trailMatch;
  if (!trailId) {
    return;
  }

  const { hasOutput, hasSurfaceTarget } = scanTrailSpec(lines, i);
  if (hasSurfaceTarget && !hasOutput) {
    diagnostics.push({
      filePath,
      line: i + 1,
      message: `Trail "${trailId}" targets MCP or HTTP surface but has no output schema.`,
      rule: 'require-output-schema',
      severity: 'warn',
    });
  }
};

/**
 * Finds trail() calls that target MCP or HTTP surfaces but lack an `output` schema.
 */
export const requireOutputSchema: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const diagnostics: WardenDiagnostic[] = [];
    for (const [i, line] of sourceCode.split('\n').entries()) {
      if (line) {
        processLine(line, i, sourceCode.split('\n'), filePath, diagnostics);
      }
    }
    return diagnostics;
  },
  description:
    'Require output schema for trails blazed on MCP or HTTP surfaces.',
  name: 'require-output-schema',
  severity: 'warn',
};
