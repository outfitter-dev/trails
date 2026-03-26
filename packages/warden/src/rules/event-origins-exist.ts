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

const findMissingIds = (
  text: string,
  knownIds: ReadonlySet<string>
): string[] => {
  const missing: string[] = [];
  for (const m of text.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    const [, id] = m;
    if (id && !knownIds.has(id)) {
      missing.push(id);
    }
  }
  return missing;
};

const addMissingOriginDiagnostics = (
  specLine: string,
  j: number,
  lines: readonly string[],
  eventId: string,
  lineNum: number,
  filePath: string,
  knownIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  if (!/\bfrom\s*:/.test(specLine)) {
    return;
  }
  for (const originId of findMissingIds(collectArrayText(lines, j), knownIds)) {
    diagnostics.push({
      filePath,
      line: lineNum,
      message: `Event "${eventId}" references origin "${originId}" which is not defined.`,
      rule: 'event-origins-exist',
      severity: 'error',
    });
  }
};

const scanEventOrigins = (
  lines: readonly string[],
  startIndex: number,
  eventId: string,
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
    addMissingOriginDiagnostics(
      specLine,
      j,
      lines,
      eventId,
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
  const eventMatch = line.match(/\bevent\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!eventMatch) {
    return;
  }
  const [, eventId] = eventMatch;
  if (!eventId) {
    return;
  }
  scanEventOrigins(lines, i, eventId, filePath, knownIds, diagnostics);
};

const checkEventOrigins = (
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
 * Checks that all trail IDs referenced in event `from` arrays exist.
 */
export const eventOriginsExist: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkEventOrigins(
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
    return checkEventOrigins(sourceCode, filePath, context.knownTrailIds);
  },
  description:
    'Ensure all trail IDs in event from declarations reference defined trails.',
  name: 'event-origins-exist',
  severity: 'error',
};
