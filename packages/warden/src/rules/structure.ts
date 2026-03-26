type QuoteMode = '"' | "'" | '`' | null;

interface ScanState {
  braceDepth: number;
  bracketDepth: number;
  escaped: boolean;
  parenDepth: number;
  quoteMode: QuoteMode;
}

type DepthKey = 'braceDepth' | 'bracketDepth' | 'parenDepth';

export interface BalancedSegment {
  readonly end: number;
  readonly text: string;
}

export interface SplitEntry {
  readonly start: number;
  readonly text: string;
}

const createState = (): ScanState => ({
  braceDepth: 0,
  bracketDepth: 0,
  escaped: false,
  parenDepth: 0,
  quoteMode: null,
});

const enterQuote = (ch: string): QuoteMode => {
  if (ch === "'" || ch === '"' || ch === '`') {
    return ch;
  }
  return null;
};

const clearEscape = (state: ScanState): boolean => {
  if (!state.escaped) {
    return false;
  }

  state.escaped = false;
  return true;
};

const beginEscape = (state: ScanState, ch: string): boolean => {
  if (ch !== '\\') {
    return false;
  }

  state.escaped = true;
  return true;
};

const closeQuote = (state: ScanState, ch: string): void => {
  if (ch === state.quoteMode) {
    state.quoteMode = null;
  }
};

const updateQuotedState = (state: ScanState, ch: string): boolean => {
  if (state.quoteMode === null) {
    return false;
  }

  if (clearEscape(state)) {
    return true;
  }

  if (beginEscape(state, ch)) {
    return true;
  }

  closeQuote(state, ch);
  return true;
};

const STRUCTURAL_DELTAS = {
  '(': ['parenDepth', 1],
  ')': ['parenDepth', -1],
  '[': ['bracketDepth', 1],
  ']': ['bracketDepth', -1],
  '{': ['braceDepth', 1],
  '}': ['braceDepth', -1],
} as const satisfies Record<string, readonly [DepthKey, number]>;

const updateStructuralDepth = (state: ScanState, ch: string): void => {
  if (!(ch in STRUCTURAL_DELTAS)) {
    return;
  }

  const delta = STRUCTURAL_DELTAS[ch as keyof typeof STRUCTURAL_DELTAS];
  const [key, amount] = delta;
  state[key] += amount;
};

const isTopLevel = (state: ScanState): boolean =>
  state.braceDepth === 0 &&
  state.bracketDepth === 0 &&
  state.parenDepth === 0 &&
  state.quoteMode === null;

const scanCharacter = (state: ScanState, ch: string): void => {
  if (updateQuotedState(state, ch)) {
    return;
  }

  const nextQuoteMode = enterQuote(ch);
  if (nextQuoteMode !== null) {
    state.quoteMode = nextQuoteMode;
    return;
  }

  updateStructuralDepth(state, ch);
};

const isBalancedOpener = (ch: string | undefined): boolean =>
  ch === '{' || ch === '[' || ch === '(';

const appendBalancedCharacter = (
  sourceText: string,
  state: ScanState,
  index: number,
  text: string
): string => {
  const ch = sourceText[index];
  if (!ch) {
    return text;
  }

  scanCharacter(state, ch);
  return `${text}${ch}`;
};

export const captureBalanced = (
  sourceText: string,
  startIndex: number
): BalancedSegment | null => {
  if (!isBalancedOpener(sourceText[startIndex])) {
    return null;
  }

  const state = createState();
  let text = '';

  for (let index = startIndex; index < sourceText.length; index += 1) {
    text = appendBalancedCharacter(sourceText, state, index, text);

    if (index > startIndex && isTopLevel(state)) {
      return { end: index, text };
    }
  }

  return null;
};

export const findBalancedAfter = (
  sourceText: string,
  marker: string,
  openChar: '{' | '[' | '('
): BalancedSegment | null => {
  const markerIndex = sourceText.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const startIndex = sourceText.indexOf(openChar, markerIndex + marker.length);
  if (startIndex === -1) {
    return null;
  }

  return captureBalanced(sourceText, startIndex);
};

export const lineNumberAt = (sourceText: string, startIndex: number): number =>
  sourceText.slice(0, startIndex).split('\n').length;

const createSplitEntry = (
  sourceText: string,
  startIndex: number,
  endIndex: number
): SplitEntry | null => {
  const raw = sourceText.slice(startIndex, endIndex);
  const firstContent = raw.search(/\S/);
  if (firstContent === -1) {
    return null;
  }

  const trailingWhitespace = raw.match(/\s*$/)?.[0].length ?? 0;
  const trimmedEnd = raw.length - trailingWhitespace;

  return {
    start: startIndex + firstContent,
    text: raw.slice(firstContent, trimmedEnd),
  };
};

const pushSplitEntry = (
  entries: SplitEntry[],
  sourceText: string,
  startIndex: number,
  endIndex: number
): void => {
  const entry = createSplitEntry(sourceText, startIndex, endIndex);
  if (entry !== null) {
    entries.push(entry);
  }
};

const processSplitCharacter = (
  entries: SplitEntry[],
  sourceText: string,
  state: ScanState,
  entryStart: number,
  index: number
): number => {
  const ch = sourceText[index];
  if (!ch) {
    return entryStart;
  }

  if (ch === ',' && isTopLevel(state)) {
    pushSplitEntry(entries, sourceText, entryStart, index);
    return index + 1;
  }

  scanCharacter(state, ch);
  return entryStart;
};

export const splitTopLevelEntriesWithOffsets = (
  sourceText: string
): SplitEntry[] => {
  const entries: SplitEntry[] = [];
  const state = createState();
  let entryStart = 0;

  for (let index = 0; index < sourceText.length; index += 1) {
    entryStart = processSplitCharacter(
      entries,
      sourceText,
      state,
      entryStart,
      index
    );
  }

  pushSplitEntry(entries, sourceText, entryStart, sourceText.length);

  return entries;
};

export const splitTopLevelEntries = (sourceText: string): string[] =>
  splitTopLevelEntriesWithOffsets(sourceText).map((entry) => entry.text);
