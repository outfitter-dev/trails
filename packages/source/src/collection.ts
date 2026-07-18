import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

/** Git-derived reasons a nested directory is outside the current observation tree. */
export type SourceCollectionBoundaryReason =
  | 'nested-repository'
  | 'nested-worktree'
  | 'submodule-boundary';

/** Filesystem entry kinds exposed to a source-collection policy. */
export type SourceCollectionEntryKind = 'directory' | 'file' | 'other';

/** A root-relative filesystem entry offered to a source-collection policy. */
export interface SourceCollectionEntry {
  readonly kind: SourceCollectionEntryKind;
  readonly name: string;
  readonly path: string;
}

/** The action a source-collection policy chooses for one entry. */
export type SourceCollectionDecision =
  | { readonly action: 'collect' }
  | { readonly action: 'recurse' }
  | { readonly action: 'skip'; readonly reason: string };

/** One collected file, with both absolute and root-relative identities. */
export interface CollectedSourceFile {
  readonly absolutePath: string;
  readonly path: string;
}

/** One visible collection skip. */
export interface SkippedSourceEntry {
  readonly path: string;
  readonly reason: string;
}

/** Deterministic result of observing one source tree. */
export interface SourceTreeCollection {
  readonly files: readonly CollectedSourceFile[];
  readonly root: string;
  readonly skipped: readonly SkippedSourceEntry[];
}

/** Consumer policy for ordinary entries after Git boundaries are derived. */
export interface CollectSourceTreeOptions {
  readonly classify?: (
    entry: SourceCollectionEntry
  ) => SourceCollectionDecision;
}

const toPosixRelative = (root: string, absolutePath: string): string => {
  const path = relative(root, absolutePath);
  return sep === posix.sep ? path : path.split(sep).join(posix.sep);
};

const entryKind = (entry: {
  isDirectory(): boolean;
  isFile(): boolean;
}): SourceCollectionEntryKind => {
  if (entry.isDirectory()) {
    return 'directory';
  }
  return entry.isFile() ? 'file' : 'other';
};

const defaultDecision = (
  entry: SourceCollectionEntry
): SourceCollectionDecision => {
  if (entry.kind === 'directory') {
    return { action: 'recurse' };
  }
  return entry.kind === 'file'
    ? { action: 'collect' }
    : { action: 'skip', reason: 'unsupported-entry' };
};

interface SubmodulePathSnapshot {
  readonly paths: ReadonlySet<string>;
  readonly readable: boolean;
}

