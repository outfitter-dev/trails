/**
 * Shared Trails-project detection helpers for scaffold trails.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { isDraftMarkedFile } from '@ontrails/warden';

/** Return all TypeScript entries in a project's src directory. */
const sourceEntryPriority = (entry: string): number => {
  if (entry === 'app.ts') {
    return 0;
  }
  return isDraftMarkedFile(entry) ? 2 : 1;
};

const scanSourceEntries = (srcDir: string): string[] =>
  [...new Bun.Glob('*.ts').scanSync({ cwd: srcDir })].toSorted((a, b) => {
    const priority = sourceEntryPriority(a) - sourceEntryPriority(b);
    if (priority === 0) {
      return a.localeCompare(b);
    }
    return priority;
  });

/** Resolve an entry to an app import if it contains topo(). */
const toTopoImport = async (
  srcDir: string,
  entry: string
): Promise<string | null> => {
  const content = await Bun.file(join(srcDir, entry)).text();
  return content.includes('topo(')
    ? `./${entry.replace(/\.ts$/, '.js')}`
    : null;
};

/** Find the app module that defines a topo inside `src/`. */
export const findTopoPath = async (cwd: string): Promise<string | null> => {
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) {
    return null;
  }

  try {
    for (const entry of scanSourceEntries(srcDir)) {
      const appImport = await toTopoImport(srcDir, entry);
      if (appImport) {
        return appImport;
      }
    }
  } catch {
    return null;
  }

  return null;
};

/** Detect whether the directory already looks like a Trails project. */
export const isInsideProject = async (cwd: string): Promise<boolean> => {
  if (existsSync(join(cwd, '.trails'))) {
    return true;
  }
  return (await findTopoPath(cwd)) !== null;
};
