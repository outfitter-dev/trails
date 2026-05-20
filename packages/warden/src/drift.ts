/**
 * Topo lock drift detection.
 *
 * Compares the `topo.lock` artifact hash listed in `trails.lock` against a
 * freshly generated TopoGraph hash to detect when the trail topology has
 * changed without updating the artifact family.
 */

import { existsSync, statSync } from 'node:fs';

import type { Topo } from '@ontrails/core';
import {
  deriveTrailsDir,
  NotFoundError,
  ValidationError,
} from '@ontrails/core';
import {
  createTopoStore,
  deriveTopoGraph,
  deriveTopoGraphHash,
  isTopoArtifactRegenerationError,
  readLockManifest,
} from '@ontrails/topographer';
import type { LockManifest } from '@ontrails/topographer';

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

interface BlockedLockRead {
  readonly drift: DriftResult;
  readonly kind: 'blocked-lock-read';
}

const blockedDrift = (reason: string): DriftResult => ({
  blockedReason: reason,
  committedHash: null,
  currentHash: 'blocked',
  stale: true,
});

const blockedLockRead = (reason: string): BlockedLockRead => ({
  drift: blockedDrift(reason),
  kind: 'blocked-lock-read',
});

const readCommittedLockManifest = async (
  rootDir: string
): Promise<BlockedLockRead | LockManifest | null> => {
  const trailsDir = deriveTrailsDir({ rootDir });
  try {
    return existsSync(rootDir) && statSync(rootDir).isDirectory()
      ? await readLockManifest({ dir: trailsDir })
      : null;
  } catch (error) {
    if (isTopoArtifactRegenerationError(error)) {
      return blockedLockRead(error.message);
    }
    throw error;
  }
};

const isBlockedLockRead = (
  result: BlockedLockRead | LockManifest | null
): result is BlockedLockRead =>
  result !== null && 'kind' in result && result.kind === 'blocked-lock-read';

/**
 * Check whether the committed trails.lock is stale compared to the current topology.
 *
 * When no topo is provided, returns a clean result (no drift detectable without runtime info).
 */
export const checkDrift = async (
  rootDir: string,
  topo?: Topo | undefined
): Promise<DriftResult> => {
  try {
    const lockManifest = await readCommittedLockManifest(rootDir);
    if (isBlockedLockRead(lockManifest)) {
      return lockManifest.drift;
    }
    const topoArtifact =
      lockManifest?.artifacts.find(
        (artifact) => artifact.role === 'topo' && artifact.path === 'topo.lock'
      ) ?? null;
    if (lockManifest !== null && topoArtifact === null) {
      return blockedDrift(
        'trails.lock does not contain a topo.lock artifact. Regenerate with `trails compile`.'
      );
    }
    const readStoredHash = (): string | undefined => {
      try {
        return createTopoStore({ rootDir }).exports.get()?.topoGraphHash;
      } catch (error) {
        if (error instanceof NotFoundError) {
          return;
        }
        throw error;
      }
    };
    const currentHash =
      topo === undefined
        ? (readStoredHash() ?? 'unknown')
        : deriveTopoGraphHash(deriveTopoGraph(topo));

    return {
      committedHash: topoArtifact?.sha256 ?? null,
      currentHash,
      stale:
        topoArtifact !== null &&
        currentHash !== 'unknown' &&
        topoArtifact.sha256 !== currentHash,
    };
  } catch (error) {
    if (
      !(error instanceof ValidationError) &&
      !isTopoArtifactRegenerationError(error)
    ) {
      throw error;
    }

    return blockedDrift(error.message);
  }
};
