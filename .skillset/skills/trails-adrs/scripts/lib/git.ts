import { renameSync } from 'node:fs';
import { ROOT } from './paths.ts';

/** Attempt `git mv`, fall back to plain rename. */
export const gitMove = (from: string, to: string): void => {
  const result = Bun.spawnSync(['git', 'mv', from, to], { cwd: ROOT });
  if (result.exitCode !== 0) {
    renameSync(from, to);
  }
};
