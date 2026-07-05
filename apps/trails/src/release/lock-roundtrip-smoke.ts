/**
 * Lock round-trip invariant (TRL-1200).
 *
 * For every committed `trails.lock` in the repo, a fresh `trails compile`
 * against a cold per-user store followed by `trails validate` must be
 * green, and the recompiled lock must be byte-identical to the committed
 * one. Evidence the toolchain cannot reproduce does not merge.
 *
 * Failures name the divergence and the command that fixes it. Hand-editing
 * a lock is never the remediation.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const trailsBinFor = (repoRoot: string): string =>
  join(repoRoot, 'apps/trails/bin/trails.ts');

export interface LockRoundtripSmokeResult {
  readonly check: 'lock-roundtrip';
  readonly lockCount: number;
  readonly message: string;
  readonly passed: true;
}

export interface LockRoundtripSmokeOptions {
  /** Override lock discovery with explicit repo-relative lock paths. */
  readonly lockPaths?: readonly string[];
  readonly repoRoot?: string;
}

const discoverCommittedLocks = (repoRoot: string): readonly string[] => {
  const result = Bun.spawnSync({
    cmd: ['git', 'ls-files', '--', 'trails.lock', '*/trails.lock'],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `lock-roundtrip: git ls-files failed: ${result.stderr.toString()}`
    );
  }
  return result.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const resolveAppModule = (appDir: string): string => {
  if (existsSync(join(appDir, 'src', 'app.ts'))) {
    return './src/app.ts';
  }
  const packageJsonPath = join(appDir, 'package.json');
  if (existsSync(packageJsonPath)) {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      readonly main?: unknown;
    };
    if (typeof parsed.main === 'string') {
      return parsed.main;
    }
  }
  throw new Error(
    `lock-roundtrip: unable to resolve the app module for "${appDir}" — expected src/app.ts or a package.json "main" entry.`
  );
};

const runTrailsCommand = (
  repoRoot: string,
  stateHome: string,
  args: readonly string[]
): { readonly exitCode: number; readonly output: string } => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, trailsBinFor(repoRoot), ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      NO_COLOR: '1',
      TRAILS_STATE_HOME: stateHome,
      XDG_STATE_HOME: stateHome,
    } as Record<string, string | undefined>,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

const summarizeEntryIds = (value: unknown): readonly string[] => {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const { topoGraph } = value as {
    readonly topoGraph?: { readonly entries?: readonly { id?: string }[] };
  };
  return (topoGraph?.entries ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string');
};

/** Name what diverged between the committed and recompiled lock bytes. */
const describeLockDivergence = (
  committed: string,
  recompiled: string
): readonly string[] => {
  const details: string[] = [];
  let committedParsed: unknown;
  let recompiledParsed: unknown;
  try {
    committedParsed = JSON.parse(committed);
    recompiledParsed = JSON.parse(recompiled);
  } catch {
    return ['committed lock is not valid JSON'];
  }
  const committedLock = committedParsed as Record<string, unknown>;
  const recompiledLock = recompiledParsed as Record<string, unknown>;

  for (const section of ['scope', 'summary', 'topoGraphHash', 'version']) {
    const left = JSON.stringify(committedLock[section]);
    const right = JSON.stringify(recompiledLock[section]);
    if (left !== right) {
      details.push(`${section}: committed ${left} vs recompiled ${right}`);
    }
  }

  const committedIds = new Set(summarizeEntryIds(committedParsed));
  const recompiledIds = new Set(summarizeEntryIds(recompiledParsed));
  const missing = [...committedIds].filter((id) => !recompiledIds.has(id));
  const added = [...recompiledIds].filter((id) => !committedIds.has(id));
  if (missing.length > 0) {
    details.push(`entries only in committed lock: ${missing.join(', ')}`);
  }
  if (added.length > 0) {
    details.push(`entries only in recompiled lock: ${added.join(', ')}`);
  }
  if (details.length === 0) {
    details.push('topoGraph entry content differs (same ids, different facts)');
  }
  return details;
};

const checkSingleLock = async (
  repoRoot: string,
  lockPath: string
): Promise<void> => {
  const absoluteLockPath = resolve(repoRoot, lockPath);
  const appDir = dirname(absoluteLockPath);
  const relativeAppDir = relative(repoRoot, appDir) || '.';
  const appModule = resolveAppModule(appDir);
  const committedBytes = readFileSync(absoluteLockPath, 'utf8');
  const stateHome = await mkdtemp(join(tmpdir(), 'lock-roundtrip-'));
  const fixCommand = `bun apps/trails/bin/trails.ts compile --module ${appModule} --root-dir ${relativeAppDir} --permit '{"id":"lock-refresh","scopes":["topo:write"]}'`;
  const remediation = `Fix: run \`${fixCommand}\` and commit the refreshed trails.lock. Never hand-edit the lock.`;

  try {
    const compileResult = runTrailsCommand(repoRoot, stateHome, [
      'compile',
      '--module',
      appModule,
      '--root-dir',
      relativeAppDir,
      '--permit',
      '{"id":"lock-roundtrip-gate","scopes":["topo:write"]}',
      '--json',
    ]);
    if (compileResult.exitCode !== 0) {
      throw new Error(
        `lock-roundtrip: cold compile failed for ${lockPath}.\n${compileResult.output}\n${remediation}`
      );
    }

    const validateResult = runTrailsCommand(repoRoot, stateHome, [
      'validate',
      '--module',
      appModule,
      '--root-dir',
      relativeAppDir,
      '--json',
    ]);
    if (validateResult.exitCode !== 0) {
      throw new Error(
        `lock-roundtrip: validate failed for ${lockPath} after a cold recompile.\n${validateResult.output}\n${remediation}`
      );
    }

    const recompiledBytes = readFileSync(absoluteLockPath, 'utf8');
    if (recompiledBytes !== committedBytes) {
      const details = describeLockDivergence(committedBytes, recompiledBytes);
      throw new Error(
        [
          `lock-roundtrip: ${lockPath} is not byte-identical after a cold recompile.`,
          ...details.map((detail) => `  - ${detail}`),
          remediation,
        ].join('\n')
      );
    }
  } finally {
    // The gate is read-only: always restore the committed bytes.
    writeFileSync(absoluteLockPath, committedBytes);
    await rm(stateHome, { force: true, recursive: true });
  }
};

export const runLockRoundtripSmoke = async (
  options?: LockRoundtripSmokeOptions
): Promise<LockRoundtripSmokeResult> => {
  const repoRoot = resolve(options?.repoRoot ?? process.cwd());
  const lockPaths = options?.lockPaths ?? discoverCommittedLocks(repoRoot);

  for (const lockPath of lockPaths) {
    await checkSingleLock(repoRoot, lockPath);
  }

  const message =
    lockPaths.length === 0
      ? 'lock-roundtrip: no committed trails.lock files found — nothing to verify'
      : `lock-roundtrip: ${lockPaths.length} committed trails.lock file(s) recompiled cold — validate green, byte-identical (${lockPaths.join(', ')})`;

  return {
    check: 'lock-roundtrip',
    lockCount: lockPaths.length,
    message,
    passed: true,
  };
};
