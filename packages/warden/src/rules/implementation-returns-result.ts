import type { WardenDiagnostic, WardenRule } from './types.js';
import { isTestFile } from './scan.js';

const countBraces = (line: string): number => {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{') {
      delta += 1;
    }
    if (ch === '}') {
      delta -= 1;
    }
  }
  return delta;
};

interface BlockState {
  depth: number;
  found: boolean;
}

interface ImplementationState {
  braceDepth: number;
  inImplementation: boolean;
  resultVariables: Set<string>;
  resultHelperNames: ReadonlySet<string>;
}

const trackBraces = (line: string, state: BlockState): void => {
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

const appendBlockLine = (blockText: string, line: string): string =>
  `${blockText}${line}\n`;

const shouldStopBlockScan = (state: BlockState): boolean =>
  state.found && state.depth <= 0;

const updateBlockScanState = (line: string, state: BlockState): boolean => {
  trackBraces(line, state);
  return shouldStopBlockScan(state);
};

const collectBalancedBlock = (
  lines: readonly string[],
  startIndex: number
): string => {
  const blockState: BlockState = { depth: 0, found: false };
  let blockText = '';

  for (let i = startIndex; i < lines.length && i < startIndex + 80; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }

    blockText = appendBlockLine(blockText, line);
    if (updateBlockScanState(line, blockState)) {
      break;
    }
  }

  return blockText;
};

const addTrackedResultVariables = (
  line: string,
  state: ImplementationState
): void => {
  for (const match of line.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:ctx\.follow\s*\(|[\w$]+\.implementation\s*\(|Result\.(?:ok|err)\s*\()/g
  )) {
    const [, name] = match;
    if (name) {
      state.resultVariables.add(name);
    }
  }

  for (const match of line.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  )) {
    const [, name, helperName] = match;
    if (name && helperName && state.resultHelperNames.has(helperName)) {
      state.resultVariables.add(name);
    }
  }
};

