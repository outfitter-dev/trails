import { existsSync } from 'node:fs';

import { auditRoots } from './vocab-cutover-map';

export interface ScopeOptions {
  readonly globs: readonly string[];
  readonly paths: readonly string[];
}

export const parseFlagValues = (flag: string): string[] => {
  const values: string[] = [];

  for (let index = 2; index < Bun.argv.length; index += 1) {
    if (Bun.argv[index] !== flag) {
      continue;
    }

    const value = Bun.argv[index + 1];
    if (value) {
      values.push(value);
      index += 1;
    }
  }

  return values;
};

export const hasFlag = (flag: string): boolean => Bun.argv.includes(flag);

const normalizePath = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
};

const listGitFiles = (gitArgs: readonly string[]) => {
  const result = Bun.spawnSync(['git', ...gitArgs], {
    cwd: process.cwd(),
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    const error = new Error(result.stderr.toString());
    error.name = 'GitLsFilesError';
    throw error;
  }

  return result.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath);
};

const isAuditTarget = (path: string) =>
  auditRoots.some((root) => path === root || path.startsWith(root));

const matchesScopePath = (path: string, scopePath: string) => {
  const normalizedScope = normalizePath(scopePath);
  return path === normalizedScope || path.startsWith(`${normalizedScope}/`);
};

const matchesGlob = (path: string, globPattern: string) =>
  new Bun.Glob(globPattern).match(path);

const matchesScope = (path: string, options: ScopeOptions): boolean => {
  const pathMatch =
    options.paths.length === 0 ||
    options.paths.some((scopePath) => matchesScopePath(path, scopePath));
  const globMatch =
    options.globs.length === 0 ||
    options.globs.some((globPattern) => matchesGlob(path, globPattern));

  return pathMatch && globMatch;
};

export const getScopeOptions = (): ScopeOptions => ({
  globs: parseFlagValues('--glob'),
  paths: parseFlagValues('--path'),
});

export const listScopedRepoFiles = (
  options: ScopeOptions = getScopeOptions()
): string[] => {
  const tracked = listGitFiles(['ls-files']);
  const untracked = listGitFiles([
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);

  return [...new Set([...tracked, ...untracked])]
    .filter((path) => existsSync(path))
    .filter(isAuditTarget)
    .filter((path) => matchesScope(path, options));
};

export const formatScopeSummary = (options: ScopeOptions): string => {
  const parts: string[] = [];

  if (options.paths.length > 0) {
    parts.push(`paths=${options.paths.join(',')}`);
  }

  if (options.globs.length > 0) {
    parts.push(`globs=${options.globs.join(',')}`);
  }

  return parts.length === 0 ? 'entire repo target set' : parts.join(' ');
};
