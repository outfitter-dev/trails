import { z } from 'zod';

import { matchesAnyGlob, matchesGlob } from './glob.js';

declare const pathGlobBrand: unique symbol;

export type PathGlob = string & {
  readonly [pathGlobBrand]: 'PathGlob';
};

export const normalizePathScopePath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/^\.\//, '');

export const matchesPathGlob = (path: string, pattern: string): boolean =>
  matchesGlob(normalizePathScopePath(path), normalizePathScopePath(pattern), {
    separator: '/',
  });

export const matchesAnyPathGlob = (
  path: string,
  patterns: readonly string[] | undefined
): boolean =>
  matchesAnyGlob(
    normalizePathScopePath(path),
    patterns?.map(normalizePathScopePath),
    { separator: '/' }
  );

const pathGlobArraySchema = z.array(z.string()).readonly();

export const pathScopeSchema = z
  .object({
    exclude: pathGlobArraySchema.optional(),
    extensions: z.array(z.string()).readonly().optional(),
    include: pathGlobArraySchema.optional(),
  })
  .strict();

export type PathScope = z.output<typeof pathScopeSchema>;

const extensionOf = (path: string): string => {
  const normalized = normalizePathScopePath(path);
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
};

const normalizeExtension = (extension: string): string =>
  extension === '' || extension.startsWith('.') ? extension : `.${extension}`;

const includedByExtension = (
  path: string,
  extensions: readonly string[] | undefined
): boolean =>
  extensions === undefined ||
  extensions.length === 0 ||
  extensions.map(normalizeExtension).includes(extensionOf(path));

export const includedByPathScope = (path: string, scope?: PathScope): boolean =>
  (scope?.include === undefined ||
    scope.include.length === 0 ||
    matchesAnyPathGlob(path, scope.include)) &&
  !matchesAnyPathGlob(path, scope?.exclude) &&
  includedByExtension(path, scope?.extensions);
