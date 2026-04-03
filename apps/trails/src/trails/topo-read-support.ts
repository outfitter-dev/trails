/**
 * Read-only topo store consumer helpers.
 *
 * Extracted from topo-support.ts so this branch (trl-132) owns its own file,
 * keeping absorb routing clean across the stack.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Topo } from '@ontrails/core';
import {
  ConflictError,
  createTopoStore,
  InternalError,
  NotFoundError,
  Result,
} from '@ontrails/core';
import type { TopoSaveRecord } from '@ontrails/core/internal/topo-saves';
import { listTopoSaves } from '@ontrails/core/internal/topo-saves';
import {
  openReadTrailsDb,
  resolveTrailsDbPath,
  resolveTrailsDir,
} from '@ontrails/core/internal/trails-db';
import { readTrailheadLockData } from '@ontrails/schema';

import type { BriefReport, SurveyListReport } from './topo-reports.js';
import type { TopoSummaryReport, TopoVerifyReport } from './topo-support.js';
import { REPORT_CONTRACT_VERSION, REPORT_VERSION } from './topo-constants.js';
import {
  createCurrentTopoSave,
  LOCK_PATH,
  resolveRootDir,
} from './topo-support.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface StoredTrailheadMapEntry {
  readonly detours?: Readonly<Record<string, readonly string[]>>;
  readonly kind: 'provision' | 'signal' | 'trail';
}

interface CurrentTrailDetail {
  readonly crosses: string[];
  readonly description: string | null;
  readonly detours: Readonly<Record<string, readonly string[]>> | null;
  readonly examples: unknown[];
  readonly id: string;
  readonly intent: 'destroy' | 'read' | 'write';
  readonly kind: string;
  readonly provisions: string[];
  readonly safety: string;
}

interface CurrentProvisionDetail {
  readonly description: string | null;
  readonly health: 'available' | 'none';
  readonly id: string;
  readonly kind: 'provision';
  readonly lifetime: 'singleton';
  readonly usedBy: string[];
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

const topoStoreRef = (saveId: string) => ({ saveId }) as const;

const hasCommittedLock = (trailsDir: string): boolean =>
  existsSync(join(trailsDir, 'trails.lock')) ||
  existsSync(join(trailsDir, 'trailhead.lock'));

const readTrailheadEntries = (
  trailheadMapJson: string
): readonly StoredTrailheadMapEntry[] =>
  (
    JSON.parse(trailheadMapJson) as {
      readonly entries: readonly StoredTrailheadMapEntry[];
    }
  ).entries;

const buildBriefReportFromStore = (
  app: Topo,
  store: ReturnType<typeof createTopoStore>,
  ref: ReturnType<typeof topoStoreRef>,
  save: TopoSaveRecord
): BriefReport => {
  const trails = store.trails.list({ save: ref });
  const exportRecord = store.exports.get(ref);
  const trailEntries =
    exportRecord === undefined
      ? []
      : readTrailheadEntries(exportRecord.trailheadMapJson).filter(
          (entry) => entry.kind === 'trail'
        );

  return {
    contractVersion: REPORT_CONTRACT_VERSION,
    features: {
      detours: trailEntries.some(
        (entry) => (Object.keys(entry.detours ?? {}).length ?? 0) > 0
      ),
      examples: trails.some((trail) => trail.hasExamples),
      outputSchemas: trails.some((trail) => trail.hasOutput),
      provisions: save.provisionCount > 0,
      signals: save.signalCount > 0,
    },
    name: app.name,
    provisions: save.provisionCount,
    signals: save.signalCount,
    trails: save.trailCount,
    version: REPORT_VERSION,
  };
};

const buildSurveyListFromStore = (
  store: ReturnType<typeof createTopoStore>,
  ref: ReturnType<typeof topoStoreRef>
): SurveyListReport => {
  const trails = store.trails.list({ save: ref });
  const provisions = store.provisions.list({ save: ref });

  return {
    count: trails.length,
    entries: trails.map((trail) => ({
      examples: trail.exampleCount,
      id: trail.id,
      kind: trail.kind,
      safety: trail.safety,
    })),
    provisionCount: provisions.length,
    provisions: provisions.map((provision) => ({
      description: provision.description,
      health: provision.health,
      id: provision.id,
      kind: provision.kind,
      lifetime: provision.lifetime,
      usedBy: provision.usedBy,
    })),
  };
};

const buildTrailDetailFromStore = (
  detail: ReturnType<ReturnType<typeof createTopoStore>['trails']['get']>
): CurrentTrailDetail => ({
  crosses: [...(detail?.crosses ?? [])],
  description: detail?.description ?? null,
  detours: detail?.detours ?? null,
  examples: [...(detail?.examples ?? [])],
  id: detail?.id ?? '',
  intent: detail?.intent ?? 'write',
  kind: detail?.kind ?? 'trail',
  provisions: [...(detail?.provisions ?? [])],
  safety: detail?.safety ?? '-',
});

const buildProvisionDetailFromStore = (
  provision: NonNullable<
    ReturnType<ReturnType<typeof createTopoStore>['provisions']['get']>
  >
): CurrentProvisionDetail => ({
  description: provision.description,
  health: provision.health,
  id: provision.id,
  kind: provision.kind,
  lifetime: provision.lifetime,
  usedBy: [...provision.usedBy],
});

// ---------------------------------------------------------------------------
// withCurrentTopoStore
// ---------------------------------------------------------------------------

/**
 * Run a read callback against the latest topo store state.
 *
 * Uses the most recent existing save when available, only creating a new save
 * when no prior save exists. This avoids unbounded save accumulation from
 * read-only operations like survey, guide, and show.
 */
