/**
 * Config-owned, app-partitioned workspace graph derivation.
 *
 * A workspace view reads the app-local locks named by Config. Filesystem lock
 * discovery contributes observation evidence only; it never adds an app to the
 * canonical view.
 */

import { posix } from 'node:path';

import { ValidationError } from '@ontrails/core';
import { trailsLockFileName } from '@ontrails/config';
import type { ResolvedTrailsWorkspaceApp } from '@ontrails/config';

import { deriveStableHash, deriveTopoGraphHash } from './hash.js';
import { readTrailsLock } from './io.js';
import type {
  LockManifestSummary,
  TopoGraph,
  TopoGraphEntry,
} from './types.js';
import {
  collectWorkspaceLockCensus,
  workspaceCollectionSkipForApp,
} from './workspace-lock-census.js';
import { WORKSPACE_VIEW_SCHEMA_VERSION } from './workspace-view-types.js';
import type {
  DeriveWorkspaceViewOptions,
  WorkspaceAppLockFreshness,
  WorkspaceAppLockObservation,
  WorkspaceView,
  WorkspaceViewApp,
  WorkspaceViewCollectionSkip,
  WorkspaceViewCollision,
  WorkspaceViewContent,
} from './workspace-view-types.js';

export { WORKSPACE_VIEW_SCHEMA_VERSION } from './workspace-view-types.js';
export type {
  DeriveWorkspaceViewOptions,
  UnownedWorkspaceLockObservation,
  WorkspaceAppLockBinding,
  WorkspaceAppLockFreshness,
  WorkspaceAppLockObservation,
  WorkspaceAppLockStatus,
  WorkspaceView,
  WorkspaceViewApp,
  WorkspaceViewCollectionSkip,
  WorkspaceViewCollision,
  WorkspaceViewContent,
  WorkspaceViewEvidence,
} from './workspace-view-types.js';

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
};

const compareCollisions = (
  left: WorkspaceViewCollision,
  right: WorkspaceViewCollision
): number =>
  compareStrings(left.kind, right.kind) || compareStrings(left.id, right.id);

const lockPathForApp = (app: ResolvedTrailsWorkspaceApp): string =>
  app.root === '.'
    ? trailsLockFileName
    : posix.join(app.root, trailsLockFileName);

const normalizedTopoGraph = (topoGraph: TopoGraph): TopoGraph => {
  const { generatedAt: _generatedAt, ...canonical } = topoGraph;
  return canonical;
};

const summarizeTopoGraph = (
  topoGraph: TopoGraph
): Readonly<Record<TopoGraphEntry['kind'], number>> => ({
  entity: topoGraph.entries.filter((entry) => entry.kind === 'entity').length,
  resource: topoGraph.entries.filter((entry) => entry.kind === 'resource')
    .length,
  signal: topoGraph.entries.filter((entry) => entry.kind === 'signal').length,
  trail: topoGraph.entries.filter((entry) => entry.kind === 'trail').length,
});

const summaryMatches = (
  summary: LockManifestSummary,
  topoGraph: TopoGraph
): boolean => {
  const actual = summarizeTopoGraph(topoGraph);
  return (
    summary.entities === actual.entity &&
    summary.resources === actual.resource &&
    summary.signals === actual.signal &&
    summary.trails === actual.trail
  );
};

const deriveCollisions = (
  apps: readonly WorkspaceViewApp[]
): readonly WorkspaceViewCollision[] => {
  const owners = new Map<string, Set<string>>();
  for (const app of apps) {
    for (const entry of app.topoGraph.entries) {
      const key = `${entry.kind}\0${entry.id}`;
      const appIds = owners.get(key) ?? new Set<string>();
      appIds.add(app.id);
      owners.set(key, appIds);
    }
  }

  const collisions: WorkspaceViewCollision[] = [];
  for (const [key, appIds] of owners) {
    if (appIds.size < 2) {
      continue;
    }
    const separator = key.indexOf('\0');
    collisions.push({
      appIds: [...appIds].toSorted(compareStrings),
      id: key.slice(separator + 1),
      kind: key.slice(0, separator) as TopoGraphEntry['kind'],
    });
  }
  return collisions.toSorted(compareCollisions);
};

const deriveWorkspaceViewHash = (content: WorkspaceViewContent): string =>
  deriveStableHash({
    apps: content.apps.map((app) => ({
      id: app.id,
      root: app.root,
      topoGraphHash: app.topoGraphHash,
    })),
    collisions: content.collisions,
    workspaceViewSchemaVersion: content.workspaceViewSchemaVersion,
  });

const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const freshnessFor = (
  currentHash: string | undefined,
  savedHash: string
): WorkspaceAppLockFreshness => {
  if (currentHash === undefined) {
    return 'unknown';
  }
  return currentHash === savedHash ? 'fresh' : 'stale';
};

