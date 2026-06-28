const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizePath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/^\.\//, '');

export const pathPatternToRegExp = (pattern: string): RegExp => {
  const normalized = normalizePath(pattern);
  const parts: string[] = ['^'];

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '*' && next === '*') {
      if (normalized[index + 2] === '/') {
        parts.push('(?:.*/)?');
        index += 2;
      } else {
        parts.push('.*');
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      parts.push('[^/]*');
      continue;
    }
    parts.push(escapeRegExp(char ?? ''));
  }

  parts.push('$');
  return new RegExp(parts.join(''));
};

export const matchesPathPattern = (path: string, pattern: string): boolean => {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  if (
    normalizedPattern.endsWith('/**') &&
    normalizedPath === normalizedPattern.slice(0, -3)
  ) {
    return true;
  }
  return pathPatternToRegExp(normalizedPattern).test(normalizedPath);
};

export const matchesAnyPathPattern = (
  path: string,
  patterns: readonly string[]
): boolean => patterns.some((pattern) => matchesPathPattern(path, pattern));