const readSubmodulePaths = (root: string): SubmodulePathSnapshot => {
  const gitmodulesPath = join(root, '.gitmodules');
  let metadataStats: ReturnType<typeof lstatSync>;
  try {
    metadataStats = lstatSync(gitmodulesPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { paths: new Set(), readable: true }
      : { paths: new Set(), readable: false };
  }
  if (!metadataStats.isFile()) {
    return { paths: new Set(), readable: false };
  }

  let source: string;
  try {
    source = readFileSync(gitmodulesPath, 'utf8');
  } catch {
    return { paths: new Set(), readable: false };
  }
  const parsed = spawnSync(
    'git',
    ['config', '--file', '-', '--null', '--get-regexp', '^submodule\\.'],
    { encoding: 'utf8', input: source }
  );
  if (parsed.status === 1) {
    const hasOnlyComments = source
      .split(/\r?\n/)
      .every((line) => !line.trim() || /^[#;]/.test(line.trim()));
    return {
      paths: new Set(),
      readable: hasOnlyComments,
    };
  }
  if (parsed.status !== 0) {
    return { paths: new Set(), readable: false };
  }

  const paths = new Set<string>();
  const owners = new Set<string>();
  const ownersWithPaths = new Set<string>();
  const authoredSubmodules = new Set(
    [
      ...source.matchAll(
        /^\s*\[\s*submodule(?:\s+"((?:[^"\\]|\\.)*)"|\.([^\]]+?))\s*\]/gim
      ),
    ].map((match) => match[1] ?? match[2]?.trim())
  );
  for (const record of parsed.stdout.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\n');
    if (separator === -1) {
      return { paths: new Set(), readable: false };
    }
    const key = record.slice(0, separator);
    const fieldSeparator = key.lastIndexOf('.');
    if (fieldSeparator <= 'submodule.'.length) {
      return { paths: new Set(), readable: false };
    }
    const owner = key.slice('submodule.'.length, fieldSeparator);
    owners.add(owner);
    if (key.slice(fieldSeparator + 1).toLowerCase() !== 'path') {
      continue;
    }
    const value = record.slice(separator + 1);
    if (!value) {
      return { paths: new Set(), readable: false };
    }
    ownersWithPaths.add(owner);
    paths.add(posix.normalize(value.replaceAll('\\', '/')).replace(/\/+$/, ''));
  }
  return owners.size === ownersWithPaths.size &&
    authoredSubmodules.size === ownersWithPaths.size
    ? { paths, readable: true }
    : { paths: new Set(), readable: false };
};

const boundaryReason = (
  absoluteDirectory: string,
  path: string,
  submodules: SubmodulePathSnapshot
): SourceCollectionBoundaryReason | 'unreadable-git-boundary' | undefined => {
  if (!submodules.readable) {
    return 'unreadable-git-boundary';
  }
  if (submodules.paths.has(path)) {
    return 'submodule-boundary';
  }

  const marker = join(absoluteDirectory, '.git');
  let markerStats: ReturnType<typeof lstatSync>;
  try {
    markerStats = lstatSync(marker);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? undefined
      : 'unreadable-git-boundary';
  }

  try {
    if (markerStats.isDirectory()) {
      return statSync(join(marker, 'HEAD')).isFile() &&
        statSync(join(marker, 'objects')).isDirectory()
        ? 'nested-repository'
        : 'unreadable-git-boundary';
    }
    if (!markerStats.isFile()) {
      return 'unreadable-git-boundary';
    }

    const pointer = readFileSync(marker, 'utf8').match(/^gitdir:\s*(.+?)\s*$/);
    const gitDirectory = pointer?.[1];
    if (!gitDirectory) {
      return 'unreadable-git-boundary';
    }
    const resolvedGitDirectory = resolve(absoluteDirectory, gitDirectory);
    return statSync(resolvedGitDirectory).isDirectory() &&
      statSync(join(resolvedGitDirectory, 'HEAD')).isFile()
      ? 'nested-worktree'
      : 'unreadable-git-boundary';
  } catch {
    return 'unreadable-git-boundary';
  }
};

const comparePath = (
  left: { readonly path: string },
  right: {
    readonly path: string;
  }
): number => {
  if (left.path < right.path) {
    return -1;
  }
  return left.path > right.path ? 1 : 0;
};

/**
 * Collect files from exactly one working tree, pruning nested Git observations.
 *
 * Git boundaries take precedence over consumer policy so a tool cannot scan a
 * nested checkout and hide that fact behind an authored exclude. The supplied
 * root remains first-class: only directories encountered beneath it are
 * classified as boundaries.
 *
 * @example
 * ```ts
 * const result = collectSourceTree(process.cwd(), {
 *   classify: (entry) =>
 *     entry.kind === 'file' && entry.path.endsWith('.ts')
 *       ? { action: 'collect' }
 *       : entry.kind === 'directory'
 *         ? { action: 'recurse' }
 *         : { action: 'skip', reason: 'unsupported-extension' },
 * });
 * ```
 */
export const collectSourceTree = (
  root: string,
  options: CollectSourceTreeOptions = {}
): SourceTreeCollection | null => {
  const absoluteRoot = resolve(root);
  let rootEntries: readonly Dirent<string>[];
  try {
    rootEntries = readdirSync(absoluteRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const classify = options.classify ?? defaultDecision;
  const submodules = readSubmodulePaths(absoluteRoot);
  const files: CollectedSourceFile[] = [];
  const skipped: SkippedSourceEntry[] = submodules.readable
    ? []
    : [{ path: '.gitmodules', reason: 'unreadable-git-metadata' }];
  const queue: {
    readonly absolutePath: string;
    readonly entries?: readonly Dirent<string>[];
  }[] = [{ absolutePath: absoluteRoot, entries: rootEntries }];

  while (queue.length > 0) {
    const current = queue.shift() as (typeof queue)[number];
    let { entries } = current;
    if (!entries) {
      try {
        entries = readdirSync(current.absolutePath, { withFileTypes: true });
      } catch {
        skipped.push({
          path: toPosixRelative(absoluteRoot, current.absolutePath),
          reason: 'unreadable-directory',
        });
        continue;
      }
    }

    for (const entry of entries) {
      const absolutePath = join(current.absolutePath, entry.name);
      const path = toPosixRelative(absoluteRoot, absolutePath);
      const kind = entryKind(entry);
      if (path === '.gitmodules' && !submodules.readable) {
        continue;
      }
      if (kind === 'directory') {
        const reason = boundaryReason(absolutePath, path, submodules);
        if (reason) {
          skipped.push({ path, reason });
          continue;
        }
      }
      if (entry.name === '.git') {
        skipped.push({ path, reason: 'ignored-directory' });
        continue;
      }

      const decision = classify({ kind, name: entry.name, path });
      if (decision.action === 'collect') {
        files.push({ absolutePath, path });
      } else if (decision.action === 'recurse') {
        queue.push({ absolutePath });
      } else {
        skipped.push({ path, reason: decision.reason });
      }
    }
  }

  files.sort(comparePath);
  skipped.sort(comparePath);
  return { files, root: absoluteRoot, skipped };
};
