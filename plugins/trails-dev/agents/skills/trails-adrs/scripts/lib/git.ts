import { linkSync, lstatSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './paths.ts';

/** Move without replacing an existing path; failed fallback leaves the source intact. */
export const gitMove = (from: string, to: string): void => {
  if (resolve(from) === resolve(to)) {
    return;
  }
  if (lstatSync(to, { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists: ${to}`);
  }
  const result = Bun.spawnSync(['git', 'mv', from, to], { cwd: ROOT });
  if (result.exitCode === 0) {
    return;
  }

  // Linking creates the destination exclusively, unlike POSIX rename replacement.
  // ADR moves stay on the same filesystem; cross-device failure preserves the source.
  linkSync(from, to);
  try {
    unlinkSync(from);
  } catch (error) {
    try {
      unlinkSync(to);
    } catch (cleanupError) {
      // oxlint-disable-next-line preserve-caught-error -- AggregateError.errors preserves both move and cleanup failures.
      throw new AggregateError(
        [error, cleanupError],
        'ADR move and destination cleanup failed',
        { cause: cleanupError }
      );
    }
    throw error;
  }
};
