import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  decodeLocalMarkdownPath,
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
  const pathname = decodeLocalMarkdownPath(rooted ? path.slice(1) : path);
  return {
    absolute: pathname === null ? null : resolve(base, pathname),
    rooted,
  };
};

export const resolveMarkdownFile = (
  target: string,
  source: string,
  root: string
): string | null =>
  parsePath(splitTarget(target).path, source, root)?.absolute ?? null;

const formatRelative = (path: string) =>
  isRelative(decodeMarkdownDestination(path)) ? path : `./${path}`;

const encodeCharacter = (character: string) =>
  `%${character.codePointAt(0)?.toString(16).padStart(2, '0').toUpperCase()}`;

const encodePath = (path: string) =>
  path
    .split(sep)
    .map((part) =>
      encodeURIComponent(part).replaceAll(/[!'()*]/g, encodeCharacter)
    )
    .join('/');

const parsesAsDestination = (target: string, enclosed: boolean) => {
  if (/^[a-z\d._:/%#?=&+-]+$/i.test(target)) {
    return true;
  }
  const source = enclosed ? `<${target}>` : target;
  for (const markdown of [`[x](${source})`, `[x]: ${source}`]) {
    if (extractMarkdownLinks(markdown)[0]?.target !== target) {
      return false;
    }
  }
  return true;
};

const preserveSuffix = (path: string, suffix: string, enclosed: boolean) => {
  if (parsesAsDestination(path + suffix, enclosed)) {
    return path + suffix;
  }
  return (
    path +
    suffix.replaceAll(/\\[\s\S]|[()<>|]/g, (unit) =>
      unit.length === 1 ? '\\' + unit : unit
    )
  );
};

/** Preserve each relative link's target when its document changes directories. */
export const rebaseRelativeLinks = (
  markdown: string,
  from: string,
  to: string
): string =>
  rewriteMarkdownLinks(markdown, ({ target }, enclosed) => {
    const { path, suffix } = splitTarget(target);
    const parsed = parsePath(path, from);
    if (!parsed?.absolute) {
      return target;
    }
    const destination = parsed.absolute === from ? to : parsed.absolute;
    const base = dirname(to);
    const raw = formatRelative(
      relative(base, resolve(dirname(from), path))
        .split(sep)
        .join('/') || '.'
    );
    const rebased =
      parsePath(raw, to)?.absolute === destination &&
      parsesAsDestination(raw + suffix, enclosed)
        ? raw
        : formatRelative(encodePath(relative(base, destination)) || '.');
    const trailingSlash =
      decodeMarkdownDestination(path).endsWith('/') && !rebased.endsWith('/')
        ? '/'
        : '';
    return preserveSuffix(rebased + trailingSlash, suffix, enclosed);
  });

/** Retarget only links that resolve to the moved document. */
export const retargetLocalLinks = (
  markdown: string,
  source: string,
  from: string,
  to: string,
  root: string
): string =>
  rewriteMarkdownLinks(markdown, ({ target }, enclosed) => {
    const { path, suffix } = splitTarget(target);
    const parsed = parsePath(path, source, root);
    if (parsed?.absolute !== from) {
      return target;
    }
    const base = parsed.rooted ? root : dirname(source);
    const moved = encodePath(relative(base, to));
    return preserveSuffix(
      parsed.rooted ? `/${moved}` : formatRelative(moved),
      suffix,
      enclosed
    );
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