const matchesResultHelperCall = (
  expression: string,
  state: ImplementationState
): boolean => {
  const helperCall = expression.match(/^(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/);
  return Boolean(helperCall?.[1] && state.resultHelperNames.has(helperCall[1]));
};

const matchesAllowedConciseExpression = (
  expression: string,
  state: ImplementationState
): boolean => {
  const normalized = expression.trim().replace(/[,;]\s*$/, '');
  const allowedPatterns = [
    /^(?:await\s+)?Result\.(?:ok|err)\s*\(/,
    /^(?:await\s+)?ctx\.follow\s*\(/,
    /^(?:await\s+)?[A-Za-z_$][\w$]*\.implementation\s*\(/,
  ];

  if (allowedPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (matchesResultHelperCall(normalized, state)) {
    return true;
  }

  if (!/^(?:await\s+)?[A-Za-z_$][\w$]*$/.test(normalized)) {
    return false;
  }

  const variable = normalized.replace(/^await\s+/, '');
  return state.resultVariables.has(variable);
};

const hasAllowedReturnPattern = (normalized: string): boolean => {
  const allowedPatterns = [
    /^return\s+(?:await\s+)?Result\.(?:ok|err)\s*\(/,
    /^return\s+(?:await\s+)?ctx\.follow\s*\(/,
    /^return\s+(?:await\s+)?[A-Za-z_$][\w$]*\.implementation\s*\(/,
  ];

  return allowedPatterns.some((pattern) => pattern.test(normalized));
};

const hasAllowedResultHelperReturn = (
  normalized: string,
  state: ImplementationState
): boolean => {
  const helperCall = normalized.match(
    /^return\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/
  );
  return Boolean(helperCall?.[1] && state.resultHelperNames.has(helperCall[1]));
};

const matchesTrackedReturnVariable = (
  normalized: string,
  state: ImplementationState
): boolean => {
  const awaitedIdentifier = normalized.match(
    /^return\s+await\s+([A-Za-z_$][\w$]*)\s*;?\s*(?:\/\/.*)?$/
  );
  if (awaitedIdentifier?.[1]) {
    return state.resultVariables.has(awaitedIdentifier[1]);
  }

  const identifier = normalized.match(
    /^return\s+([A-Za-z_$][\w$]*)\s*;?\s*(?:\/\/.*)?$/
  );
  return Boolean(identifier?.[1] && state.resultVariables.has(identifier[1]));
};

const matchesAllowedReturn = (
  line: string,
  state: ImplementationState
): boolean => {
  const normalized = line.trim();

  if (/^return\s*;?\s*(?:\/\/.*)?$/.test(normalized)) {
    return false;
  }

  if (hasAllowedReturnPattern(normalized)) {
    return true;
  }

  if (hasAllowedResultHelperReturn(normalized, state)) {
    return true;
  }

  return matchesTrackedReturnVariable(normalized, state);
};

const extractHelperName = (line: string): string | null => {
  const constMatch = line.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/
  );
  if (constMatch?.[1]) {
    return constMatch[1];
  }

  const functionMatch = line.match(
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/
  );
  return functionMatch?.[1] ?? null;
};

const hasExplicitResultReturnType = (blockText: string): boolean => {
  const signature = blockText.includes('=>')
    ? (blockText.split('=>', 1)[0] ?? '')
    : (blockText.split('{', 1)[0] ?? '');

  return /:\s*(?:Promise\s*<\s*)?Result\s*</.test(signature);
};

const extractResultHelperName = (
  lines: readonly string[],
  startIndex: number
): string | null => {
  const line = lines[startIndex];
  if (!line) {
    return null;
  }

  const helperName = extractHelperName(line);
  if (!helperName) {
    return null;
  }

  return hasExplicitResultReturnType(collectBalancedBlock(lines, startIndex))
    ? helperName
    : null;
};

const collectResultHelperNames = (
  lines: readonly string[]
): ReadonlySet<string> => {
  const helperNames = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const helperName = extractResultHelperName(lines, i);
    if (!helperName) {
      continue;
    }
    helperNames.add(helperName);
  }

  return helperNames;
};

const reportRawValue = (
  trailLabel: string,
  trailId: string,
  lineNumber: number,
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  diagnostics.push({
    filePath,
    line: lineNumber,
    message: `${trailLabel} "${trailId}" implementation must return Result.ok(...) or Result.err(...), not a raw value.`,
    rule: 'implementation-returns-result',
    severity: 'error',
  });
};

const startImplementation = (
  line: string,
  trailId: string,
  trailLabel: string,
  lineNumber: number,
  filePath: string,
  state: ImplementationState,
  diagnostics: WardenDiagnostic[]
): boolean => {
  if (!/\bimplementation\s*:/.test(line)) {
    return false;
  }

  const afterArrow = line.includes('=>') ? line.split('=>', 2)[1] : null;
  if (afterArrow && !afterArrow.trimStart().startsWith('{')) {
    if (!matchesAllowedConciseExpression(afterArrow, state)) {
      reportRawValue(trailLabel, trailId, lineNumber, filePath, diagnostics);
    }
    return false;
  }

  state.inImplementation = true;
  state.braceDepth = 0;
  return true;
};

const processImplementationLine = (
  line: string,
  trailId: string,
  trailLabel: string,
  lineNumber: number,
  filePath: string,
  state: ImplementationState,
  diagnostics: WardenDiagnostic[]
): void => {
  addTrackedResultVariables(line, state);

  if (!matchesAllowedReturn(line, state) && /\breturn\b/.test(line)) {
    reportRawValue(trailLabel, trailId, lineNumber, filePath, diagnostics);
  }

  state.braceDepth += countBraces(line);
  if (state.braceDepth <= 0) {
    state.inImplementation = false;
    state.braceDepth = 0;
    state.resultVariables.clear();
  }
};

const shouldStopScan = (state: BlockState): boolean =>
  state.found && state.depth <= 0;

const scanTrailLine = (
  line: string,
  lineNumber: number,
  trailId: string,
  trailLabel: string,
  filePath: string,
  blockState: BlockState,
  implementationState: ImplementationState,
  diagnostics: WardenDiagnostic[]
): boolean => {
  if (!line) {
    return false;
  }

  trackBraces(line, blockState);

  if (
    !implementationState.inImplementation &&
    !startImplementation(
      line,
      trailId,
      trailLabel,
      lineNumber,
      filePath,
      implementationState,
      diagnostics
    )
  ) {
    return shouldStopScan(blockState);
  }

  processImplementationLine(
    line,
    trailId,
    trailLabel,
    lineNumber,
    filePath,
    implementationState,
    diagnostics
  );

  return shouldStopScan(blockState);
};

const scanTrailImplementation = (
  lines: readonly string[],
  startIndex: number,
  trailId: string,
  trailLabel: string,
  filePath: string,
  resultHelperNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const blockState: BlockState = { depth: 0, found: false };
  const implementationState: ImplementationState = {
    braceDepth: 0,
    inImplementation: false,
    resultHelperNames,
    resultVariables: new Set<string>(),
  };

  for (let j = startIndex; j < lines.length && j < startIndex + 200; j += 1) {
    if (
      scanTrailLine(
        lines[j] ?? '',
        j + 1,
        trailId,
        trailLabel,
        filePath,
        blockState,
        implementationState,
        diagnostics
      )
    ) {
      break;
    }
  }
};

const processLine = (
  line: string,
  i: number,
  lines: readonly string[],
  filePath: string,
  resultHelperNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const trailMatch = line.match(/\b(?:trail|hike)\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!trailMatch?.[1]) {
    return;
  }

  const trailLabel = line.includes('hike(') ? 'Hike' : 'Trail';
  scanTrailImplementation(
    lines,
    i,
    trailMatch[1],
    trailLabel,
    filePath,
    resultHelperNames,
    diagnostics
  );
};

/**
 * Finds implementations that return raw values instead of `Result`.
 */
export const implementationReturnsResult: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const lines = sourceCode.split('\n');
    const resultHelperNames = collectResultHelperNames(lines);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) {
        processLine(
          line,
          i + 1,
          lines,
          filePath,
          resultHelperNames,
          diagnostics
        );
      }
    }

    return diagnostics;
  },
  description:
    'Disallow implementations that return raw values instead of Result.ok() or Result.err().',
  name: 'implementation-returns-result',
  severity: 'error',
};
