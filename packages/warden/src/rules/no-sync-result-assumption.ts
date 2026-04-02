import type { WardenDiagnostic, WardenRule } from './types.js';
import {
  isFrameworkInternalFile,
  isTestFile,
  stripQuotedContent,
} from './scan.js';

const RESULT_ACCESS_PATTERN =
  /\.(?:isOk|isErr|match|map)\s*\(|\.(?:value|error)\b/;
const IMPLEMENTATION_CALL_PATTERN = /\.blaze\s*\(/;

const isAwaitedImplementationCall = (line: string): boolean => {
  const callIndex = line.indexOf('.blaze(');
  if (callIndex === -1) {
    return false;
  }

  const awaitIndex = line.indexOf('await');
  return awaitIndex !== -1 && awaitIndex < callIndex;
};

const isDirectResultAccess = (line: string): boolean =>
  IMPLEMENTATION_CALL_PATTERN.test(line) &&
  RESULT_ACCESS_PATTERN.test(line) &&
  !isAwaitedImplementationCall(line);

const isPendingUse = (line: string, variableName: string): boolean => {
  const escaped = variableName.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pendingPattern = new RegExp(
    `\\b${escaped}\\s*(?:\\.(?:isOk|isErr|match|map)\\s*\\(|\\.(?:value|error)\\b)`
  );
  return pendingPattern.test(line);
};

interface PendingCall {
  line: number;
  remainingLines: number;
  variableName: string;
}

const MISSING_AWAIT_MESSAGE =
  'Missing await: .blaze() returns Promise<Result> after normalization. Use `const result = await trail.blaze(input, ctx)`.';

const createMissingAwaitDiagnostic = (
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: MISSING_AWAIT_MESSAGE,
  rule: 'no-sync-result-assumption',
  severity: 'error',
});

const trackPendingCall = (line: string): string | undefined => {
  const match = line.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*)/
  );
  if (!match?.[1] || !match[2] || !IMPLEMENTATION_CALL_PATTERN.test(match[2])) {
    return undefined;
  }

  if (isAwaitedImplementationCall(match[2])) {
    return undefined;
  }

  return match[1];
};

const addPendingCall = (
  pendingCalls: PendingCall[],
  variableName: string,
  lineNumber: number
): void => {
  pendingCalls.push({
    line: lineNumber,
    remainingLines: 6,
    variableName,
  });
};

const advancePendingCalls = (
  line: string,
  filePath: string,
  lineNumber: number,
  pendingCalls: PendingCall[],
  diagnostics: WardenDiagnostic[]
): void => {
  for (let j = pendingCalls.length - 1; j >= 0; j -= 1) {
    const pendingCall = pendingCalls[j];
    if (pendingCall && isPendingUse(line, pendingCall.variableName)) {
      diagnostics.push(createMissingAwaitDiagnostic(filePath, lineNumber));
      pendingCalls.splice(j, 1);
    } else if (pendingCall) {
      pendingCall.remainingLines -= 1;
      if (pendingCall.remainingLines <= 0) {
        pendingCalls.splice(j, 1);
      }
    }
  }
};

const processLine = (
  line: string,
  filePath: string,
  lineNumber: number,
  pendingCalls: PendingCall[],
  diagnostics: WardenDiagnostic[]
): void => {
  if (isDirectResultAccess(line)) {
    diagnostics.push(createMissingAwaitDiagnostic(filePath, lineNumber));
    return;
  }

  const variableName = trackPendingCall(line);
  if (variableName) {
    addPendingCall(pendingCalls, variableName, lineNumber);
  }

  advancePendingCalls(line, filePath, lineNumber, pendingCalls, diagnostics);
};

const scanSourceCode = (
  sourceCode: string,
  filePath: string
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const lines = sourceCode.split('\n');
  const pendingCalls: PendingCall[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    processLine(line, filePath, i + 1, pendingCalls, diagnostics);
  }

  return diagnostics;
};

/**
 * Flags code that assumes `.blaze()` returns a synchronous result.
 */
export const noSyncResultAssumption: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath) || isFrameworkInternalFile(filePath)) {
      return [];
    }
    return scanSourceCode(stripQuotedContent(sourceCode), filePath);
  },
  description:
    'Disallow treating .blaze() as synchronous after normalization. Always await the returned Promise<Result>.',
  name: 'no-sync-result-assumption',
  severity: 'error',
};
