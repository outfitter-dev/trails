import {
  NotFoundError,
  Result,
  matchesAnyPathGlob,
  trail,
} from '@ontrails/core';
import { readdirSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

/**
 * Downstream source collection (TRL-844).
 *
 * Walks an explicit downstream-repo root and collects the deterministic set of
 * candidate source files a regrade may operate on, alongside the entries it
 * skipped and why. This is the engine substrate for the downstream Regrade
 * work; it has no public CLI and reads only the root it is given.
 *
 * The interesting decision logic — which entries are collected, recursed into,
 * or skipped with a reason — lives in the pure {@link classifyDownstreamEntry}
 * helper so it can be exercised without touching the filesystem.
 */

/** Directory names never descended into during collection. */
export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = Object.freeze([
  '.git',
  '.turbo',
  '.trails',
  'dist',
  'node_modules',
]);

/** Source file extensions collected by default. */
export const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
  '.ts',
  '.tsx',
]);

/** Kind of a raw directory entry as reported by the filesystem walk. */
export type DownstreamEntryKind = 'directory' | 'file' | 'other';

/** A collected candidate source file. */
export interface CollectedSource {
  /** Root-relative POSIX path, used as the stable identity for the entry. */
  readonly path: string;
  /** Absolute path on disk. */
  readonly absolutePath: string;
}

/** An entry that was inspected but not collected, with a machine-readable reason. */
export interface SkippedSource {
  /** Root-relative POSIX path of the skipped entry. */
  readonly path: string;
  /** Why the entry was skipped, e.g. `ignored-directory`. */
  readonly reason: string;
}

/** Deterministic result of collecting downstream sources from a root. */
export interface DownstreamSourceCollection {
  /** The root the collection ran against. */
  readonly root: string;
  /** Collected candidate source files, sorted by `path`. */
  readonly files: readonly CollectedSource[];
  /** Skipped entries with reasons, sorted by `path`. */
  readonly skipped: readonly SkippedSource[];
}

/** Options shared by the classifier and the filesystem walk. */
export interface DownstreamCollectionOptions {
  /** Directory names to skip. Defaults to {@link DEFAULT_IGNORED_DIRECTORIES}. */
  readonly ignoredDirectories?: readonly string[];
  /** Source extensions to collect. Defaults to {@link DEFAULT_SOURCE_EXTENSIONS}. */
  readonly extensions?: readonly string[];
  /** Root-relative path globs to skip before collection. */
  readonly exclude?: readonly string[];
}

/** Outcome of classifying a single directory entry. */
export type DownstreamEntryClassification =
  | { readonly action: 'collect' }
  | { readonly action: 'recurse' }
  | { readonly action: 'skip'; readonly reason: string };

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
};

const normalizeExtension = (extension: string): string =>
  extension === '' || extension.startsWith('.') ? extension : `.${extension}`;

const collectionExtensions = (
  extensions: readonly string[] | undefined
): readonly string[] =>
  extensions === undefined
    ? DEFAULT_SOURCE_EXTENSIONS
    : extensions.map(normalizeExtension);

/**
 * Decide what to do with a single directory entry. Pure: no filesystem access,
 * so collection policy can be tested directly with synthetic entries.
 */
export const classifyDownstreamEntry = (
  name: string,
  kind: DownstreamEntryKind,
  options: DownstreamCollectionOptions = {}
): DownstreamEntryClassification => {
  const ignoredDirectories =
    options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;
  const extensions = collectionExtensions(options.extensions);

  if (kind === 'directory') {
    return ignoredDirectories.includes(name)
      ? { action: 'skip', reason: 'ignored-directory' }
      : { action: 'recurse' };
  }
  if (kind === 'other') {
    return { action: 'skip', reason: 'unsupported-entry' };
  }
  return extensions.length === 0 || extensions.includes(extensionOf(name))
    ? { action: 'collect' }
    : { action: 'skip', reason: 'unsupported-extension' };
};

const toPosixRelative = (root: string, absolutePath: string): string => {
  const rel = relative(root, absolutePath);
  return sep === posix.sep ? rel : rel.split(sep).join(posix.sep);
};

const direntKind = (dirent: {
  isDirectory(): boolean;
  isFile(): boolean;
}): DownstreamEntryKind => {
  if (dirent.isDirectory()) {
    return 'directory';
  }
  return dirent.isFile() ? 'file' : 'other';
};

