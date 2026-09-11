import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { isPlainObject } from '@ontrails/core';

import { compareSemver, parseSemver } from './semver.js';

/** Verify stable version metadata against the base instead of trusting filenames. */
export const isStableWorkspaceVersionChange = (
  repoRoot: string,
  baseRef: string | undefined,
  workspacePath: string,
  changedFiles: readonly string[]
): boolean => {
  const manifestPath = `${workspacePath}/package.json`;
  const changelogPath = `${workspacePath}/CHANGELOG.md`;
  if (
    baseRef === undefined ||
    !changedFiles.includes(manifestPath) ||
    !changedFiles.includes(changelogPath)
  ) {
    return false;
  }

  const base = Bun.spawnSync(['git', 'show', `${baseRef}:${manifestPath}`], {
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (base.exitCode !== 0) {
    return false;
  }

  try {
    const previous: unknown = JSON.parse(base.stdout.toString());
    const current: unknown = JSON.parse(
      readFileSync(join(repoRoot, manifestPath), 'utf8')
    );
    if (!isPlainObject(previous) || !isPlainObject(current)) {
      return false;
    }
    const { version: previousVersion, ...previousContent } = previous;
    const { version: currentVersion, ...currentContent } = current;
    if (
      typeof previousVersion !== 'string' ||
      typeof currentVersion !== 'string'
    ) {
      return false;
    }
    const parsed = parseSemver(currentVersion);
    return (
      parseSemver(previousVersion) !== undefined &&
      parsed !== undefined &&
      parsed.prerelease === undefined &&
      compareSemver(currentVersion, previousVersion) > 0 &&
      isDeepStrictEqual(previousContent, currentContent) &&
      readFileSync(join(repoRoot, changelogPath), 'utf8')
        .split(/\r?\n/u)
        .includes(`## ${currentVersion}`)
    );
  } catch {
    // Missing or malformed metadata cannot establish the release-intent exemption.
    return false;
  }
};
