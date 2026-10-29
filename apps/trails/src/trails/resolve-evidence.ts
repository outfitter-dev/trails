import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { Result, ValidationError } from '@ontrails/core';
import { deriveTopoGraphHash, trailsLockSchema } from '@ontrails/topography';
import type { TrailsLock } from '@ontrails/topography';

/** Provenance for one verified lock supplied to the recovery derivation. */
export type ResolveLockEvidenceSource = 'ours' | 'theirs' | 'base' | 'worktree';

/** Verified lock inputs and the exact selected artifact bytes read during preflight. */
export interface ResolveLockEvidence {
  readonly originalContent: string;
  readonly parents: readonly TrailsLock[];
  readonly sources: readonly ResolveLockEvidenceSource[];
  readonly worktreeLock?: TrailsLock | undefined;
}

interface GitResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface GitStage {
  readonly stage: number;
  readonly path: string;
}

const gitEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('GIT_')
    )
  );

const runGit = (root: string, args: readonly string[]): GitResult => {
  const process = Bun.spawnSync(['git', '-C', root, ...args], {
    env: gitEnvironment(),
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    exitCode: process.exitCode,
    stderr: Buffer.from(process.stderr).toString('utf8'),
    stdout: Buffer.from(process.stdout).toString('utf8'),
  };
};

const validationFailure = (
  message: string,
  context: Record<string, unknown>
): Result<never, Error> =>
  Result.err(new ValidationError(message, { context }));

const parseLock = (
  content: string,
  source: ResolveLockEvidenceSource,
  lockPath: string
): Result<TrailsLock, Error> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return validationFailure(
      `The ${source} trails.lock evidence is not valid JSON. Resolve authored source conflicts first, then retry trails resolve.`,
      { lockPath, source }
    );
  }
  const validated = trailsLockSchema.safeParse(parsed);
  if (!validated.success) {
    return validationFailure(
      `The ${source} trails.lock evidence does not match the supported lock schema. Restore the generated lock from Git or recompile that parent before retrying trails resolve.`,
      { lockPath, source }
    );
  }
  const lock = validated.data as TrailsLock;
  const actualHash = deriveTopoGraphHash(lock.topoGraph);
  if (actualHash !== lock.topoGraphHash) {
    return validationFailure(
      `The ${source} trails.lock evidence failed its topo graph integrity check. Restore an untampered generated lock before retrying trails resolve.`,
      { actualHash, lockPath, source, storedHash: lock.topoGraphHash }
    );
  }
  return Result.ok(lock);
};

const parseUnmergedStages = (output: string): readonly GitStage[] =>
  output
    .split('\0')
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const separator = record.indexOf('\t');
      const match = /^\d+ [0-9a-f]+ ([123])$/u.exec(record.slice(0, separator));
      return match === null
        ? []
        : [{ path: record.slice(separator + 1), stage: Number(match[1]) }];
    });

const repositoryRootFor = (lockPath: string): string | undefined => {
  const result = runGit(dirname(lockPath), ['rev-parse', '--show-toplevel']);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
};

const isInside = (root: string, path: string): boolean => {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  );
};

const unresolvedAuthoredPaths = (
  root: string
): Result<readonly string[], Error> => {
  const listed = runGit(root, ['ls-files', '-u', '-z']);
  if (listed.exitCode !== 0) {
    return validationFailure('Unable to inspect unresolved Git paths.', {
      root,
      stderr: listed.stderr.trim(),
    });
  }
  const paths = new Set(
    parseUnmergedStages(listed.stdout)
      .map((entry) => entry.path)
      .filter(
        (path) => !path.endsWith('/trails.lock') && path !== 'trails.lock'
      )
  );
  return Result.ok([...paths].toSorted());
};

const readStage = (
  root: string,
  relativeLockPath: string,
  stage: 1 | 2 | 3,
  source: ResolveLockEvidenceSource,
  lockPath: string
): Result<{ readonly content: string; readonly lock: TrailsLock }, Error> => {
  const shown = runGit(root, ['show', `:${stage}:${relativeLockPath}`]);
  if (shown.exitCode !== 0) {
    return validationFailure(
      `Git is missing the ${source} trails.lock stage. Restore both parent stages before retrying trails resolve.`,
      { lockPath, source, stderr: shown.stderr.trim() }
    );
  }
  const parsed = parseLock(shown.stdout, source, lockPath);
  return parsed.isErr()
    ? parsed
    : Result.ok({ content: shown.stdout, lock: parsed.value });
};

