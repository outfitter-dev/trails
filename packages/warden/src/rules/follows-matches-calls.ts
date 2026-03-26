import type { WardenDiagnostic, WardenRule } from './types.js';

interface BraceState {
  depth: number;
  found: boolean;
}

interface HikeBlockResult {
  called: string[];
  declared: string[];
}

interface HelperFollowInfo {
  directCalls: readonly string[];
  nestedHelperNames: readonly string[];
}

const DIRECT_FOLLOW_CALL =
  /ctx\.follow(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g;
const HELPER_FOLLOW_CALL =
  /(?:^|[^\w$.])follow(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/gm;
const HELPER_INVOCATION = /\b([A-Za-z_$][\w$]*)\s*\(\s*ctx\.follow\b/g;
const NESTED_HELPER_INVOCATION = /\b([A-Za-z_$][\w$]*)\s*\(\s*follow\b/g;

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

const appendBlockLine = (blockText: string, line: string): string =>
  `${blockText}${line}\n`;

const shouldStopBlockScan = (state: BraceState): boolean =>
  state.found && state.depth <= 0;

const updateBlockScanState = (line: string, state: BraceState): boolean => {
  trackBraces(line, state);
  return shouldStopBlockScan(state);
};

const collectBalancedBlock = (
  lines: readonly string[],
  startIndex: number
): string => {
  const braceState: BraceState = { depth: 0, found: false };
  let blockText = '';

  for (let i = startIndex; i < lines.length && i < startIndex + 200; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    blockText = appendBlockLine(blockText, line);
    if (updateBlockScanState(line, braceState)) {
      break;
    }
  }

  return blockText;
};

const extractStringValues = (text: string): string[] => {
  const values: string[] = [];
  for (const match of text.matchAll(/["'`]([^"'`]+)["'`]/g)) {
    const [, value] = match;
    if (value) {
      values.push(value);
    }
  }
  return values;
};

const extractFollowCalls = (text: string, pattern: RegExp): string[] => {
  const calls: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const [, trailId] = match;
    if (trailId) {
      calls.push(trailId);
    }
  }
  return calls;
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

const getHelperFollowInfo = (blockText: string): HelperFollowInfo | null => {
  if (!/\bfollow\b/.test(blockText)) {
    return null;
  }

  const directCalls = extractFollowCalls(blockText, HELPER_FOLLOW_CALL);
  const nestedHelperNames = extractFollowCalls(
    blockText,
    NESTED_HELPER_INVOCATION
  );
  return directCalls.length > 0 || nestedHelperNames.length > 0
    ? { directCalls, nestedHelperNames }
    : null;
};

const extractHelperFollowCallEntry = (
  lines: readonly string[],
  startIndex: number
): readonly [string, HelperFollowInfo] | null => {
  const line = lines[startIndex];
  if (!line) {
    return null;
  }

  const helperName = extractHelperName(line);
  if (!helperName) {
    return null;
  }

  const blockText = collectBalancedBlock(lines, startIndex);
  const helperFollowInfo = getHelperFollowInfo(blockText);
  return helperFollowInfo ? [helperName, helperFollowInfo] : null;
};

const finalizeResolvedHelperCalls = (
  helperName: string,
  resolved: ReadonlySet<string>,
  memo: Map<string, readonly string[]>,
  visiting: Set<string>
): readonly string[] => {
  visiting.delete(helperName);
  const calls = [...resolved];
  memo.set(helperName, calls);
  return calls;
};

const resolveHelperFollowCalls = (
  helperName: string,
  helperFollowInfos: ReadonlyMap<string, HelperFollowInfo>,
  memo: Map<string, readonly string[]>,
  visiting: Set<string>
): readonly string[] => {
  const cached = memo.get(helperName);
  if (cached || visiting.has(helperName)) {
    return cached ?? [];
  }

  const info = helperFollowInfos.get(helperName);
  if (!info) {
    return [];
  }

  visiting.add(helperName);
  const collectResolvedCalls = (): ReadonlySet<string> => {
    const resolved = new Set(info.directCalls);

    for (const nestedHelperName of info.nestedHelperNames) {
      for (const trailId of resolveHelperFollowCalls(
        nestedHelperName,
        helperFollowInfos,
        memo,
        visiting
      )) {
        resolved.add(trailId);
      }
    }

    return resolved;
  };

  return finalizeResolvedHelperCalls(
    helperName,
    collectResolvedCalls(),
    memo,
    visiting
  );
};

const buildResolvedHelperFollowCalls = (
  helperFollowInfos: ReadonlyMap<string, HelperFollowInfo>
): ReadonlyMap<string, readonly string[]> => {
  const helperFollowCalls = new Map<string, readonly string[]>();
  const memo = new Map<string, readonly string[]>();

  for (const helperName of helperFollowInfos.keys()) {
    helperFollowCalls.set(
      helperName,
      resolveHelperFollowCalls(helperName, helperFollowInfos, memo, new Set())
    );
  }

  return helperFollowCalls;
};

const collectHelperFollowCalls = (
  lines: readonly string[]
): ReadonlyMap<string, readonly string[]> => {
  const helperFollowInfos = new Map<string, HelperFollowInfo>();

  for (let i = 0; i < lines.length; i += 1) {
    const entry = extractHelperFollowCallEntry(lines, i);
    if (!entry) {
      continue;
    }

    const [helperName, helperFollowInfo] = entry;
    helperFollowInfos.set(helperName, helperFollowInfo);
  }

  return buildResolvedHelperFollowCalls(helperFollowInfos);
};

const extractDeclaredFollows = (blockText: string): string[] => {
  const match = blockText.match(/\bfollows\s*:\s*(\[[\s\S]*?\])/);
  return match?.[1] ? extractStringValues(match[1]) : [];
};

const extractHelperInvocations = (
  blockText: string,
  helperFollowCalls: ReadonlyMap<string, readonly string[]>
): string[] => {
  const called: string[] = [];

  for (const match of blockText.matchAll(HELPER_INVOCATION)) {
    const [, helperName] = match;
    if (helperName) {
      called.push(...(helperFollowCalls.get(helperName) ?? []));
    }
  }

  return called;
};

const scanHikeBlock = (
  lines: readonly string[],
  startIndex: number,
  helperFollowCalls: ReadonlyMap<string, readonly string[]>
): HikeBlockResult => {
  const blockText = collectBalancedBlock(lines, startIndex);
  return {
    called: [
      ...extractFollowCalls(blockText, DIRECT_FOLLOW_CALL),
      ...extractHelperInvocations(blockText, helperFollowCalls),
    ],
    declared: extractDeclaredFollows(blockText),
  };
};

const addUndeclaredErrors = (
  routeId: string,
  filePath: string,
  lineNum: number,
  declaredSet: ReadonlySet<string>,
  calledSet: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const calledId of calledSet) {
    if (!declaredSet.has(calledId)) {
      diagnostics.push({
        filePath,
        line: lineNum,
        message: `Route "${routeId}" calls ctx.follow("${calledId}") but "${calledId}" is not in the follows declaration.`,
        rule: 'follows-matches-calls',
        severity: 'error',
      });
    }
  }
};

const addUnusedWarnings = (
  routeId: string,
  filePath: string,
  lineNum: number,
  declaredSet: ReadonlySet<string>,
  calledSet: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const declaredId of declaredSet) {
    if (!calledSet.has(declaredId)) {
      diagnostics.push({
        filePath,
        line: lineNum,
        message: `Route "${routeId}" declares follows "${declaredId}" but never calls ctx.follow("${declaredId}").`,
        rule: 'follows-matches-calls',
        severity: 'warn',
      });
    }
  }
};

const emitMismatchDiagnostics = (
  routeId: string,
  filePath: string,
  lineNum: number,
  declared: readonly string[],
  called: readonly string[],
  diagnostics: WardenDiagnostic[]
): void => {
  const declaredSet = new Set(declared);
  const calledSet = new Set(called);
  addUndeclaredErrors(
    routeId,
    filePath,
    lineNum,
    declaredSet,
    calledSet,
    diagnostics
  );
  addUnusedWarnings(
    routeId,
    filePath,
    lineNum,
    declaredSet,
    calledSet,
    diagnostics
  );
};

const processLine = (
  line: string,
  i: number,
  lines: readonly string[],
  filePath: string,
  helperFollowCalls: ReadonlyMap<string, readonly string[]>,
  diagnostics: WardenDiagnostic[]
): void => {
  const routeMatch = line.match(/\bhike\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!routeMatch?.[1]) {
    return;
  }

  const { called, declared } = scanHikeBlock(lines, i, helperFollowCalls);
  if (declared.length === 0 && called.length === 0) {
    return;
  }

  emitMismatchDiagnostics(
    routeMatch[1],
    filePath,
    i + 1,
    declared,
    called,
    diagnostics
  );
};

/**
 * Checks that a route's `follows` declaration matches its `ctx.follow()` calls.
 */
export const followsMatchesCalls: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const diagnostics: WardenDiagnostic[] = [];
    const lines = sourceCode.split('\n');
    const helperFollowCalls = collectHelperFollowCalls(lines);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) {
        processLine(line, i, lines, filePath, helperFollowCalls, diagnostics);
      }
    }

    return diagnostics;
  },
  description:
    'Ensure route follows declarations match ctx.follow() calls in implementation.',
  name: 'follows-matches-calls',
  severity: 'error',
};
