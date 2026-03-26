import type { WardenDiagnostic, WardenRule } from './types.js';

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

interface ImplState {
  inImplementation: boolean;
  braceDepth: number;
}

const tryStartImpl = (line: string, state: ImplState): boolean => {
  if (!/\bimplementation\s*[:]/.test(line)) {
    return false;
  }
  state.inImplementation = true;
  state.braceDepth = countBraces(line);
  return true;
};

const checkThrow = (
  line: string,
  lineNumber: number,
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  if (/\bthrow\s+/.test(line)) {
    diagnostics.push({
      filePath,
      line: lineNumber,
      message: 'Do not throw inside implementation. Use Result.err() instead.',
      rule: 'no-throw-in-implementation',
      severity: 'error',
    });
  }
};

const processImplBody = (
  line: string,
  lineNumber: number,
  filePath: string,
  state: ImplState,
  diagnostics: WardenDiagnostic[]
): void => {
  state.braceDepth += countBraces(line);
  checkThrow(line, lineNumber, filePath, diagnostics);
  if (state.braceDepth <= 0) {
    state.inImplementation = false;
    state.braceDepth = 0;
  }
};

const processLine = (
  line: string,
  lineNumber: number,
  filePath: string,
  state: ImplState,
  diagnostics: WardenDiagnostic[]
): void => {
  if (!state.inImplementation && tryStartImpl(line, state)) {
    return;
  }
  if (state.inImplementation) {
    processImplBody(line, lineNumber, filePath, state, diagnostics);
  }
};

/**
 * Finds `throw` statements inside `implementation:` function bodies.
 */
export const noThrowInImplementation: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const diagnostics: WardenDiagnostic[] = [];
    const state: ImplState = { braceDepth: 0, inImplementation: false };
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) {
        processLine(line, i + 1, filePath, state, diagnostics);
      }
    }
    return diagnostics;
  },
  description:
    'Disallow throw statements inside trail/route implementation bodies. Use Result.err() instead.',
  name: 'no-throw-in-implementation',
  severity: 'error',
};