type DirectoryRead =
  | {
      readonly ok: true;
      readonly entries: readonly {
        readonly name: string;
        readonly kind: DownstreamEntryKind;
      }[];
    }
  | { readonly ok: false };

const readDirectory = (absoluteDir: string): DirectoryRead => {
  try {
    const entries = readdirSync(absoluteDir, { withFileTypes: true }).map(
      (dirent) => ({ kind: direntKind(dirent), name: dirent.name })
    );
    return { entries, ok: true };
  } catch {
    return { ok: false };
  }
};

/**
 * Walk an explicit downstream root and collect candidate source files.
 *
 * Never throws: an unreadable root yields `null` (the trail maps that to a
 * `NotFoundError`), and unreadable subdirectories are recorded as skipped
 * entries. Output is deterministic — files and skipped entries are sorted by
 * their root-relative POSIX path.
 */
export const collectDownstreamSources = (
  root: string,
  options: DownstreamCollectionOptions = {}
): DownstreamSourceCollection | null => {
  const absoluteRoot = resolve(root);
  const rootRead = readDirectory(absoluteRoot);
  if (!rootRead.ok) {
    return null;
  }

  const files: CollectedSource[] = [];
  const skipped: SkippedSource[] = [];
  const queue: string[] = [absoluteRoot];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const read = current === absoluteRoot ? rootRead : readDirectory(current);
    if (!read.ok) {
      skipped.push({
        path: toPosixRelative(absoluteRoot, current),
        reason: 'unreadable-directory',
      });
      continue;
    }

    for (const entry of read.entries) {
      const absolutePath = join(current, entry.name);
      const path = toPosixRelative(absoluteRoot, absolutePath);
      if (matchesAnyPathGlob(path, options.exclude)) {
        skipped.push({ path, reason: 'ignored-glob' });
        continue;
      }
      const classification = classifyDownstreamEntry(
        entry.name,
        entry.kind,
        options
      );
      if (classification.action === 'collect') {
        files.push({ absolutePath, path });
      } else if (classification.action === 'recurse') {
        queue.push(absolutePath);
      } else {
        skipped.push({ path, reason: classification.reason });
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { files, root: absoluteRoot, skipped };
};

export const collectDownstreamSourcesInput = z.object({
  exclude: z
    .array(z.string())
    .optional()
    .describe('Root-relative path globs to skip before collection'),
  extensions: z
    .array(z.string())
    .optional()
    .describe('Source file extensions to collect (defaults to .ts and .tsx)'),
  ignoredDirectories: z
    .array(z.string())
    .optional()
    .describe('Directory names to skip during collection'),
  root: z
    .string()
    .describe('Absolute path to the downstream repo root to scan'),
});

export const collectDownstreamSourcesOutput = z.object({
  files: z
    .array(
      z.object({
        absolutePath: z.string().describe('Absolute path on disk'),
        path: z.string().describe('Root-relative POSIX path'),
      })
    )
    .describe('Collected candidate source files, sorted by path'),
  root: z.string().describe('Root the collection ran against'),
  skipped: z
    .array(
      z.object({
        path: z.string().describe('Root-relative POSIX path'),
        reason: z.string().describe('Why the entry was skipped'),
      })
    )
    .describe('Skipped entries with reasons, sorted by path'),
});

/**
 * Engine trail that collects downstream source files from an explicit root.
 *
 * No examples are authored: the input is an absolute filesystem path, which
 * cannot be encoded as a portable literal. Correctness is proven by the
 * collector unit tests (synthetic classifier cases and temp-directory walks)
 * and, from TRL-846, the committed Radio-shaped fixture.
 */
export const collectDownstreamSourcesTrail = trail(
  'regrade.downstream.collect',
  {
    blaze: (input) => {
      const collection = collectDownstreamSources(input.root, {
        ...(input.extensions === undefined
          ? {}
          : { extensions: input.extensions }),
        ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
        ...(input.ignoredDirectories === undefined
          ? {}
          : { ignoredDirectories: input.ignoredDirectories }),
      });
      if (collection === null) {
        return Result.err(
          new NotFoundError(
            `Downstream root "${input.root}" could not be read as a directory.`
          )
        );
      }
      return Result.ok(collection);
    },
    input: collectDownstreamSourcesInput,
    intent: 'read',
    output: collectDownstreamSourcesOutput,
  }
);
