/**
 * Read-only topo store consumer helpers.
 *
 * Extracted from topo-support.ts to isolate read-only store consumer helpers,
 * keeping module boundaries clean.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  ConflictError,
  createTopoStore,
  InternalError,
  listTopoSnapshots,
  NotFoundError,
  Result,
} from '@ontrails/core';
import type { Topo, TopoSnapshot } from '@ontrails/core';
import {
  deriveTrailsDbPath,
  deriveTrailsDir,
} from '@ontrails/core/internal/trails-db';
import { readSurfaceLockData } from '@ontrails/schema';

import type {
  BriefReport,
  SignalDetailReport,
  SurveyListReport,
} from './topo-reports.js';
import type { TopoSummaryReport, TopoVerifyReport } from './topo-support.js';
import { REPORT_CONTRACT_VERSION, REPORT_VERSION } from './topo-constants.js';
import {
  createCurrentTopoSnapshot,
  deriveRootDir,
  LOCK_PATH,
} from './topo-support.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface StoredSurfaceMapEntry {
  readonly detours?: readonly {
    readonly on: string;
    readonly maxAttempts: number;
  }[];
  readonly kind: 'resource' | 'signal' | 'trail';
}

export interface CurrentTrailDetail {
  readonly crosses: string[];
  readonly description: string | null;
  readonly detours:
    | { readonly on: string; readonly maxAttempts: number }[]
    | null;
  readonly examples: unknown[];
  readonly id: string;
  readonly intent: 'destroy' | 'read' | 'write';
  readonly kind: 'trail';
  readonly pattern: string | null;
  readonly resources: string[];
  readonly safety: string;
}

export interface CurrentResourceDetail {
  readonly description: string | null;
  readonly health: 'available' | 'none';
  readonly id: string;
  readonly kind: 'resource';
  readonly lifetime: 'singleton';
  readonly usedBy: string[];
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

const topoStoreRef = (snapshotId: string) => ({ snapshotId }) as const;

const hasCommittedLock = (trailsDir: string): boolean =>
  existsSync(join(trailsDir, 'trails.lock'));

const readSurfaceEntries = (
  surfaceMapJson: string
): readonly StoredSurfaceMapEntry[] =>
  (
    JSON.parse(surfaceMapJson) as {
      readonly entries: readonly StoredSurfaceMapEntry[];
    }
  ).entries;

const buildBriefReportFromStore = (
  app: Topo,
  store: ReturnType<typeof createTopoStore>,
  ref: ReturnType<typeof topoStoreRef>,
  snapshot: TopoSnapshot
): BriefReport => {
  const trails = store.trails.list({ snapshot: ref });
  const exportRecord = store.exports.get(ref);
  const trailEntries =
    exportRecord === undefined
      ? []
      : readSurfaceEntries(exportRecord.surfaceMapJson).filter(
          (entry) => entry.kind === 'trail'
        );

  return {
    contractVersion: REPORT_CONTRACT_VERSION,
    features: {
      detours: trailEntries.some((entry) => (entry.detours ?? []).length > 0),
      examples: trails.some((trail) => trail.hasExamples),
      outputSchemas: trails.some((trail) => trail.hasOutput),
      resources: snapshot.resourceCount > 0,
      signals: snapshot.signalCount > 0,
    },
    name: app.name,
    resources: snapshot.resourceCount,
    signals: snapshot.signalCount,
    trails: snapshot.trailCount,
    version: REPORT_VERSION,
  };
};

const buildSurveyListFromStore = (
  store: ReturnType<typeof createTopoStore>,
  ref: ReturnType<typeof topoStoreRef>
): SurveyListReport => {
  const trails = store.trails.list({ snapshot: ref });
  const resources = store.resources.list({ snapshot: ref });
  const signals = store.signals.list({ snapshot: ref });

  return {
    count: trails.length,
    entries: trails.map((trail) => ({
      examples: trail.exampleCount,
      id: trail.id,
      kind: trail.kind,
      safety: trail.safety,
    })),
    resourceCount: resources.length,
    resources: resources.map((resource) => ({
      description: resource.description,
      health: resource.health,
      id: resource.id,
      kind: resource.kind,
      lifetime: resource.lifetime,
      usedBy: resource.usedBy,
    })),
    signalCount: signals.length,
    signals: signals.map((signal) => ({
      consumers: signal.consumers,
      description: signal.description,
      examples: signal.exampleCount,
      from: signal.from,
      id: signal.id,
      kind: signal.kind,
      payloadSchema: signal.payloadSchema,
      producers: signal.producers,
    })),
  };
};

const buildTrailDetailFromStore = (
  detail: NonNullable<
    ReturnType<ReturnType<typeof createTopoStore>['trails']['get']>
  >
): CurrentTrailDetail => ({
  crosses: [...detail.crosses],
  description: detail.description,
  detours:
    detail.detours === null
      ? null
      : detail.detours.map((detour) => ({
          maxAttempts: detour.maxAttempts,
          on: detour.on,
        })),
  examples: [...detail.examples],
  id: detail.id,
  intent: detail.intent,
  kind: 'trail',
  pattern: detail.pattern,
  resources: [...detail.resources],
  safety: detail.safety,
});

const buildResourceDetailFromStore = (
  resource: NonNullable<
    ReturnType<ReturnType<typeof createTopoStore>['resources']['get']>
  >
): CurrentResourceDetail => ({
  description: resource.description,
  health: resource.health,
  id: resource.id,
  kind: resource.kind,
  lifetime: resource.lifetime,
  usedBy: [...resource.usedBy],
});

const buildSignalDetailFromStore = (
  signal: NonNullable<
    ReturnType<ReturnType<typeof createTopoStore>['signals']['get']>
  >
): SignalDetailReport => ({
  consumers: [...signal.consumers],
  description: signal.description,
  examples: [...signal.examples],
  from: [...signal.from],
  id: signal.id,
  kind: signal.kind,
  payload: signal.payload ?? null,
  producers: [...signal.producers],
});

// ---------------------------------------------------------------------------
// withCurrentTopoStore
// ---------------------------------------------------------------------------

/**
 * Run a read callback against the latest topo store state.
 *
 * Uses the most recent existing snapshot when available, only creating a new
 * snapshot when no prior snapshot exists. This avoids unbounded snapshot
 * accumulation from
 * read-only operations like survey, guide, and show.
 */
