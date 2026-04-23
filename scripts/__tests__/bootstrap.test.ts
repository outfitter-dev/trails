import { expect, test } from 'bun:test';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..');
const bootstrapPath = join(repoRoot, 'scripts/bootstrap.sh');
const packageJsonPath = join(repoRoot, 'package.json');
const packageJson = JSON.parse(await Bun.file(packageJsonPath).text()) as {
  workspaces?: string[];
};
const expectedWorkspaces = Array.isArray(packageJson.workspaces)
  ? packageJson.workspaces
  : [];

test('bootstrap workspace globs stay aligned with root package.json', () => {
  const proc = Bun.spawnSync({
    cmd: ['bash', '-lc', `source "${bootstrapPath}"; list_workspace_globs`],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  expect(proc.exitCode).toBe(0);
  expect(proc.stderr.toString()).toBe('');

  const actual = proc.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  expect(actual).toEqual(expectedWorkspaces);
});
