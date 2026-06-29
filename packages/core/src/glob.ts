export interface GlobConfig {
  readonly separator: '/' | '.';
}

/**
 * Escape a literal string so it can be embedded safely in a RegExp source.
 *
 * @example
 * ```ts
 * const pattern = new RegExp(`^${escapeRegExp('@ontrails/core')}$`);
 * ```
 */
export const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const separatorRegExp = (separator: GlobConfig['separator']): string =>
  escapeRegExp(separator);

export const globToRegExp = (pattern: string, config: GlobConfig): RegExp => {
  const separator = separatorRegExp(config.separator);
  const parts: string[] = ['^'];

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === '*' && next === '*') {
      if (pattern[index + 2] === config.separator) {
        parts.push(`(?:.*${separator})?`);
        index += 2;
      } else {
        parts.push('.*');
        index += 1;
      }
      continue;
    }

    if (char === '*') {
      parts.push(`[^${separator}]*`);
      continue;
    }

    if (char === '?') {
      parts.push(`[^${separator}]`);
      continue;
    }

    parts.push(escapeRegExp(char ?? ''));
  }

  parts.push('$');
  return new RegExp(parts.join(''));
};

export const matchesGlob = (
  value: string,
  pattern: string,
  config: GlobConfig
): boolean => {
  if (value === pattern) {
    return true;
  }

  const terminalDoubleStar = `${config.separator}**`;
  if (pattern.endsWith(terminalDoubleStar)) {
    const parent = pattern.slice(0, -terminalDoubleStar.length);
    if (value === parent) {
      return true;
    }
  }

  return globToRegExp(pattern, config).test(value);
};

export const matchesAnyGlob = (
  value: string,
  patterns: readonly string[] | undefined,
  config: GlobConfig
): boolean =>
  patterns !== undefined &&
  patterns.some((pattern) => matchesGlob(value, pattern, config));
