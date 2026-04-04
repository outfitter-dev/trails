/**
 * Topo lock drift detection.
 *
 * Compares the committed `trails.lock` hash against a freshly generated
 * trailhead map hash to detect when the trail topology has changed without
 * updating the lock file. The committed lock may be structured JSON or the
 * legacy single-line hash format.
 */

import type { Topo } from '@ontrails/core';
import { ValidationError } from '@ontrails/core';
import { resolveTrailsDir } from '@ontrails/core/internal/trails-db';
import {
  generateTrailheadMap,
  hashTrailheadMap,
  readTrailheadLockData,
} from '@ontrails/schema';

/**
 * Result of a drift check comparing committed trails.lock against the current state.
 */
export interface DriftResult {
  /** Why drift could not be computed for the established graph, when blocked. */
  readonly blockedReason?: string | undefined;
  /** Whether the committed lock is out of date */
  readonly stale: boolean;
  /** Hash from the committed trails.lock file, or null if not found */
  readonly committedHash: string | null;
  /** Hash computed from the current trail topology */
  readonly currentHash: string;
}

/**
 * Check whether the committed trails.lock is stale compared to the current topology.
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

  try {
    const trailheadMap = generateTrailheadMap(topo);
    const currentHash = hashTrailheadMap(trailheadMap);
    const committedLock = await readTrailheadLockData({
      dir: resolveTrailsDir({ rootDir }),
    });

    return {
      committedHash: committedLock?.hash ?? null,
      currentHash,
      stale:
        committedLock !== null &&
        currentHash !== 'unknown' &&
        committedLock.hash !== currentHash,
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }

    return {
      blockedReason: error.message,
      committedHash: null,
      currentHash: 'blocked',
      stale: true,
    };
  }
};
