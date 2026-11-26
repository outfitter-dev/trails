import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  decodeMarkdownDestination,
  extractMarkdownLinks,
  rewriteMarkdownLinks,
} from './markdown-links.ts';
import type { MarkdownLink } from './markdown-links.ts';

const isRelative = (target: string) =>
  target.length > 0 && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(target);

const splitTarget = (target: string) => {
  const units = /\\[\s\S]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z\d]+);|[?#]/g;
  for (const { 0: unit, index } of target.matchAll(units)) {
    const decoded = decodeMarkdownDestination(unit);
    if (decoded === '?' || decoded === '#') {
      return { path: target.slice(0, index), suffix: target.slice(index) };
    }
  }
  return { path: target, suffix: '' };
};

const parsePath = (raw: string, source: string, root?: string) => {
  const path = decodeMarkdownDestination(raw);
  const rooted = path.startsWith('/') && !path.startsWith('//');
  const base = rooted ? root : dirname(source);
  if (!(base && (rooted || isRelative(path)))) {
    return null;
  }
  const pathname = rooted ? path.slice(1) : path;
  try {
    return { absolute: resolve(base, decodeURIComponent(pathname)), rooted };
  } catch {
    return { absolute: null, rooted };
  }
};

export const resolveMarkdownFile = (
  target: string,
  source: string,
  root: string
): string | null =>
  parsePath(splitTarget(target).path, source, root)?.absolute ?? null;

const formatRelative = (path: string) =>
  isRelative(decodeMarkdownDestination(path)) ? path : `./${path}`;

const encodePath = (path: string) =>
  path
    .split(sep)
    .map((part) =>
      encodeURIComponent(part).replaceAll(
        /[!'()*]/g,
        (character) =>
          `%${character.codePointAt(0)?.toString(16).toUpperCase()}`
      )
    )
    .join('/');

/** Preserve each relative link's target when its document changes directories. */
export const rebaseRelativeLinks = (
  markdown: string,
  from: string,
  to: string
): string =>
  rewriteMarkdownLinks(markdown, ({ target }) => {
    const { path, suffix } = splitTarget(target);
    const parsed = parsePath(path, from);
    if (!parsed?.absolute) {
      return target;
    }
    const destination = parsed.absolute === from ? to : parsed.absolute;
    const base = dirname(to);
    const raw = formatRelative(
      relative(base, resolve(dirname(from), path)) || '.'
    );
    const rebased =
      parsePath(raw, to)?.absolute === destination
        ? raw
        : formatRelative(encodePath(relative(base, destination)) || '.');
    const trailingSlash =
      decodeMarkdownDestination(path).endsWith('/') && !rebased.endsWith('/')
        ? '/'
        : '';
    return rebased + trailingSlash + suffix;
  });

/** Retarget only links that resolve to the moved document. */
export const retargetLocalLinks = (
  markdown: string,
  source: string,
  from: string,
  to: string,
  root: string
): string =>
  rewriteMarkdownLinks(markdown, ({ target }) => {
    const { path, suffix } = splitTarget(target);
    const parsed = parsePath(path, source, root);
    if (parsed?.absolute !== from) {
      return target;
    }
    const base = parsed.rooted ? root : dirname(source);
    const moved = encodePath(relative(base, to));
    return (parsed.rooted ? '/' + moved : formatRelative(moved)) + suffix;
  });

/** Check local file targets only; heading anchors remain the repository check's responsibility. */
export const missingRelativeLinks = (
  markdown: string,
  source: string
): readonly MarkdownLink[] =>
  extractMarkdownLinks(markdown).filter(({ target }) => {
    const parsed = parsePath(splitTarget(target).path, source);
    return parsed !== null && !(parsed.absolute && existsSync(parsed.absolute));
  });
