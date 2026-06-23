import { existsSync } from 'node:fs';
import {
  NotFoundError,
  deriveTrailsDbPath,
  openReadTrailsDb,
} from '@ontrails/core';
import type { TrailsDbLocationOptions } from '@ontrails/core';
import {
  TOPO_GRAPH_SCHEMA_VERSION,
  TOPO_STORE_SCHEMA_VERSION,
  createTopoStore,
  deriveTopoGraphHash,
  isTopoArtifactRegenerationError,
  readLockManifest,
  readTopoGraph,
  stripTopoGraphForces,
} from '@ontrails/topographer';
import type {
  LockManifest,
  LockManifestSummary,
  ReadOptions,
  TopoGraph,
  TopoStoreContourRecord,
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreSignalDetailRecord,
  TopoStoreTopoGraphEntryRecord,
  TopoStoreTopoGraphRecord,
  TopoStoreTrailDetailRecord,
  TopoSnapshot,
} from '@ontrails/topographer';

import type {
  WayfinderArtifactStatus,
  WayfinderArtifactKind,
  WayfinderStaleReason,
} from './provenance.js';

export type WayfinderArtifactLoaderOptions = ReadOptions &
  TrailsDbLocationOptions;

export interface WayfinderTopoStoreLoad {
  readonly contours: readonly TopoStoreContourRecord[];
  readonly entries: readonly TopoStoreTopoGraphEntryRecord[];
  readonly export: TopoStoreExportRecord | null;
  readonly path: string;
  readonly resources: readonly TopoStoreResourceRecord[];
  readonly schemaVersion: number;
  readonly signals: readonly TopoStoreSignalDetailRecord[];
  readonly snapshot: TopoSnapshot;
  readonly topoGraph: TopoStoreTopoGraphRecord | null;
  readonly trails: readonly TopoStoreTrailDetailRecord[];
}

export interface WayfinderArtifactLoad {
  readonly artifactStatus: WayfinderArtifactStatus;
  /** @deprecated Use artifactStatus. */
  readonly freshness: WayfinderArtifactStatus;
  readonly lockManifest: LockManifest | null;
  readonly topoGraph: TopoGraph | null;
  readonly topoStore: WayfinderTopoStoreLoad | null;
}

const artifactLoad = (
  load: Omit<WayfinderArtifactLoad, 'freshness'>
): WayfinderArtifactLoad => ({
  ...load,
  freshness: load.artifactStatus,
});

type ArtifactRead<TValue> =
  | {
      readonly kind: 'ok';
      readonly value: TValue | null;
    }
  | {
      readonly artifact: WayfinderArtifactKind;
      readonly kind: 'schema-version-drift';
      readonly message: string;
    };

const resolveArtifactReadOptions = (
  options?: WayfinderArtifactLoaderOptions
): ReadOptions | undefined => {
  if (options?.dir !== undefined) {
    return { dir: options.dir };
  }
  if (options?.rootDir !== undefined) {
    return { dir: options.rootDir };
  }
  return undefined;
};

const resolveTopoStoreLocation = (
  options?: WayfinderArtifactLoaderOptions
): TrailsDbLocationOptions | undefined => {
  if (options?.path !== undefined) {
    return options.rootDir === undefined
      ? { path: options.path }
      : { path: options.path, rootDir: options.rootDir };
  }
  if (options?.rootDir !== undefined) {
    return { rootDir: options.rootDir };
  }
  if (options?.dir !== undefined) {
    return undefined;
  }
  return {};
};

const readTopoArtifact = async (
  options?: WayfinderArtifactLoaderOptions
): Promise<ArtifactRead<TopoGraph>> => {
  try {
    return {
      kind: 'ok',
      value: await readTopoGraph(resolveArtifactReadOptions(options)),
    };
  } catch (error) {
    if (isTopoArtifactRegenerationError(error)) {
      return {
        artifact: 'topoGraph',
        kind: 'schema-version-drift',
        message: error.message,
      };
    }
    throw error;
  }
};

const readLockArtifact = async (
  options?: WayfinderArtifactLoaderOptions
): Promise<ArtifactRead<LockManifest>> => {
  try {
    return {
      kind: 'ok',
      value: await readLockManifest(resolveArtifactReadOptions(options)),
    };
  } catch (error) {
    if (isTopoArtifactRegenerationError(error)) {
      return {
        artifact: 'lockManifest',
        kind: 'schema-version-drift',
        message: error.message,
      };
    }
    throw error;
  }
};

