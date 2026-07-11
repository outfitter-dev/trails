import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { auditRoots, changelogHistoryPaths } from '../vocab-cutover-map.js';

const listTrackedChangelogs = (): string[] => {
  const result = Bun.spawnSync(['git', 'ls-files', '*CHANGELOG.md'], {
    cwd: resolve(import.meta.dir, '../..'),
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }

  return result.stdout
    .toString()
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean)
    .filter((path) =>
      auditRoots.some((root) => path === root || path.startsWith(root))
    );
};

describe('vocab cutover map', () => {
  test('classifies every audited package changelog as history', () => {
    const classified = new Set(changelogHistoryPaths);
    const missing = listTrackedChangelogs().filter(
      (path) => !classified.has(path)
    );

    expect(missing).toEqual([]);
  });
});
