/**
 * Read-only live topo consumer helpers.
 *
 * Extracted from topo-support.ts to isolate read-only topo consumer helpers,
 * keeping module boundaries clean.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CliCommandAliasInput, Topo, TrailContext } from '@ontrails/core';
import {
  ConflictError,
  deriveTrailsDbPath,
  deriveTrailsDir,
  NotFoundError,
  Result,
  SURFACE_LAYER_NAMES_KEY,
  ValidationError,
} from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  readLockManifest,
  readTopoGraph,
  readTrailsLock,
  stripTopoGraphForces,
} from '@ontrails/topographer';
import type { LockManifest, TopoGraph } from '@ontrails/topographer';

import type {
  BriefReport,
  SignalDetailReport,
  SurfaceLayerNames,
  SurveyListReport,
  TrailDetailReport,
} from './topo-reports.js';
import {
  countTrailExamples,
  deriveBriefReport,
  deriveResourceDetail,
  deriveSignalDetail,
  deriveSurveyList,
  deriveTrailDetail,
} from './topo-reports.js';
import type { ActivationGraphReport } from './topo-activation.js';
import { deriveActivationGraph } from './topo-activation.js';
import type { TopoSummaryReport, TopoValidateReport } from './topo-support.js';
import { deriveRootDir, LOCK_PATH } from './topo-support.js';
import { deriveCurrentTopoExport } from './topo-store-support.js';

export type CurrentTrailDetail = TrailDetailReport;

export interface CurrentResourceDetail {
  readonly description: string | null;
  readonly health: 'available' | 'none';
  readonly id: string;
  readonly kind: 'resource';
  readonly lifetime: 'singleton';
  readonly usedBy: readonly string[];
}

export type CurrentTopoDetail =
  | CurrentResourceDetail
  | CurrentTrailDetail
  | SignalDetailReport;

export interface CurrentTopoMatch {
  readonly kind: CurrentTopoDetail['kind'];
  readonly detail: CurrentTopoDetail;
}

export interface CurrentTopoReadOptions {
  readonly cliAliases?:
    | Readonly<Record<string, readonly CliCommandAliasInput[]>>
    | undefined;
  readonly rootDir?: string | undefined;
  readonly surfaceLayerNames?: Partial<SurfaceLayerNames> | undefined;
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const readSurfaceLayerNamesFromContext = (
  ctx: TrailContext
): Partial<SurfaceLayerNames> => {
  const value = ctx.extensions?.[SURFACE_LAYER_NAMES_KEY];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  return {
    ...(isStringArray(raw['cli']) ? { cli: raw['cli'] } : {}),
    ...(isStringArray(raw['http']) ? { http: raw['http'] } : {}),
    ...(isStringArray(raw['mcp']) ? { mcp: raw['mcp'] } : {}),
  };
};

const hasCommittedLock = (trailsDir: string): boolean =>
  existsSync(join(trailsDir, 'trails.lock'));

const readCommittedLock = async (
  rootDir: string
): Promise<{
  readonly lockManifest: LockManifest;
  readonly topoGraph: TopoGraph;
} | null> => {
  const trailsLock = await readTrailsLock({ dir: rootDir });
  if (trailsLock !== null) {
    return {
      lockManifest: {
        artifacts: [
          {
            path: 'topo.lock',
            role: 'topo',
            sha256: trailsLock.topoGraphHash,
          },
        ],
        scope: trailsLock.scope,
        summary: trailsLock.summary,
        version: 3,
      },
      topoGraph: trailsLock.topoGraph as TopoGraph,
    };
  }

  const legacyDir = deriveTrailsDir({ rootDir });
  const legacyManifest = await readLockManifest({ dir: legacyDir });
  if (legacyManifest === null) {
    return null;
  }
  const legacyTopoGraph = await readTopoGraph({ dir: legacyDir });
  if (legacyTopoGraph === null) {
    return null;
  }
  return {
    lockManifest: legacyManifest,
    topoGraph: legacyTopoGraph,
  };
};

// ---------------------------------------------------------------------------
// Public read-only consumers
// ---------------------------------------------------------------------------

export const deriveTopoSummary = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSummaryReport => {
  const rootDir = deriveRootDir(options?.rootDir);
  return {
    app: deriveBriefReport(app),
    dbPath: deriveTrailsDbPath({ rootDir }),
    list: deriveSurveyList(app),
    lockExists:
      hasCommittedLock(rootDir) ||
      hasCommittedLock(deriveTrailsDir({ rootDir })),
    lockPath: LOCK_PATH,
  };
};

export const deriveCurrentTopoBrief = (
  app: Topo,
  _options?: { readonly rootDir?: string }
): BriefReport => deriveBriefReport(app);

export const deriveCurrentTopoList = (
  app: Topo,
  _options?: { readonly rootDir?: string }
): SurveyListReport => deriveSurveyList(app);

export const deriveCurrentGuideEntries = (
  app: Topo,
  _options?: { readonly rootDir?: string }
): readonly {
  readonly description: string;
  readonly exampleCount: number;
  readonly id: string;
  readonly kind: 'trail';
}[] =>
  app
    .list()
    .map((trail) => ({
      description: trail.description ?? '(no description)',
      exampleCount: countTrailExamples(trail),
      id: trail.id,
      kind: 'trail' as const,
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

export const deriveCurrentTrailDetail = (
  app: Topo,
  id: string,
  options?: CurrentTopoReadOptions
): CurrentTrailDetail | undefined => {
  const trail = app.get(id);
  return trail === undefined
    ? undefined
    : deriveTrailDetail(trail, app, undefined, {
        surfaceLayerNames: options?.surfaceLayerNames,
        topoGraph: deriveTopoGraph(app, { cliAliases: options?.cliAliases }),
      });
};

export const deriveCurrentResourceDetail = (
  app: Topo,
  id: string,
  _options?: { readonly rootDir?: string }
): CurrentResourceDetail | undefined =>
  app.getResource(id) === undefined
    ? undefined
    : (deriveResourceDetail(app, id) as CurrentResourceDetail);

export const deriveCurrentSignalDetail = (
  app: Topo,
  id: string,
  _options?: { readonly rootDir?: string }
): SignalDetailReport | undefined => deriveSignalDetail(app, id);

export const deriveCurrentTopoDetail = (
  app: Topo,
  id: string,
  options?: CurrentTopoReadOptions
): CurrentTopoDetail | undefined =>
  deriveCurrentTrailDetail(app, id, options) ??
  deriveCurrentResourceDetail(app, id) ??
  deriveCurrentSignalDetail(app, id);

export const deriveCurrentTopoMatches = (
  app: Topo,
  id: string,
  options?: CurrentTopoReadOptions
): readonly CurrentTopoMatch[] => {
  const matches: CurrentTopoMatch[] = [];
  let activationGraph: ActivationGraphReport | undefined;
  const getActivationGraph = (): ActivationGraphReport =>
    (activationGraph ??= deriveActivationGraph(app));
  let topoGraph: ReturnType<typeof deriveTopoGraph> | undefined;
  const getTopoGraph = (): ReturnType<typeof deriveTopoGraph> =>
    (topoGraph ??= deriveTopoGraph(app, { cliAliases: options?.cliAliases }));

  const trail = app.get(id);
  if (trail !== undefined) {
    matches.push({
      detail: deriveTrailDetail(trail, app, getActivationGraph(), {
        surfaceLayerNames: options?.surfaceLayerNames,
        topoGraph: getTopoGraph(),
      }),
      kind: 'trail',
    });
  }

  const resource = deriveCurrentResourceDetail(app, id);
  if (resource !== undefined) {
    matches.push({ detail: resource, kind: 'resource' });
  }

  const signal = deriveSignalDetail(app, id, activationGraph);
  if (signal !== undefined) {
    matches.push({ detail: signal, kind: 'signal' });
  }

  return matches;
};

export const validateCurrentTopo = async (
  app: Topo,
  options?: {
    readonly cliAliases?:
      | Readonly<Record<string, readonly CliCommandAliasInput[]>>
      | undefined;
    readonly rootDir?: string;
  }
): Promise<Result<TopoValidateReport, Error>> => {
  const rootDir = deriveRootDir(options?.rootDir);
  let committedLock: Awaited<ReturnType<typeof readCommittedLock>>;
  try {
    committedLock = await readCommittedLock(rootDir);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to read committed trails.lock manifest.';
    return Result.err(
      error instanceof Error
        ? new ValidationError(message, { cause: error })
        : new ValidationError(message)
    );
  }

  if (committedLock === null) {
    return Result.err(
      new NotFoundError(
        'No committed trails.lock found. Run `trails compile` first.'
      )
    );
  }

  const currentExport = deriveCurrentTopoExport(app, {
    cliAliases: options?.cliAliases,
    rootDir,
  });
  if (currentExport.isErr()) {
    return currentExport;
  }
  const currentTopo = JSON.parse(
    currentExport.value.topoGraphJson
  ) as TopoGraph;
  const currentHash = currentExport.value.topoGraphHash;
  const topoArtifact = committedLock.lockManifest.artifacts.find(
    (artifact) => artifact.role === 'topo' && artifact.path === 'topo.lock'
  );
  if (topoArtifact === undefined) {
    return Result.err(
      new NotFoundError(
        'No topo.lock artifact found in trails.lock. Run `trails compile` first.'
      )
    );
  }

  const committedTopo = committedLock.topoGraph;
  const committedHash = deriveTopoGraphHash(committedTopo);
  if (committedHash !== topoArtifact.sha256) {
    return Result.err(
      new ValidationError(
        'trails.lock graph hash does not match its embedded TopoGraph. Run `trails compile` to refresh it.'
      )
    );
  }

  if (topoArtifact.sha256 !== currentHash) {
    const forceStrippedHash = deriveTopoGraphHash(
      stripTopoGraphForces(committedTopo)
    );
    if (forceStrippedHash === currentHash) {
      return Result.ok({
        committedHash: topoArtifact.sha256,
        currentHash,
        lockPath: LOCK_PATH,
        stale: false,
      });
    }
    const breakingSummary = (() => {
      const diff = deriveTopoGraphDiff(committedTopo, currentTopo);
      return diff.breaking.length > 0
        ? ` Breaking changes detected: ${diff.breaking.length}.`
        : '';
    })();
    return Result.err(
      new ConflictError(
        `trails.lock is stale. Run \`trails compile\` to refresh it.${breakingSummary}`
      )
    );
  }

  return Result.ok({
    committedHash: topoArtifact.sha256,
    currentHash,
    lockPath: LOCK_PATH,
    stale: false,
  });
};
