import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';
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

const collectDetourTargets = (sourceCode: string): ReadonlySet<string> => {
  const targets = new Set<string>();
  for (const block of sourceCode.matchAll(
    /\bdetours\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/g
  )) {
    const [, detourBody] = block;
    if (!detourBody) {
      continue;
    }
    for (const match of detourBody.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      const [, targetId] = match;
      if (targetId && targetId.includes('.')) {
        targets.add(targetId);
      }
    }
  }
  return targets;
};

const reportThrow = (
  trailId: string,
  filePath: string,
  lineNumber: number,
  diagnostics: WardenDiagnostic[]
): void => {
  diagnostics.push({
    filePath,
    line: lineNumber,
    message: `Trail "${trailId}" is a detour target and must not throw. Use Result.err() instead.`,
    rule: 'no-throw-in-detour-target',
    severity: 'error',
  });
};

const startImplementation = (
  line: string,
  state: ImplementationState
): boolean => {
  if (!/\bimplementation\s*:/.test(line)) {
    return false;
  }

  if (
    line.includes('=>') &&
    !line.split('=>', 2)[1]?.trimStart().startsWith('{')
  ) {
    return false;
  }

  state.inImplementation = true;
  state.braceDepth = 0;
  return true;
};

const processImplementationLine = (
  line: string,
  trailId: string,
  targeted: boolean,
  lineNumber: number,
  filePath: string,
  state: ImplementationState,
  diagnostics: WardenDiagnostic[]
): void => {
  if (targeted && /\bthrow\s+/.test(line)) {
    reportThrow(trailId, filePath, lineNumber, diagnostics);
  }

  state.braceDepth += countBraces(line);
  if (state.braceDepth <= 0) {
    state.inImplementation = false;
    state.braceDepth = 0;
  }
};

const shouldStopScan = (state: BlockState): boolean =>
  state.found && state.depth <= 0;

const scanTrailLine = (
  line: string,
  lineNumber: number,
  trailId: string,
  targeted: boolean,
  filePath: string,
  blockState: BlockState,
  implementationState: ImplementationState,
  diagnostics: WardenDiagnostic[]
): boolean => {
  if (!line) {
    return false;
  }

  trackBraces(line, blockState);

  if (!implementationState.inImplementation) {
    const started = startImplementation(line, implementationState);
    if (!started) {
      return shouldStopScan(blockState);
    }
  }

  processImplementationLine(
    line,
    trailId,
    targeted,
    lineNumber,
    filePath,
    implementationState,
    diagnostics
  );

  return shouldStopScan(blockState);
};

const scanTrailBlock = (
  lines: readonly string[],
  startIndex: number,
  trailId: string,
  targeted: boolean,
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const blockState: BlockState = { depth: 0, found: false };
  const implementationState: ImplementationState = {
    braceDepth: 0,
    inImplementation: false,
  };

  for (let j = startIndex; j < lines.length && j < startIndex + 200; j += 1) {
    if (
      scanTrailLine(
        lines[j] ?? '',
        j + 1,
        trailId,
        targeted,
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

const scanTrailDefinition = (
  line: string,
  index: number,
  lines: readonly string[],
  filePath: string,
  detourTargets: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const trailMatch = line.match(/\b(?:trail|hike)\s*\(\s*["'`]([^"'`]+)["'`]/);
  const trailId = trailMatch?.[1];
  if (!trailId) {
    return;
  }

  scanTrailBlock(
    lines,
    index,
    trailId,
    detourTargets.has(trailId),
    filePath,
    diagnostics
  );
};

const checkThrowInDetourTargets = (
  sourceCode: string,
  filePath: string,
  detourTargets: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];
  const lines = sourceCode.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    scanTrailDefinition(line, i, lines, filePath, detourTargets, diagnostics);
  }

  return diagnostics;
};

/**
 * Flags throws in implementations that are used as detour targets.
 */
export const noThrowInDetourTarget: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkThrowInDetourTargets(
      sourceCode,
      filePath,
      collectDetourTargets(sourceCode)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkThrowInDetourTargets(
      sourceCode,
      filePath,
      context.detourTargetTrailIds ?? collectDetourTargets(sourceCode)
    );
  },
  description:
    'Disallow throw statements inside implementations that are referenced as detour targets.',
  name: 'no-throw-in-detour-target',
  severity: 'error',
};
