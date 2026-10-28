import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  extractMarkdownLinks,
  rewriteMarkdownLinks,
  unescapeMarkdownTarget,
} from './markdown-links.ts';
import type { MarkdownLink } from './markdown-links.ts';

const isRelative = (target: string) =>
  target.length > 0 && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(target);

const splitTarget = (target: string) => {
  const suffixAt = target.search(/[?#]/);
  return suffixAt === -1
    ? { path: target, suffix: '' }
    : { path: target.slice(0, suffixAt), suffix: target.slice(suffixAt) };
};

/** Preserve each relative link's target when its document changes directories. */
export const rebaseRelativeLinks = (
  markdown: string,
  from: string,
  to: string
): string =>
  rewriteMarkdownLinks(markdown, ({ target }) => {
    if (!isRelative(unescapeMarkdownTarget(target))) {
      return target;
    }
    const { path, suffix } = splitTarget(target);
    const slashes = path.match(/\\+$/)?.[0].length ?? 0;
    const escapedSeparator = suffix.length > 0 && slashes % 2 === 1;
    const rawPath = escapedSeparator ? path.slice(0, -1) : path;
    const rawSuffix = escapedSeparator ? `\\${suffix}` : suffix;
    const originalTarget = resolve(dirname(from), rawPath);
    const rebased = relative(
      dirname(to),
      originalTarget === from ? to : originalTarget
    );
    return rebased + rawSuffix;
  });

/** Check local file targets only; heading anchors remain the repository check's responsibility. */
export const missingRelativeLinks = (
  markdown: string,
  source: string
): readonly MarkdownLink[] =>
  extractMarkdownLinks(markdown).filter(({ target }) => {
    const normalized = unescapeMarkdownTarget(target);
    if (!isRelative(normalized)) {
      return false;
    }
    const { path } = splitTarget(normalized);
    try {
      return !existsSync(join(dirname(source), decodeURIComponent(path)));
    } catch {
      return true;
    }
  });
