import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { isPlainObject } from '@ontrails/core';

import { compareSemver, parseSemver } from './semver.js';
import { isInitialZeroLineSourceTransition } from './zero-line-transition.js';

/** Verify stable version metadata against the base instead of trusting filenames. */
export const classifyStableWorkspaceVersionChange = (
  repoRoot: string,
  baseRef: string | undefined,
  workspacePath: string,
  changedFiles: readonly string[]
): 'increase' | 'initial-zero-line' | undefined => {
  const manifestPath = `${workspacePath}/package.json`;
  const changelogPath = `${workspacePath}/CHANGELOG.md`;
  if (
    baseRef === undefined ||
    !changedFiles.includes(manifestPath) ||
    !changedFiles.includes(changelogPath)
  ) {
    return undefined;
  }

  const base = Bun.spawnSync(['git', 'show', `${baseRef}:${manifestPath}`], {
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (base.exitCode !== 0) {
    return undefined;
  }

  try {
    const previous: unknown = JSON.parse(base.stdout.toString());
    const current: unknown = JSON.parse(
      readFileSync(join(repoRoot, manifestPath), 'utf8')
    );
    if (!isPlainObject(previous) || !isPlainObject(current)) {
      return undefined;
    }
    const { version: previousVersion, ...previousContent } = previous;
    const { version: currentVersion, ...currentContent } = current;
    if (
      typeof previousVersion !== 'string' ||
      typeof currentVersion !== 'string'
    ) {
      return undefined;
    }
    const parsed = parseSemver(currentVersion);
    if (
      parseSemver(previousVersion) === undefined ||
      parsed === undefined ||
      parsed.prerelease !== undefined ||
      !isDeepStrictEqual(previousContent, currentContent) ||
      !readFileSync(join(repoRoot, changelogPath), 'utf8')
        .split(/\r?\n/u)
        .includes(`## ${currentVersion}`)
    ) {
      return undefined;
    }

    if (compareSemver(currentVersion, previousVersion) > 0) {
      return 'increase';
    }

    return isInitialZeroLineSourceTransition(
      previousVersion,
      currentVersion,
      typeof current['name'] === 'string' ? current['name'] : undefined
    )
      ? 'initial-zero-line'
      : undefined;
  } catch {
    // Missing or malformed metadata cannot establish the release-intent exemption.
    return undefined;
  }
};