const validateSelection = (
  configuredAppIds: readonly string[],
  requested: readonly string[] | undefined
): readonly string[] => {
  const selectedAppIds = [...(requested ?? configuredAppIds)].toSorted(
    compareStrings
  );
  const unique = new Set(selectedAppIds);
  if (unique.size !== selectedAppIds.length) {
    throw new ValidationError(
      'Workspace app selection contains duplicate IDs.',
      {
        context: { selectedAppIds },
      }
    );
  }
  const configured = new Set(configuredAppIds);
  const unknown = selectedAppIds.filter((id) => !configured.has(id));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Workspace app selection contains unconfigured IDs: ${unknown.join(', ')}.`,
      { context: { configuredAppIds, selectedAppIds, unknownAppIds: unknown } }
    );
  }
  return selectedAppIds;
};

interface AppReadResult {
  readonly app?: WorkspaceViewApp | undefined;
  readonly observation: WorkspaceAppLockObservation;
}

const unavailableAppRead = (
  app: ResolvedTrailsWorkspaceApp,
  selected: ReadonlySet<string>,
  collectionSkip: WorkspaceViewCollectionSkip
): AppReadResult => {
  const lockPath = lockPathForApp(app);
  const scopeExcluded = collectionSkip.reason === 'scope-excluded';
  return {
    observation: {
      binding: 'unavailable',
      coaching: scopeExcluded
        ? `Include ${lockPath} in lockScope to observe configured app ${app.id}.`
        : `App ${app.id} extends beyond the ${collectionSkip.reason} collection edge at ${collectionSkip.path}. ` +
          'Invoke that project as its own collection root or move the app inside this workspace working tree.',
      detail: scopeExcluded
        ? `Configured app lock ${lockPath} is outside the active lock census scope.`
        : `Configured app root ${app.root} is not observable from this collection.`,
      freshness: 'unavailable',
      id: app.id,
      lockPath,
      provenance: 'configured-app-lock',
      root: app.root,
      selected: selected.has(app.id),
      status: 'unavailable',
    },
  };
};

const readConfiguredApp = async (
  app: ResolvedTrailsWorkspaceApp,
  selected: ReadonlySet<string>,
  currentAppGraphHashes: Readonly<Record<string, string>> | undefined,
  collectionSkip: WorkspaceViewCollectionSkip | undefined
): Promise<AppReadResult> => {
  const lockPath = lockPathForApp(app);
  const base = {
    id: app.id,
    lockPath,
    provenance: 'configured-app-lock' as const,
    root: app.root,
    selected: selected.has(app.id),
  };

  if (collectionSkip !== undefined) {
    return unavailableAppRead(app, selected, collectionSkip);
  }

  let lock: Awaited<ReturnType<typeof readTrailsLock>>;
  try {
    lock = await readTrailsLock({ dir: app.rootDir });
  } catch (error) {
    return {
      observation: {
        ...base,
        binding: 'unavailable',
        coaching: `Regenerate ${lockPath} by compiling configured app ${app.id}.`,
        detail: errorDetail(error),
        freshness: 'unavailable',
        status: 'invalid',
      },
    };
  }
  if (lock === null) {
    return {
      observation: {
        ...base,
        binding: 'unavailable',
        coaching: `Create ${lockPath} by compiling configured app ${app.id}.`,
        freshness: 'unavailable',
        status: 'missing',
      },
    };
  }

  const actualAppId = lock.scope['app'];
  const libraryAppId = lock.topoGraph.library?.app;
  if (
    actualAppId !== app.id ||
    (libraryAppId !== undefined && libraryAppId !== app.id)
  ) {
    return {
      observation: {
        ...base,
        ...(actualAppId === undefined ? {} : { actualAppId }),
        binding: 'mismatched',
        coaching: `Align workspace.apps.${app.id}, the topo name, and ${lockPath}, then recompile the selected app.`,
        detail:
          libraryAppId !== undefined && libraryAppId !== app.id
            ? `Lock scope app is ${JSON.stringify(actualAppId)} and library app is ${JSON.stringify(libraryAppId)}; expected ${JSON.stringify(app.id)}.`
            : `Lock scope app is ${JSON.stringify(actualAppId)}; expected ${JSON.stringify(app.id)}.`,
        freshness: 'unavailable',
        status: 'available',
      },
    };
  }
  if (lock.topoGraph.workspace !== undefined) {
    return {
      observation: {
        ...base,
        actualAppId,
        binding: 'matched',
        coaching: `Regenerate ${lockPath} as an app-local lock without legacy workspace metadata.`,
        detail:
          'App-local locks cannot carry legacy aggregate workspace metadata.',
        freshness: 'unavailable',
        status: 'invalid',
      },
    };
  }

  const topoGraph = normalizedTopoGraph(lock.topoGraph as TopoGraph);
  const actualHash = deriveTopoGraphHash(topoGraph);
  if (actualHash !== lock.topoGraphHash) {
    return {
      observation: {
        ...base,
        actualAppId,
        binding: 'matched',
        coaching: `Regenerate invalid ${lockPath} by compiling configured app ${app.id}.`,
        detail: `Stored topoGraphHash ${lock.topoGraphHash} does not match graph content ${actualHash}.`,
        freshness: 'unavailable',
        status: 'invalid',
      },
    };
  }
  if (!summaryMatches(lock.summary, topoGraph)) {
    return {
      observation: {
        ...base,
        actualAppId,
        binding: 'matched',
        coaching: `Regenerate invalid ${lockPath} by compiling configured app ${app.id}.`,
        detail: `Stored lock summary does not match graph content: ${JSON.stringify(lock.summary)}.`,
        freshness: 'unavailable',
        status: 'invalid',
      },
    };
  }

  const hasCurrentHash =
    currentAppGraphHashes !== undefined &&
    Object.hasOwn(currentAppGraphHashes, app.id);
  const currentHash = hasCurrentHash
    ? currentAppGraphHashes?.[app.id]
    : undefined;
  if (currentHash !== undefined && !/^[0-9a-f]{64}$/u.test(currentHash)) {
    throw new ValidationError(
      `Current graph hash for app ${app.id} must be a lowercase SHA-256 digest.`,
      { context: { appId: app.id, currentHash } }
    );
  }
  const freshness = freshnessFor(currentHash, actualHash);
  return {
    app: {
      id: app.id,
      root: app.root,
      topoGraph,
      topoGraphHash: actualHash,
    },
    observation: {
      ...base,
      actualAppId,
      binding: 'matched',
      ...(freshness === 'stale'
        ? {
            coaching: `Regenerate stale ${lockPath} by compiling configured app ${app.id}.`,
            detail: `Current graph hash ${currentHash} does not match saved graph hash ${actualHash}.`,
          }
        : {}),
      freshness,
      status: 'available',
    },
  };
};

/**
 * Derive the workspace's canonical app-partitioned graph view from Config app
 * identity and app-local locks.
 *
 * The function never imports app source and never writes or refreshes a lock.
 * Missing, invalid, stale, contradictory, and unowned artifacts remain typed
 * observation evidence. Only a complete bound app set receives a canonical
 * `workspaceViewHash`.
 *
 * @example
 * ```ts
 * const identity = await readTrailsProjectIdentity({
 *   boundaryDir: projectRoot,
 *   startDir: process.cwd(),
 * });
 * const view = await deriveWorkspaceView({ identity });
 * ```
 */
export const deriveWorkspaceView = async (
  options: DeriveWorkspaceViewOptions
): Promise<WorkspaceView> => {
  const configuredApps = [...options.identity.apps].toSorted((left, right) =>
    compareStrings(left.id, right.id)
  );
  if (configuredApps.length === 0) {
    throw new ValidationError(
      'A workspace view requires Config-owned workspace.apps identity.'
    );
  }
  const configuredAppIds = configuredApps.map((app) => app.id);
  const selectedAppIds = validateSelection(
    configuredAppIds,
    options.selectedAppIds
  );
  const selected = new Set(selectedAppIds);
  const expectedLockPaths = new Set(configuredApps.map(lockPathForApp));
  const census = collectWorkspaceLockCensus(
    options.identity,
    expectedLockPaths,
    options.lockScope
  );
  const reads = await Promise.all(
    configuredApps.map((app) =>
      readConfiguredApp(
        app,
        selected,
        options.currentAppGraphHashes,
        workspaceCollectionSkipForApp(app, census.collectionSkips)
      )
    )
  );
  const apps = reads
    .flatMap((result) => (result.app === undefined ? [] : [result.app]))
    .toSorted((left, right) => compareStrings(left.id, right.id));
  const collisions = deriveCollisions(apps);
  const content: WorkspaceViewContent = {
    apps,
    collisions,
    workspaceViewSchemaVersion: WORKSPACE_VIEW_SCHEMA_VERSION,
  };
  const completeAppIds = new Set(apps.map((app) => app.id));
  const configuredCompleteness =
    completeAppIds.size === configuredAppIds.length ? 'complete' : 'partial';
  const selectedCompleteness = selectedAppIds.every((id) =>
    completeAppIds.has(id)
  )
    ? 'complete'
    : 'partial';
  return {
    content,
    evidence: {
      apps: reads.map((result) => result.observation),
      collectionSkips: census.collectionSkips,
      configuredAppIds,
      configuredCompleteness,
      selectedAppIds,
      selectedCompleteness,
      unownedLocks: census.unownedLocks,
    },
    workspaceViewHash:
      configuredCompleteness === 'complete'
        ? deriveWorkspaceViewHash(content)
        : null,
  };
};
