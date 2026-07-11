/**
 * Trails lock drift detection.
 *
 * Compares the committed `trails.lock` TopoGraph hash against a freshly
 * generated TopoGraph hash to detect when the trail topology changed without
 * updating the committed resolved truth.
 */

import { existsSync, statSync } from 'node:fs';

import type { Topo } from '@ontrails/core';
import {
  deriveTrailsDir,
  NotFoundError,
  ValidationError,
} from '@ontrails/core';
import {
  collectTopoGraphOverlays,
  createTopoStore,
  deriveTopoGraph,
  deriveTopoGraphHash,
  isTopoArtifactRegenerationError,
  LOCK_MANIFEST_SCHEMA_VERSION,
  readLockManifest,
  readTopoGraph,
  readTrailsLock,
} from '@ontrails/topography';
import type {
  DeriveTopoGraphOptions,
  LockManifest,
  TopoGraphOverlays,
} from '@ontrails/topography';

/**
 * Derive options `checkDrift` accepts so the fresh comparison graph carries
 * the same app-module overlays the committed lock embeds.
 *
 * @example
 * ```ts
 * import type { CheckDriftOptions } from '@ontrails/warden';
 *
 * const options: CheckDriftOptions = { overlays: lease.overlays };
 * ```
 */
export type CheckDriftOptions = Pick<DeriveTopoGraphOptions, 'overlays'>;

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
  /**
   * Overlay namespaces whose committed facts differ from the freshly derived
   * facts, sorted lexicographically. Present only when the lock is stale and
   * the caller supplied a topo plus derive options.
   */
  readonly driftedOverlayNamespaces?: readonly string[] | undefined;
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
  try {
    if (!(existsSync(rootDir) && statSync(rootDir).isDirectory())) {
      return null;
    }
    const rootLock = await readTrailsLock({ dir: rootDir });
    if (rootLock !== null) {
      return {
        artifacts: [
          {
            path: 'topo.lock',
            role: 'topo',
            sha256: rootLock.topoGraphHash,
          },
        ],
        scope: rootLock.scope,
        summary: rootLock.summary,
        version: LOCK_MANIFEST_SCHEMA_VERSION,
      };
    }
    return await readLockManifest({ dir: deriveTrailsDir({ rootDir }) });
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
 * Read the committed lock's embedded graph overlays, tolerating both the v4
 * root `trails.lock` envelope and the legacy `.trails/` artifact layout.
 */
const readCommittedGraphOverlays = async (
  rootDir: string
): Promise<TopoGraphOverlays | undefined> => {
  const committedGraph =
    (await readTopoGraph({ dir: rootDir })) ??
    (await readTopoGraph({ dir: deriveTrailsDir({ rootDir }) }));
  return committedGraph?.overlays;
};

/**
 * Name the overlay namespaces whose committed facts drifted from the freshly
 * derived facts. Compares canonical JSON per namespace across the union of
 * committed and current namespaces; returns a sorted list.
 */
const collectDriftedOverlayNamespaces = async (
  rootDir: string,
  topo: Topo,
  options: CheckDriftOptions
): Promise<readonly string[]> => {
  let committed: TopoGraphOverlays | undefined;
  try {
    committed = await readCommittedGraphOverlays(rootDir);
  } catch {
    return [];
  }
  const current = collectTopoGraphOverlays(topo, options.overlays);
  const namespaces = new Set([
    ...Object.keys(committed ?? {}),
    ...Object.keys(current ?? {}),
  ]);
  return [...namespaces]
    .filter(
      (namespace) =>
        JSON.stringify(committed?.[namespace]) !==
        JSON.stringify(current?.[namespace])
    )
    .toSorted();
};

/**
 * Format a stale drift result into one human-readable sentence.
 *
 * Names the drifted overlay namespaces when the drift check identified them,
 * and always points at `trails compile` as the remediation.
 *
 * @example
 * ```ts
 * import { staleDriftMessage } from './drift.js';
 *
 * staleDriftMessage({
 *   committedHash: 'aaa',
 *   currentHash: 'bbb',
 *   driftedOverlayNamespaces: ['surfaces'],
 *   stale: true,
 * });
 * // => 'trails.lock is stale — drifted overlay namespaces: surfaces (regenerate with `trails compile`)'
 * ```
 */
export const staleDriftMessage = (drift: DriftResult): string => {
  const namespaces = drift.driftedOverlayNamespaces;
  const detail =
    namespaces !== undefined && namespaces.length > 0
      ? ` — drifted overlay namespaces: ${namespaces.join(', ')}`
      : '';
  return `trails.lock is stale${detail} (regenerate with \`trails compile\`)`;
};

/**
 * Check whether the committed trails.lock is stale compared to the current topology.
 *
 * When no topo is provided, returns a clean result (no drift detectable without runtime info).
 * When a topo is provided, `options.overlays` carries the app-module overlay
 * registrations so the fresh comparison graph embeds the same namespaced
 * facts the compile path writes into the committed lock.
 */
export const checkDrift = async (
  rootDir: string,
  topo?: Topo | undefined,
  options?: CheckDriftOptions | undefined
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
        : deriveTopoGraphHash(deriveTopoGraph(topo, options));
    const stale =
      topoArtifact !== null &&
      currentHash !== 'unknown' &&
      topoArtifact.sha256 !== currentHash;
    const driftedOverlayNamespaces =
      stale && topo !== undefined && options !== undefined
        ? await collectDriftedOverlayNamespaces(rootDir, topo, options)
        : undefined;

    return {
      committedHash: topoArtifact?.sha256 ?? null,
      currentHash,
      ...(driftedOverlayNamespaces === undefined ||
      driftedOverlayNamespaces.length === 0
        ? {}
        : { driftedOverlayNamespaces }),
      stale,
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
