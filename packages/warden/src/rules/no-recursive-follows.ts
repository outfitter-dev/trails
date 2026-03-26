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

const collectArrayText = (lines: readonly string[], start: number): string => {
  let text = '';
  for (let k = start; k < lines.length && k < start + 20; k += 1) {
    const line = lines[k];
    if (!line) {
      continue;
    }
    text += `${line}\n`;
    if (text.includes(']')) {
      break;
    }
  }
  return text;
};

const buildIdPattern = (routeId: string): RegExp => {
  const escaped = routeId.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`["'\`]${escaped}["'\`]`);
};

const checkSpecLineForSelfFollow = (
  specLine: string,
  j: number,
  lines: readonly string[],
  idPattern: RegExp
): boolean =>
  /\bfollows\s*:/.test(specLine) && idPattern.test(collectArrayText(lines, j));

const processSpecLineForSelfFollow = (
  specLine: string,
  j: number,
  lines: readonly string[],
  braceState: BraceState,
  idPattern: RegExp
): boolean | undefined => {
  trackBraces(specLine, braceState);
  if (checkSpecLineForSelfFollow(specLine, j, lines, idPattern)) {
    return true;
  }
  if (braceState.found && braceState.depth <= 0) {
    return false;
  }
  return undefined;
};

const routeContainsSelfFollow = (
  lines: readonly string[],
  startIndex: number,
  routeId: string
): boolean => {
  const braceState: BraceState = { depth: 0, found: false };
  const idPattern = buildIdPattern(routeId);

  for (let j = startIndex; j < lines.length && j < startIndex + 200; j += 1) {
    const specLine = lines[j];
    if (!specLine) {
      continue;
    }
    const result = processSpecLineForSelfFollow(
      specLine,
      j,
      lines,
      braceState,
      idPattern
    );
    if (result !== undefined) {
      return result;
    }
  }

  return false;
};

const processLine = (
  line: string,
  i: number,
  lines: readonly string[],
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const routeMatch = line.match(/\bhike\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!routeMatch) {
    return;
  }
  const [, routeId] = routeMatch;
  if (!routeId) {
    return;
  }

  if (routeContainsSelfFollow(lines, i, routeId)) {
    diagnostics.push({
      filePath,
      line: i + 1,
      message: `Route "${routeId}" references itself in its follows declaration.`,
      rule: 'no-recursive-follows',
      severity: 'error',
    });
  }
};

/**
 * Detects self-referential follows declarations within a single file.
 */
export const noRecursiveFollows: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const diagnostics: WardenDiagnostic[] = [];
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) {
        processLine(line, i, lines, filePath, diagnostics);
      }
    }
    return diagnostics;
  },
  description:
    'Disallow routes that reference themselves in their follows declaration.',
  name: 'no-recursive-follows',
  severity: 'error',
};
