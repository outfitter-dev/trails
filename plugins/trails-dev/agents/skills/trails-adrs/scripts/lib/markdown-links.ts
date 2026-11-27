import { markdownDestinationSpans } from './markdown-parser.generated.js';

export { decodeMarkdownDestination } from './markdown-parser.generated.js';

/** Decode a rendered local URL path without turning encoded bytes into separators. */
export const decodeLocalMarkdownPath = (path: string): string | null => {
  if (/%(?:2f|5c)|\\/i.test(path)) {
    return null;
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
};

/** Markdown link scanning shared by ADR operations and repository link validation. */
export interface MarkdownLink {
  readonly line: number;
  readonly target: string;
  readonly text: string;
}

interface DestinationSpan extends Omit<MarkdownLink, 'target'> {
  readonly start: number;
  readonly end: number;
}

const destinationSpans: (markdown: string) => readonly DestinationSpan[] =
  markdownDestinationSpans;

/** Visit link destinations in source order without changing the surrounding syntax. */
export const rewriteMarkdownLinks = (
  markdown: string,
  rewrite: (link: MarkdownLink, enclosed: boolean) => string
): string => {
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end, ...link } of destinationSpans(markdown)) {
    const target = rewrite(
      { ...link, target: markdown.slice(start, end) },
      markdown[start - 1] === '<'
    );
    parts.push(markdown.slice(cursor, start), target);
    cursor = end;
  }
  parts.push(markdown.slice(cursor));
  return parts.join('');
};

/** Collect nonempty inline, image, and reference definition destinations. */
export const extractMarkdownLinks = (
  markdown: string
): readonly MarkdownLink[] =>
  destinationSpans(markdown).map(({ start, end, ...link }) => ({
    ...link,
    target: markdown.slice(start, end),
  }));
