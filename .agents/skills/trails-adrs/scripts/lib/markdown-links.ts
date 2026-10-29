import { inlineDestination } from './markdown-destinations.ts';
export { unescapeMarkdownTarget } from './markdown-destinations.ts';

/** Markdown link scanning shared by ADR operations and repository link validation. */
export interface MarkdownLink {
  readonly line: number;
  readonly target: string;
  readonly text: string;
}

interface MarkdownFence {
  readonly length: number;
  readonly marker: '`' | '~';
}

export const updateFenceState = (
  line: string,
  fence: MarkdownFence | null
): { readonly fence: MarkdownFence | null; readonly matched: boolean } => {
  const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!fenceMatch) {
    return { fence, matched: false };
  }
  const [, fenceMarker] = fenceMatch;
  const marker = fenceMarker.startsWith('`') ? '`' : '~';
  const { length } = fenceMarker;
  if (!fence) {
    return { fence: { length, marker }, matched: true };
  }
  if (
    fence.marker === marker &&
    length >= fence.length &&
    line.slice(fenceMatch[0].length).trim() === ''
  ) {
    return { fence: null, matched: true };
  }
  return { fence, matched: true };
};

interface LinkSpan extends MarkdownLink {
  readonly start: number;
  readonly end: number;
}

const destinationSpan = (raw: string, offset: number) => {
  const wrapped = `(${raw})`;
  const destination = inlineDestination(wrapped, 0);
  if (!destination || destination.close !== wrapped.length - 1) {
    return null;
  }
  return {
    end: offset + destination.end - 1,
    start: offset + destination.start - 1,
  };
};

const blankCode = (value: string) => value.replaceAll(/[^\n]/g, ' ');

const isEscaped = (text: string, offset: number): boolean => {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
};

const maskCode = (markdown: string): string => {
  let fence: MarkdownFence | null = null;
  const prose = markdown
    .split('\n')
    .map((line) => {
      const state = updateFenceState(line, fence);
      ({ fence } = state);
      return state.matched || fence ? blankCode(line) : line;
    })
    .join('\n');
  const runs = [...prose.matchAll(/`+/g)];
  let result = '';
  let cursor = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const opening = runs[index];
    if (isEscaped(prose, opening.index)) {
      continue;
    }
    // Backslashes are literal inside code spans, including before the closing run.
    const closingIndex = runs.findIndex(
      (run, candidate) =>
        candidate > index && run[0].length === opening[0].length
    );
    if (closingIndex === -1) {
      continue;
    }
    const end = runs[closingIndex].index + runs[closingIndex][0].length;
    result +=
      prose.slice(cursor, opening.index) +
      blankCode(prose.slice(opening.index, end));
    cursor = end;
    index = closingIndex;
  }
  return result + prose.slice(cursor);
};

const lineLinks = (
  line: string,
  masked: string,
  lineNumber: number
): LinkSpan[] => {
  const links: LinkSpan[] = [];
  const reference = /^\s{0,3}\[((?:\\.|[^\]\\])+)]:\s+(\S.*)$/.exec(masked);
  if (reference && !reference[1].startsWith('^')) {
    const span = destinationSpan(
      reference[2],
      line.length - reference[2].length
    );
    if (span) {
      links.push({
        ...span,
        line: lineNumber,
        target: line.slice(span.start, span.end),
        text: reference[1],
      });
      return links;
    }
  }
  const labels: number[] = [];
  for (let cursor = 0; cursor < masked.length; cursor += 1) {
    if (isEscaped(masked, cursor)) {
      continue;
    }
    if (masked[cursor] === '[') {
      labels.push(cursor);
      continue;
    }
    if (masked[cursor] !== ']') {
      continue;
    }
    const labelStart = labels.pop();
    if (labelStart === undefined || masked[cursor + 1] !== '(') {
      continue;
    }
    const destination = inlineDestination(masked, cursor + 1);
    if (!destination) {
      continue;
    }
    const { start, end, close } = destination;
    links.push({
      end,
      line: lineNumber,
      start,
      target: line.slice(start, end),
      text: line.slice(labelStart + 1, cursor).trim(),
    });
    cursor = close;
  }
  return links;
};

/** Visit rendered link destinations, leaving code samples and surrounding syntax intact. */
export const rewriteMarkdownLinks = (
  markdown: string,
  rewrite: (link: MarkdownLink) => string
): string => {
  const maskedLines = maskCode(markdown).split('\n');
  return markdown
    .split('\n')
    .map((line, index) => {
      const replacements = lineLinks(line, maskedLines[index], index + 1).map(
        ({ start, end, ...link }) => ({ end, start, target: rewrite(link) })
      );
      let result = line;
      for (const { start, end, target } of replacements.toReversed()) {
        result = result.slice(0, start) + target + result.slice(end);
      }
      return result;
    })
    .join('\n');
};

/** Collect inline links, images, and reference definitions outside code samples. */
export const extractMarkdownLinks = (
  markdown: string
): readonly MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  rewriteMarkdownLinks(markdown, (link) => {
    links.push(link);
    return link.target;
  });
  return links;
};
