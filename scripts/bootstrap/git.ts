import { has, run } from './shared.js';

export interface WorktreeInfo {
  readonly branch: string | undefined;
  readonly commonDir: string | undefined;
  readonly gitDir: string | undefined;
  readonly linked: boolean;
}

export const isLinkedWorktree = (
  gitDir: string | undefined,
  commonDir: string | undefined
): boolean =>
  gitDir !== undefined &&
  commonDir !== undefined &&
  gitDir.length > 0 &&
  commonDir.length > 0 &&
  gitDir !== commonDir;

export const readWorktreeInfo = (repoRoot: string): WorktreeInfo => {
  const gitDir = run(['git', 'rev-parse', '--git-dir'], repoRoot);
  const commonDir = run(['git', 'rev-parse', '--git-common-dir'], repoRoot);
  const branch = run(['git', 'branch', '--show-current'], repoRoot);
  const resolvedGitDir =
    gitDir.exitCode === 0 ? gitDir.stdout.trim() : undefined;
  const resolvedCommonDir =
    commonDir.exitCode === 0 ? commonDir.stdout.trim() : undefined;

  return {
    branch: branch.exitCode === 0 ? branch.stdout.trim() : undefined,
    commonDir: resolvedCommonDir,
    gitDir: resolvedGitDir,
    linked: isLinkedWorktree(resolvedGitDir, resolvedCommonDir),
  };
};

export const printAgentGitDiagnostics = (
  repoRoot: string,
  maxGraphiteLines: number
): void => {
  const info = readWorktreeInfo(repoRoot);
  if (!info.linked) {
    return;
  }

  console.error('');
  console.error('Linked worktree detected');
  console.error(
    `  branch: ${info.branch && info.branch.length > 0 ? info.branch : 'detached HEAD'}`
  );
  if (info.branch === undefined || info.branch.length === 0) {
    console.error(
      '  Graphite can inspect here, but gt create requires a real checked-out branch.'
    );
  }
  console.error(
    '  Graphite branches and metadata are shared with the main checkout.'
  );
  console.error(
    '  Lifecycle hooks must not run gt sync/restack/submit or branch deletion commands.'
  );

  if (!has('gt')) {
    console.error('  gt: missing (Graphite stack inspection disabled)');
    return;
  }

  const log = run(['gt', 'log', '--no-interactive'], repoRoot);
  if (log.exitCode !== 0) {
    console.error('  gt log unavailable');
    return;
  }

  console.error('');
  console.error(`Graphite stack (first ${String(maxGraphiteLines)} lines)`);
  for (const line of log.stdout.split('\n').slice(0, maxGraphiteLines)) {
    if (line.length > 0) {
      console.error(line);
    }
  }
};
