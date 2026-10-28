import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  extractMarkdownLinks,
  rewriteMarkdownLinks,
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
    if (!isRelative(target)) {
      return target;
    }
    const { path, suffix } = splitTarget(target);
    const originalTarget = resolve(dirname(from), path);
    const rebased = relative(
      dirname(to),
      originalTarget === from ? to : originalTarget
    );
    return rebased + suffix;
  });

/** Check local file targets only; heading anchors remain the repository check's responsibility. */
export const missingRelativeLinks = (
  markdown: string,
  source: string
): readonly MarkdownLink[] =>
  extractMarkdownLinks(markdown).filter(({ target }) => {
    if (!isRelative(target)) {
      return false;
    }
    const { path } = splitTarget(target);
    try {
      return !existsSync(join(dirname(source), decodeURIComponent(path)));
    } catch {
      return true;
    }
  });
