const isPunctuation = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
};

/** Decode Markdown's escaped ASCII punctuation before resolving a destination on disk. */
export const unescapeMarkdownTarget = (target: string): string =>
  target.replaceAll(/\\([\s\S])/g, (escaped, character: string) =>
    isPunctuation(character) ? character : escaped
  );