const withCurrentTopoStore = <T>(
  app: Topo,
  rootDir: string,
  read: (
    store: ReturnType<typeof createTopoStore>,
    ref: ReturnType<typeof topoStoreRef>,
    save: TopoSaveRecord
  ) => T
): T => {
  const dbPath = resolveTrailsDbPath({ rootDir });
  const existingSave = existsSync(dbPath)
    ? (() => {
        const db = openReadTrailsDb({ rootDir });
        try {
          return listTopoSaves(db)[0];
        } finally {
          db.close();
        }
      })()
    : undefined;

  const save = existingSave ?? createCurrentTopoSave(app, { rootDir });
  const store = createTopoStore({ rootDir });
  return read(store, topoStoreRef(save.id), save);
};

// ---------------------------------------------------------------------------
// Public read-only consumers
// ---------------------------------------------------------------------------

export const buildTopoSummary = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSummaryReport => {
  const rootDir = resolveRootDir(options?.rootDir);
  const trailsDir = resolveTrailsDir({ rootDir });
  return withCurrentTopoStore(app, rootDir, (store, ref, save) => ({
    app: buildBriefReportFromStore(app, store, ref, save),
    dbPath: resolveTrailsDbPath({ rootDir }),
    list: buildSurveyListFromStore(store, ref),
    lockExists: hasCommittedLock(trailsDir),
    lockPath: LOCK_PATH,
  }));
};

export const buildCurrentTopoBrief = (
  app: Topo,
  options?: { readonly rootDir?: string }
): BriefReport => {
  const rootDir = resolveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref, save) =>
    buildBriefReportFromStore(app, store, ref, save)
  );
};

export const buildCurrentTopoList = (
  app: Topo,
  options?: { readonly rootDir?: string }
): SurveyListReport => {
  const rootDir = resolveRootDir(options?.rootDir);
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
  readonly kind: string;
}[] => {
  const rootDir = resolveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref) =>
    store.trails.list({ save: ref }).map((trail) => ({
      description: trail.description ?? '(no description)',
      exampleCount: trail.exampleCount,
      id: trail.id,
      kind: trail.kind,
    }))
  );
};

export const buildCurrentTopoDetail = (
  app: Topo,
  id: string,
  options?: { readonly rootDir?: string }
): CurrentProvisionDetail | CurrentTrailDetail | undefined => {
  const rootDir = resolveRootDir(options?.rootDir);
  return withCurrentTopoStore(app, rootDir, (store, ref) => {
    const trail = store.trails.get(id, { save: ref });
    if (trail !== undefined) {
      return buildTrailDetailFromStore(trail);
    }

    const provision = store.provisions.get(id, { save: ref });
    return provision === undefined
      ? undefined
      : buildProvisionDetailFromStore(provision);
  });
};

export const verifyCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoVerifyReport, Error>> => {
  const rootDir = resolveRootDir(options?.rootDir);
  const committedLock = await readTrailheadLockData({
    dir: resolveTrailsDir({ rootDir }),
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
    (store, ref) => store.exports.get(ref)?.trailheadHash
  );

  if (currentHash === undefined) {
    return Result.err(
      new InternalError('No stored topo export found for the current topo save')
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
