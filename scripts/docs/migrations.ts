import { posix } from 'node:path';

import {
  gitOutput,
  readGitChanges,
  readGitFile,
  readGitTree,
  resolveCommit,
  uncommittedPaths,
} from './git.ts';
import type { GitTree } from './git.ts';

export interface MigrationCheck {
  readonly base: string;
  readonly before: string;
  readonly head: string;
  readonly failures: readonly string[];
}

interface MigrationEntry {
  readonly from: string;
  readonly disposition: string;
  readonly to: readonly string[];
  readonly reason?: string;
}

const ledgerPath = 'docs/migration-map.json';
const fixedRoots = new Set(['README.md', 'docs/index.md']);
const regularFile = (mode: string | undefined): boolean =>
  mode === '100644' || mode === '100755';
const markdownPath = (path: string): boolean => /\.mdx?$/i.test(path);
const normalizedPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  markdownPath(value) &&
  !value.includes('\\') &&
  !posix.isAbsolute(value) &&
  posix.normalize(value) === value &&
  !value.split('/').includes('..');

/** This bounded migration population is separate from the later evergreen navigation population. */
const documentationPath = (path: string, tree: GitTree): boolean =>
  path === 'README.md' ||
  (path.startsWith('docs/') &&
    markdownPath(path) &&
    !path.startsWith('docs/adr/')) ||
  tree.workspaces.some((workspace) => path === `${workspace}/README.md`);

const workspaceManifest = (path: string, tree: GitTree): boolean =>
  posix.basename(path) === 'package.json' &&
  tree.workspacePatterns.some((pattern) =>
    new Bun.Glob(pattern).match(posix.dirname(path))
  );

/** Enumerate every removal, including intermediate paths absent from both endpoints. */
const removedInHistory = (
  root: string,
  before: string,
  head: string
): ReadonlySet<string> => {
  const removed = new Set<string>();
  const commits = gitOutput(root, [
    'rev-list',
    '--parents',
    `${before}..${head}`,
  ])
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const record of commits) {
    const [commit, ...parents] = record.split(' ');
    for (const parent of parents) {
      const changes = readGitChanges(root, parent, commit).filter(
        (change) =>
          change.status === 'D' ||
          change.status.startsWith('R') ||
          change.status === 'T'
      );
      if (changes.length === 0) {
        continue;
      }
      const oldTree = readGitTree(root, parent);
      const tree = readGitTree(root, commit);
      for (const change of changes) {
        if (
          (change.status !== 'T' ||
            !regularFile(tree.files.get(change.from))) &&
          regularFile(oldTree.files.get(change.from)) &&
          documentationPath(change.from, oldTree)
        ) {
          removed.add(change.from);
        }
      }
    }
  }
  return removed;
};

const parseLedger = (raw: string): readonly MigrationEntry[] => {
  const data: unknown = JSON.parse(raw);
  if (
    typeof data !== 'object' ||
    data === null ||
    !('version' in data) ||
    data.version !== 1 ||
    !('entries' in data) ||
    !Array.isArray(data.entries)
  ) {
    throw new Error(`${ledgerPath}: expected version 1 and an entries array`);
  }
  const seen = new Set<string>();
  return data.entries.map((value: unknown) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('from' in value) ||
      !normalizedPath(value.from) ||
      !('disposition' in value) ||
      typeof value.disposition !== 'string' ||
      !('to' in value) ||
      !Array.isArray(value.to) ||
      !value.to.every(normalizedPath)
    ) {
      throw new Error(
        `${ledgerPath}: entries need normalized from/to Markdown paths and a disposition`
      );
    }
    if (seen.has(value.from)) {
      throw new Error(`${ledgerPath}: duplicate source ${value.from}`);
    }
    seen.add(value.from);
    const reason =
      'reason' in value && typeof value.reason === 'string'
        ? value.reason
        : undefined;
    const count = value.to.length;
    let valid: boolean;
    if (value.disposition === 'deleted') {
      valid = count === 0 && Boolean(reason?.trim());
    } else if (value.disposition === 'split') {
      valid = count >= 2 && new Set(value.to).size === count;
    } else {
      valid =
        ['moved', 'merged', 'archived'].includes(value.disposition) &&
        count === 1;
    }
    if (!valid) {
      throw new Error(
        `${ledgerPath}: invalid ${value.disposition} intent for ${value.from}; deletion requires a reason`
      );
    }
    return {
      disposition: value.disposition,
      from: value.from,
      reason,
      to: value.to,
    };
  });
};

