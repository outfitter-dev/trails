import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const LOCK_FILE = 'skillset.lock';

const listBundleFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name !== LOCK_FILE) {
        files.push(relative(root, path).replaceAll('\\', '/'));
      }
    }
  };

  await visit(root);
  return files.toSorted();
};

export const hashSkillsetBundle = async (root: string): Promise<string> => {
  const digest = createHash('sha256');
  for (const path of await listBundleFiles(root)) {
    digest.update(path);
    digest.update('\0');
    digest.update(await readFile(join(root, path)));
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
};

if (import.meta.main) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error('usage: bun scripts/hash-skillset-bundle.ts <bundle> [...]');
    process.exitCode = 1;
  } else {
    for (const root of roots) {
      console.log(`${await hashSkillsetBundle(root)}  ${root}`);
    }
  }
}