const withCurrentTopoStore = <T>(
  app: Topo,
  rootDir: string,
  read: (
    store: ReturnType<typeof createTopoStore>,
    ref: ReturnType<typeof topoStoreRef>,
    snapshot: TopoSnapshot
  ) => T
): T => {
  const [existingSnapshot] = listTopoSnapshots({ limit: 1, rootDir });
  const snapshot =
    existingSnapshot ?? createCurrentTopoSnapshot(app, { rootDir });
  const store = createTopoStore({ rootDir });
  return read(store, topoStoreRef(snapshot.id), snapshot);
};

// ---------------------------------------------------------------------------
// Public read-only consumers
// ---------------------------------------------------------------------------

export const buildTopoSummary = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSummaryReport => {
  const rootDir = deriveRootDir(options?.rootDir);
  const trailsDir = deriveTrailsDir({ rootDir });
  return withCurrentTopoStore(app, rootDir, (store, ref, snapshot) => ({
    app: buildBriefReportFromStore(app, store, ref, snapshot),
    dbPath: deriveTrailsDbPath({ rootDir }),
    list: buildSurveyListFromStore(store, ref),
    lockExists: hasCommittedLock(trailsDir),
    lockPath: LOCK_PATH,
  }));
};

export const buildCurrentTopoBrief = (
  app: Topo,
  options?: { readonly rootDir?: string }
): BriefReport => {
  const rootDir = deriveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref, snapshot) =>
    buildBriefReportFromStore(app, store, ref, snapshot)
  );
};

export const buildCurrentTopoList = (
  app: Topo,
  options?: { readonly rootDir?: string }
): SurveyListReport => {
  const rootDir = deriveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref) =>
    buildSurveyListFromStore(store, ref)
  );
};

export const buildCurrentGuideEntries = (
  app: Topo,
  options?: { readonly rootDir?: string }
): readonly {
  readonly description: string;
  readonly exampleCount: number;
  readonly id: string;
  readonly kind: 'trail';
}[] => {
  const rootDir = deriveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref) =>
    store.trails.list({ snapshot: ref }).map((trail) => ({
      description: trail.description ?? '(no description)',
      exampleCount: trail.exampleCount,
      id: trail.id,
      kind: 'trail',
    }))
  );
};

export const buildCurrentTopoDetail = (
  app: Topo,
  id: string,
  options?: { readonly rootDir?: string }
):
  | CurrentResourceDetail
  | CurrentTrailDetail
  | SignalDetailReport
  | undefined => {
  const rootDir = deriveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref) => {
    const trail = store.trails.get(id, { snapshot: ref });
    if (trail !== undefined) {
      return buildTrailDetailFromStore(trail);
    }

    const resource = store.resources.get(id, { snapshot: ref });
    if (resource !== undefined) {
      return buildResourceDetailFromStore(resource);
    }

    const signal = store.signals.get(id, { snapshot: ref });
    return signal === undefined
      ? undefined
      : buildSignalDetailFromStore(signal);
  });
};

export const verifyCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoVerifyReport, Error>> => {
  const rootDir = deriveRootDir(options?.rootDir);
  const committedLock = await readSurfaceLockData({
    dir: deriveTrailsDir({ rootDir }),
  });

  if (committedLock === null) {
    return Result.err(
      new NotFoundError(
        'No committed trails.lock found. Run `trails topo export` first.'
      )
    );
  }

  const currentHash = withCurrentTopoStore(
    app,
    rootDir,
    (store, ref) => store.exports.get(ref)?.surfaceHash
  );

  if (currentHash === undefined) {
    return Result.err(
      new InternalError(
        'No stored topo export found for the current topo snapshot'
      )
    );
  }

  if (committedLock.hash !== currentHash) {
    return Result.err(
      new ConflictError(
        'trails.lock is stale. Run `trails topo export` to refresh it.'
      )
    );
  }

  return Result.ok({
    committedHash: committedLock.hash,
    currentHash,
    lockPath: LOCK_PATH,
    stale: false,
  });
};