const readTopoStoreArtifact = (
  options?: WayfinderArtifactLoaderOptions
): ArtifactRead<WayfinderTopoStoreLoad> => {
  const location = resolveTopoStoreLocation(options);
  if (location === undefined) {
    return { kind: 'ok', value: null };
  }
  const path = deriveTrailsDbPath(location);
  if (!existsSync(path)) {
    return { kind: 'ok', value: null };
  }

  let actualVersion: number | undefined;
  let db: ReturnType<typeof openReadTrailsDb> | undefined;
  try {
    db = openReadTrailsDb(location);
    const row = db
      .query<{ version: number }, [string]>(
        'SELECT version FROM meta_schema_versions WHERE subsystem = ?'
      )
      .get('topo');
    actualVersion = row?.version;
  } catch {
    return {
      artifact: 'topoStore',
      kind: 'schema-version-drift',
      message: `Unsupported trails.db topo store schema; regenerate with \`trails compile\`. Expected ${TOPO_STORE_SCHEMA_VERSION}.`,
    };
  } finally {
    db?.close();
  }

  if (actualVersion === undefined) {
    return { kind: 'ok', value: null };
  }

  if (actualVersion !== TOPO_STORE_SCHEMA_VERSION) {
    return {
      artifact: 'topoStore',
      kind: 'schema-version-drift',
      message: `Unsupported trails.db topo store schema; regenerate with \`trails compile\`. Expected ${TOPO_STORE_SCHEMA_VERSION}, found ${actualVersion}.`,
    };
  }

  const store = createTopoStore(location);
  let snapshot: TopoSnapshot | undefined;
  try {
    snapshot = store.snapshots.latest();
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { kind: 'ok', value: null };
    }
    throw error;
  }

  if (snapshot === undefined) {
    return { kind: 'ok', value: null };
  }

  const ref = { snapshotId: snapshot.id };
  return {
    kind: 'ok',
    value: {
      contours: store.contours.list({ snapshot: ref }),
      entries: store.entries.list({ snapshot: ref }),
      export: store.exports.get(ref) ?? null,
      path,
      resources: store.resources.list({ snapshot: ref }),
      schemaVersion: TOPO_STORE_SCHEMA_VERSION,
      signals: store.signals
        .list({ snapshot: ref })
        .map((signal) => store.signals.get(signal.id, { snapshot: ref }))
        .filter(
          (signal): signal is TopoStoreSignalDetailRecord =>
            signal !== undefined
        ),
      snapshot,
      topoGraph: store.topoGraph.get(ref) ?? null,
      trails: store.trails
        .list({ snapshot: ref })
        .map((trail) => store.trails.get(trail.id, { snapshot: ref }))
        .filter(
          (trail): trail is TopoStoreTrailDetailRecord => trail !== undefined
        ),
    },
  };
};

const countEntries = (
  topoGraph: TopoGraph,
  kind: TopoGraph['entries'][number]['kind']
): number => topoGraph.entries.filter((entry) => entry.kind === kind).length;

const summarizeTopoGraph = (topoGraph: TopoGraph): LockManifestSummary => ({
  contours: countEntries(topoGraph, 'contour'),
  resources: countEntries(topoGraph, 'resource'),
  signals: countEntries(topoGraph, 'signal'),
  trails: countEntries(topoGraph, 'trail'),
});

const summariesEqual = (
  left: LockManifestSummary,
  right: LockManifestSummary
): boolean =>
  left.contours === right.contours &&
  left.resources === right.resources &&
  left.signals === right.signals &&
  left.trails === right.trails;

