import { z } from 'zod';

const isCanonicalPathname = (path: string): boolean =>
  path.startsWith('/') &&
  !path.startsWith('//') &&
  !/[?#\\*]/.test(path) &&
  new URL(path, 'https://trails.invalid').pathname === path;

/**
 * Pure Worker host data shared by runtime routing and later overlay derivation.
 * MCP uses one exact, case-sensitive serialized URL pathname, including its
 * trailing slash, independent of HTTP basePath. Queries do not affect matching.
 * Relative paths, noncanonical
 * URL paths, queries, fragments, backslashes and globs are invalid.
 * Runtime functions and native env objects do not belong in this schema.
 *
 * @example
 * ```ts
 * const host = workersHostConfigSchema.parse({ mcp: { path: '/mcp' } });
 * ```
 */
export const workersHostConfigSchema = z
  .strictObject({
    assets: z
      .strictObject({ binding: z.string().min(1) })
      .readonly()
      .optional(),
    mcp: z
      .strictObject({
        path: z.string().refine(isCanonicalPathname, {
          error:
            'MCP path must be an absolute canonical pathname without queries, fragments, backslashes or globs',
        }),
      })
      .readonly()
      .optional(),
  })
  .readonly();

/** Authored host data, independent of protocol implementation or SDK objects. */
export type WorkersHostConfig = z.infer<typeof workersHostConfigSchema>;
