import { deriveTopoGraph } from '@ontrails/topography';

import { hashTopoGraphEntry } from './run-watch.js';
import { tryLoadFreshAppLease } from './trails/load-app.js';
import { assertConfiguredAppBinding } from './trails/project-context.js';
import { resolveRunTargetProject } from './trails/run.js';

export interface WatchRunTarget {
  readonly app?: string | undefined;
  readonly id: string;
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
}

export const readWatchTopoGraphEntryHash = async (
  target: WatchRunTarget | null,
  cwd: string = process.cwd()
): Promise<string | null> => {
  if (target === null) {
    return null;
  }
  const targetResult = await resolveRunTargetProject(target, target.id, {
    cwd,
  });
  if (targetResult.isErr()) {
    throw targetResult.error;
  }
  const leaseResult = await tryLoadFreshAppLease(
    targetResult.value.modulePath,
    targetResult.value.rootDir
  );
  if (leaseResult.isErr()) {
    throw leaseResult.error;
  }
  const lease = leaseResult.value;
  try {
    const binding = assertConfiguredAppBinding(
      targetResult.value.context,
      lease.app.name
    );
    if (binding.isErr()) {
      throw binding.error;
    }
    const topoGraph = deriveTopoGraph(lease.app);
    const entry = topoGraph.entries.find(
      (candidate) => candidate.kind === 'trail' && candidate.id === target.id
    );
    return entry === undefined ? null : hashTopoGraphEntry(entry);
  } finally {
    lease.release();
  }
};
