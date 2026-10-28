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
  if (fence.marker === marker && length >= fence.length) {
    return { fence: null, matched: true };
  }
  return { fence, matched: true };
};

interface LinkSpan extends MarkdownLink {
  readonly start: number;
  readonly end: number;
}

const destinationSpan = (raw: string, offset: number) => {
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  const angle = trimmed.startsWith('<');
  const start = leading + (angle ? 1 : 0);
  const end = angle ? trimmed.indexOf('>') : trimmed.search(/\s/);
  return {
    end: offset + leading + (end === -1 ? trimmed.length : end),
    start: offset + start,
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
  const reference = /^\s{0,3}\[([^\]]+)]:\s+(\S.*)$/.exec(masked);
  if (reference && !reference[1].startsWith('^')) {
    const span = destinationSpan(
      reference[2],
      line.length - reference[2].length
    );
    links.push({
      ...span,
      line: lineNumber,
      target: line.slice(span.start, span.end),
      text: reference[1],
    });
    return links;
  }
  const pattern = /!?\[([^\]\n]*)]\(([^)\n]+)\)/g;
  for (const match of masked.matchAll(pattern)) {
    const offset = match.index + match[0].indexOf('](') + 2;
    const span = destinationSpan(match[2], offset);
    links.push({
      ...span,
      line: lineNumber,
      target: line.slice(span.start, span.end),
      text: match[1].trim(),
    });
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
