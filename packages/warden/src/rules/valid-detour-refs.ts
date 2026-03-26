import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

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

const collectTrailIds = (sourceCode: string): readonly string[] => {
  const ids: string[] = [];
  for (const m of sourceCode.matchAll(
    /\b(?:trail|hike)\s*\(\s*["'`]([^"'`]+)["'`]/g
  )) {
    if (m[1]) {
      ids.push(m[1]);
    }
  }
  return ids;
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

const findMissingDetourTargets = (
  text: string,
  knownIds: ReadonlySet<string>
): string[] => {
  const missing: string[] = [];
  for (const m of text.matchAll(/target\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    const [, id] = m;
    if (id && !knownIds.has(id)) {
      missing.push(id);
    }
  }
  return missing;
};

const findMissingPlainDetours = (
  text: string,
  knownIds: ReadonlySet<string>
): string[] => {
  const missing: string[] = [];
  const cleaned = text.replaceAll(/target\s*:\s*["'`][^"'`]+["'`]/g, '');
  for (const m of cleaned.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    const [, id] = m;
    if (id && id.includes('.') && !knownIds.has(id)) {
      missing.push(id);
    }
  }
  return missing;
};

const findAllMissingDetours = (
  text: string,
  knownIds: ReadonlySet<string>
): string[] => [
  ...findMissingDetourTargets(text, knownIds),
  ...findMissingPlainDetours(text, knownIds),
];

const addMissingDetourDiagnostics = (
  specLine: string,
  j: number,
  lines: readonly string[],
  trailId: string,
  lineNum: number,
  filePath: string,
  knownIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  if (!/\bdetours\s*:/.test(specLine)) {
    return;
  }
  for (const targetId of findAllMissingDetours(
    collectArrayText(lines, j),
    knownIds
  )) {
    diagnostics.push({
      filePath,
      line: lineNum,
      message: `Trail "${trailId}" has detour targeting "${targetId}" which is not defined.`,
      rule: 'valid-detour-refs',
      severity: 'error',
    });
  }
};

const scanTrailDetours = (
  lines: readonly string[],
  startIndex: number,
  trailId: string,
  filePath: string,
  knownIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const braceState: BraceState = { depth: 0, found: false };
  for (let j = startIndex; j < lines.length && j < startIndex + 200; j += 1) {
    const specLine = lines[j];
    if (!specLine) {
      continue;
    }
    trackBraces(specLine, braceState);
    addMissingDetourDiagnostics(
      specLine,
      j,
      lines,
      trailId,
      startIndex + 1,
      filePath,
      knownIds,
      diagnostics
    );
    if (braceState.found && braceState.depth <= 0) {
      break;
    }
  }
};

const processLine = (
  line: string,
  i: number,
  lines: readonly string[],
  filePath: string,
  knownIds: ReadonlySet<string>,
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
  scanTrailDetours(lines, i, trailId, filePath, knownIds, diagnostics);
};

const checkDetourRefs = (
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const lines = sourceCode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line) {
      processLine(line, i, lines, filePath, knownIds, diagnostics);
    }
  }
  return diagnostics;
};

/**
 * Checks that all trail IDs referenced in `detours` declarations exist.
 */
export const validDetourRefs: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkDetourRefs(
      sourceCode,
      filePath,
      new Set(collectTrailIds(sourceCode))
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkDetourRefs(sourceCode, filePath, context.knownTrailIds);
  },
  description: 'Ensure all detour target trail IDs reference defined trails.',
  name: 'valid-detour-refs',
  severity: 'error',
};