const readUnmergedEvidence = (
  root: string,
  relativeLockPath: string,
  lockPath: string,
  originalContent: string,
  stages: readonly GitStage[]
): Result<ResolveLockEvidence, Error> => {
  const stageNumbers = new Set(stages.map((entry) => entry.stage));
  if (!stageNumbers.has(2) || !stageNumbers.has(3)) {
    return validationFailure(
      'The selected trails.lock conflict is missing an ours or theirs Git stage. Restore both parent stages before retrying trails resolve.',
      { lockPath, stages: [...stageNumbers].toSorted() }
    );
  }
  const requested = [
    [2, 'ours'],
    [3, 'theirs'],
    ...(stageNumbers.has(1) ? ([[1, 'base']] as const) : []),
  ] as const;
  const parents: TrailsLock[] = [];
  const sources: ResolveLockEvidenceSource[] = [];
  const contents = new Set<string>();
  for (const [stage, source] of requested) {
    const evidence = readStage(root, relativeLockPath, stage, source, lockPath);
    if (evidence.isErr()) {
      return evidence;
    }
    parents.push(evidence.value.lock);
    sources.push(source);
    contents.add(evidence.value.content);
  }
  const worktree = parseLock(originalContent, 'worktree', lockPath);
  if (worktree.isOk() && !contents.has(originalContent)) {
    parents.push(worktree.value);
    sources.push('worktree');
  }
  return Result.ok({
    originalContent,
    parents,
    sources,
    ...(worktree.isOk() ? { worktreeLock: worktree.value } : {}),
  });
};

/**
 * Read verified lock evidence from an explicit artifact path without mutating
 * the worktree or Git index.
 *
 * A clean lock contributes its worktree artifact. An unmerged lock contributes
 * Git stages in deterministic ours, theirs, base order, plus a distinct valid
 * worktree artifact when one exists.
 */
export const readResolveLockEvidence = async (
  lockPath: string
): Promise<Result<ResolveLockEvidence, Error>> => {
  if (!isAbsolute(lockPath)) {
    return validationFailure(
      'trails resolve requires an absolute selected trails.lock path.',
      { lockPath }
    );
  }
  const selectedPath = resolve(lockPath);
  const selectedStats = lstatSync(selectedPath, { throwIfNoEntry: false });
  if (selectedStats === undefined) {
    return validationFailure(
      'The selected trails.lock does not exist. Compile the selected app before retrying trails resolve.',
      { lockPath: selectedPath }
    );
  }
  if (selectedStats.isSymbolicLink()) {
    return validationFailure(
      'The selected trails.lock is a symbolic link. Restore a regular generated lock at the selected app root before retrying trails resolve.',
      { lockPath: selectedPath }
    );
  }
  if (!selectedStats.isFile()) {
    return validationFailure(
      'The selected trails.lock is not a regular file. Restore a regular generated lock at the selected app root before retrying trails resolve.',
      { lockPath: selectedPath }
    );
  }
  const file = Bun.file(selectedPath);
  const originalContent = await file.text();
  const root = repositoryRootFor(selectedPath);
  if (root === undefined) {
    const parsed = parseLock(originalContent, 'worktree', selectedPath);
    return parsed.isErr()
      ? parsed
      : Result.ok({
          originalContent,
          parents: [parsed.value],
          sources: ['worktree'],
          worktreeLock: parsed.value,
        });
  }
  const canonicalRoot = realpathSync(root);
  const canonicalLockPath = realpathSync(selectedPath);
  if (!isInside(canonicalRoot, canonicalLockPath)) {
    return validationFailure(
      'The selected trails.lock resolves outside its Git worktree.',
      { lockPath: selectedPath, root: canonicalRoot }
    );
  }
  const authoredConflicts = unresolvedAuthoredPaths(canonicalRoot);
  if (authoredConflicts.isErr()) {
    return authoredConflicts;
  }
  if (authoredConflicts.value.length > 0) {
    return validationFailure(
      'Resolve authored source conflicts before running trails resolve.',
      { paths: authoredConflicts.value, root: canonicalRoot }
    );
  }
  const relativeLockPath = relative(canonicalRoot, canonicalLockPath);
  const listed = runGit(canonicalRoot, [
    'ls-files',
    '-u',
    '-z',
    '--',
    relativeLockPath,
  ]);
  if (listed.exitCode !== 0) {
    return validationFailure(
      'Unable to inspect the selected Git lock stages.',
      {
        lockPath: selectedPath,
        stderr: listed.stderr.trim(),
      }
    );
  }
  const stages = parseUnmergedStages(listed.stdout);
  if (stages.length > 0) {
    return readUnmergedEvidence(
      canonicalRoot,
      relativeLockPath,
      selectedPath,
      originalContent,
      stages
    );
  }
  const parsed = parseLock(originalContent, 'worktree', selectedPath);
  return parsed.isErr()
    ? parsed
    : Result.ok({
        originalContent,
        parents: [parsed.value],
        sources: ['worktree'],
        worktreeLock: parsed.value,
      });
};
