interface InlineDestination {
  readonly start: number;
  readonly end: number;
  readonly close: number;
}

const skipWhitespace = (line: string, offset: number): number => {
  let cursor = offset;
  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1;
  }
  return cursor;
};

const delimitedEnd = (
  line: string,
  offset: number,
  delimiter: string
): number | null => {
  for (let cursor = offset; cursor < line.length; cursor += 1) {
    if (line[cursor] === '\\' && cursor + 1 < line.length) {
      cursor += 1;
      continue;
    }
    if (line[cursor] === delimiter) {
      return cursor;
    }
  }
  return null;
};

const barePathEnd = (line: string, start: number): number | null => {
  let depth = 0;
  for (let cursor = start; cursor < line.length; cursor += 1) {
    const character = line[cursor];
    if (character === '\\' && cursor + 1 < line.length) {
      cursor += 1;
      continue;
    }
    if ((character === ')' && depth === 0) || /\s/.test(character)) {
      return depth === 0 ? cursor : null;
    }
    if (character === '(') {
      depth += 1;
    }
    if (character === ')') {
      depth -= 1;
    }
  }
  return null;
};

const linkClose = (line: string, offset: number): number | null => {
  let cursor = skipWhitespace(line, offset);
  if (line[cursor] === ')') {
    return cursor;
  }
  const quote = line[cursor];
  if (quote !== '"' && quote !== "'" && quote !== '(') {
    return null;
  }
  const titleEnd = delimitedEnd(line, cursor + 1, quote === '(' ? ')' : quote);
  if (titleEnd === null) {
    return null;
  }
  cursor = skipWhitespace(line, titleEnd + 1);
  return line[cursor] === ')' ? cursor : null;
};

/** Find a complete inline destination without consuming nested labels or truncating balanced paths. */
export const inlineDestination = (
  line: string,
  opening: number
): InlineDestination | null => {
  const first = skipWhitespace(line, opening + 1);
  const angle = line[first] === '<';
  const start = first + (angle ? 1 : 0);
  const end = angle ? delimitedEnd(line, start, '>') : barePathEnd(line, start);
  if (end === null) {
    return null;
  }
  const close = linkClose(line, end + (angle ? 1 : 0));
  return close === null ? null : { close, end, start };
};

/** Decode Markdown's escaped ASCII punctuation before resolving a destination on disk. */
export const unescapeMarkdownTarget = (target: string): string =>
  target.replaceAll(/\\([\s\S])/g, (escaped, character: string) => {
    const code = character.codePointAt(0) ?? 0;
    const punctuation =
      (code >= 33 && code <= 47) ||
      (code >= 58 && code <= 64) ||
      (code >= 91 && code <= 96) ||
      (code >= 123 && code <= 126);
    return punctuation ? character : escaped;
  });
