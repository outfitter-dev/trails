import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, sep } from 'node:path';

const trackedInputPaths = (source: string): Set<string> => {
  const result = Bun.spawnSync({
    cmd: ['git', 'ls-files', '-z'],
    cwd: source,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `lock-roundtrip: unable to list tracked inputs: ${result.stderr.toString()}`
    );
  }
  const paths = new Set<string>();
  for (const file of result.stdout.toString().split('\0').filter(Boolean)) {
    let path = file.split('/').join(sep);
    while (path !== '.') {
      paths.add(path);
      path = dirname(path);
    }
  }
  return paths;
};

const isDisposablePath = (segments: readonly string[]): boolean =>
  segments.some(
    (part, index) =>
      part === '.tmp-tests' ||
      part === '.trails-tmp' ||
      part === '.turbo' ||
      part === '.worktrees' ||
      (part === 'worktrees' && segments[index - 1] === '.claude') ||
      (part === 'notes' && segments[index - 1] === '.agents')
  );

/**
 * Copy current working files for compile/validate without writing to their owner.
 * Workspace dependency links resolve within the copy; only Bun's installed
 * dependency store stays shared. Callers still need a stable tree while copying
 * and must not modify installed dependencies during checks.
 */
export const copyLockRoundtripWorkspace = async (
  source: string,
  destination: string,
  lockPaths: readonly string[]
): Promise<void> => {
  const trackedPaths = trackedInputPaths(source);
  const fixtureRoots = lockPaths
    .filter((path) => isDisposablePath(path.split(sep)))
    .map((path) => dirname(path));
  await cp(source, destination, {
    dereference: true,
    filter: async (path, target) => {
      const name = basename(path);
      const relativePath = relative(source, path);
      const segments = relativePath.split(sep);
      const selectedFixture = fixtureRoots.some(
        (root) =>
          root === relativePath ||
          root.startsWith(`${relativePath}${sep}`) ||
          relativePath.startsWith(`${root}${sep}`)
      );
      if (
        name === '.git' ||
        (isDisposablePath(segments) &&
          !selectedFixture &&
          !trackedPaths.has(relativePath))
      ) {
        return false;
      }
      const entry = await lstat(path);
      const inDependencies = segments.includes('node_modules');
      if (inDependencies && entry.isSymbolicLink()) {
        await mkdir(dirname(target), { recursive: true });
        await symlink(await readlink(path), target);
        return false;
      }
      if (name === '.bun' && basename(dirname(path)) === 'node_modules') {
        await mkdir(dirname(target), { recursive: true });
        await symlink(path, target, 'dir');
        return false;
      }
      const materialized = entry.isSymbolicLink() ? await stat(path) : entry;
      if (materialized.isFile()) {
        // Bun's large-file copy can emit source metadata events on macOS.
        // Explicit byte I/O keeps a guarded checkout free of copy side effects.
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await readFile(path), {
          mode: materialized.mode,
        });
        return false;
      }
      return true;
    },
    recursive: true,
  });
};
