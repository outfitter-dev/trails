/**
 * Trailhead lock drift detection.
 *
 * Compares the committed `trailhead.lock` hash against a freshly generated
 * trailhead map hash to detect when the trail topology has changed without
 * updating the lock file.
 */

import type { Topo } from '@ontrails/core';
import {
  generateTrailheadMap,
  hashTrailheadMap,
  readTrailheadLock,
} from '@ontrails/schema';

/**
 * Result of a drift check comparing committed trailhead.lock against the current state.
 */
export interface DriftResult {
  /** Whether the committed lock is out of date */
  readonly stale: boolean;
  /** Hash from the committed trailhead.lock file, or null if not found */
  readonly committedHash: string | null;
  /** Hash computed from the current trail topology */
  readonly currentHash: string;
}

/**
 * Check whether the committed trailhead.lock is stale compared to the current topology.
 *
 * When no topo is provided, returns a clean result (no drift detectable without runtime info).
 */
export const checkDrift = async (
  rootDir: string,
  topo?: Topo | undefined
): Promise<DriftResult> => {
  if (!topo) {
    return { committedHash: null, currentHash: 'unknown', stale: false };
  }

  const trailheadMap = generateTrailheadMap(topo);
  const currentHash = hashTrailheadMap(trailheadMap);
  const committedHash = await readTrailheadLock({ dir: rootDir });

  return {
    committedHash,
    currentHash,
    stale: committedHash !== null && committedHash !== currentHash,
  };
};