const readLedger = (root: string, tree: GitTree): readonly MigrationEntry[] =>
  tree.files.has(ledgerPath)
    ? parseLedger(readGitFile(root, tree.commit, ledgerPath))
    : [];

/** Check committed documentation history; relevant uncommitted inputs fail rather than disappearing. */
export const checkDocumentationMigrations = (
  root: string,
  baseRef: string
): MigrationCheck => {
  let base = '';
  let before = '';
  let head = '';
  try {
    base = resolveCommit(root, baseRef);
    head = resolveCommit(root, 'HEAD');
    before = gitOutput(root, ['merge-base', base, head]).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      base,
      before,
      failures: [
        `Documentation base/history check failed: ${message}. Fetch/provide an available base with complete ancestry; this checker does not fetch.`,
      ],
      head,
    };
  }
  try {
    const oldTree = readGitTree(root, before);
    const tree = readGitTree(root, head);
    const dirty = uncommittedPaths(root).filter(
      (path) =>
        path === 'package.json' ||
        path === ledgerPath ||
        workspaceManifest(path, oldTree) ||
        workspaceManifest(path, tree) ||
        documentationPath(path, oldTree) ||
        documentationPath(path, tree)
    );
    if (dirty.length > 0) {
      return {
        base,
        before,
        failures: [
          `uncommitted documentation inputs: ${dirty.toSorted().join(', ')}. Commit them or run focused checks while editing.`,
        ],
        head,
      };
    }
    const entries = readLedger(root, tree);
    const priorSources = new Set(
      readLedger(root, oldTree).map((entry) => entry.from)
    );
    const failures = entries.flatMap((entry) => {
      const problems: string[] = [];
      if (fixedRoots.has(entry.from)) {
        problems.push(
          `${entry.from}: fixed documentation root cannot have a migration entry`
        );
      }
      if (
        documentationPath(entry.from, tree) &&
        regularFile(tree.files.get(entry.from))
      ) {
        problems.push(
          `${entry.from}: migration source remains or was restored as a public Markdown source`
        );
      }
      for (const target of entry.to) {
        if (
          !documentationPath(target, tree) ||
          !regularFile(tree.files.get(target))
        ) {
          problems.push(
            `${entry.from}: successor ${target} is not a surviving public Markdown source at ${head}. Update the entry to a surviving destination.`
          );
        }
      }
      return problems;
    });
    for (const source of priorSources) {
      if (!entries.some((entry) => entry.from === source)) {
        failures.push(
          `${source}: prior migration entry must be retained with current intent and surviving destinations`
        );
      }
    }
    const removed = removedInHistory(root, before, head);
    for (const entry of entries) {
      if (!priorSources.has(entry.from) && !removed.has(entry.from)) {
        failures.push(
          `${entry.from}: new migration entry has no removed public source in this comparison`
        );
      }
    }
    for (const path of removed) {
      if (fixedRoots.has(path)) {
        failures.push(
          `${path}: fixed documentation root cannot be removed through the migration ledger`
        );
      } else if (!entries.some((entry) => entry.from === path)) {
        failures.push(`${path}: missing migration entry in ${ledgerPath}`);
      }
    }
    return { base, before, failures, head };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      base,
      before,
      failures: [`Invalid documentation migration inputs: ${message}`],
      head,
    };
  }
};