const staleReasons = (
  topoGraph: TopoGraph,
  lockManifest: LockManifest,
  topoStore: WayfinderTopoStoreLoad
): readonly WayfinderStaleReason[] => {
  const reasons: WayfinderStaleReason[] = [];
  const actualHash = deriveTopoGraphHash(topoGraph);
  const contractHash = deriveTopoGraphHash(stripTopoGraphForces(topoGraph));
  const topoArtifact = lockManifest.artifacts.find(
    (artifact) => artifact.role === 'topo' && artifact.path === 'topo.lock'
  );

  if (topoArtifact === undefined) {
    reasons.push({ reason: 'lock-manifest-topo-artifact-missing' });
  } else if (topoArtifact.sha256 !== actualHash) {
    reasons.push({
      actual: actualHash,
      expected: topoArtifact.sha256,
      reason: 'lock-manifest-hash-mismatch',
    });
  }

  const storeExport = topoStore.export;
  if (storeExport === null) {
    reasons.push({ reason: 'topo-store-export-missing' });
  } else if (storeExport.topoGraphHash !== contractHash) {
    reasons.push({
      actual: storeExport.topoGraphHash,
      expected: contractHash,
      reason: 'topo-store-hash-mismatch',
      snapshotId: storeExport.snapshot.id,
    });
  }

  const actualSummary = summarizeTopoGraph(topoGraph);
  if (!summariesEqual(lockManifest.summary, actualSummary)) {
    reasons.push({
      actual: actualSummary,
      expected: lockManifest.summary,
      reason: 'lock-manifest-summary-mismatch',
    });
  }

  return reasons;
};

export const loadWayfinderArtifacts = async (
  options?: WayfinderArtifactLoaderOptions
): Promise<WayfinderArtifactLoad> => {
  const [topoGraphRead, lockManifestRead, topoStoreRead] = await Promise.all([
    readTopoArtifact(options),
    readLockArtifact(options),
    readTopoStoreArtifact(options),
  ]);

  if (topoGraphRead.kind === 'schema-version-drift') {
    return artifactLoad({
      artifactStatus: {
        artifact: topoGraphRead.artifact,
        message: topoGraphRead.message,
        status: 'schema-version-drift',
      },
      lockManifest:
        lockManifestRead.kind === 'ok' ? lockManifestRead.value : null,
      topoGraph: null,
      topoStore: topoStoreRead.kind === 'ok' ? topoStoreRead.value : null,
    });
  }

  if (lockManifestRead.kind === 'schema-version-drift') {
    return artifactLoad({
      artifactStatus: {
        artifact: lockManifestRead.artifact,
        message: lockManifestRead.message,
        status: 'schema-version-drift',
      },
      lockManifest: null,
      topoGraph: topoGraphRead.value,
      topoStore: topoStoreRead.kind === 'ok' ? topoStoreRead.value : null,
    });
  }

  if (topoStoreRead.kind === 'schema-version-drift') {
    return artifactLoad({
      artifactStatus: {
        artifact: topoStoreRead.artifact,
        message: topoStoreRead.message,
        status: 'schema-version-drift',
      },
      lockManifest: lockManifestRead.value,
      topoGraph: topoGraphRead.value,
      topoStore: null,
    });
  }

  const topoGraph = topoGraphRead.value;
  const lockManifest = lockManifestRead.value;
  const topoStore = topoStoreRead.value;
  if (topoGraph === null || lockManifest === null || topoStore === null) {
    const missing: WayfinderArtifactKind[] = [];
    if (topoGraph === null) {
      missing.push('topoGraph');
    }
    if (lockManifest === null) {
      missing.push('lockManifest');
    }
    if (topoStore === null) {
      missing.push('topoStore');
    }
    return artifactLoad({
      artifactStatus: { artifacts: missing, status: 'missing' },
      lockManifest,
      topoGraph,
      topoStore,
    });
  }

  const reasons = staleReasons(topoGraph, lockManifest, topoStore);
  return artifactLoad({
    artifactStatus:
      reasons.length === 0 ? { status: 'fresh' } : { reasons, status: 'stale' },
    lockManifest,
    topoGraph,
    topoStore,
  });
};

export const wayfinderTopoGraphSource = (
  options?: WayfinderArtifactLoaderOptions
) => ({
  kind: 'topoGraph' as const,
  path: `${resolveArtifactReadOptions(options)?.dir ?? '.'}/trails.lock`,
  schemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
});

export const wayfinderTopoStoreSource = (
  options?: WayfinderArtifactLoaderOptions
) => {
  const location = resolveTopoStoreLocation(options);
  return {
    kind: 'topoStore' as const,
    ...(location === undefined ? {} : { path: deriveTrailsDbPath(location) }),
    schemaVersion: TOPO_STORE_SCHEMA_VERSION,
  };
};
