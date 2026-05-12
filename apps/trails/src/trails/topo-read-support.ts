/**
 * Read-only live topo consumer helpers.
 *
 * Extracted from topo-support.ts to isolate read-only topo consumer helpers,
 * keeping module boundaries clean.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Topo, TrailContext } from '@ontrails/core';
import {
  ConflictError,
  deriveTrailsDbPath,
  deriveTrailsDir,
  NotFoundError,
  Result,
  SURFACE_LAYER_NAMES_KEY,
  ValidationError,
} from '@ontrails/core';
import { readLockManifest } from '@ontrails/topographer';

import type {
  BriefReport,
  SignalDetailReport,
  SurfaceLayerNames,
  SurveyListReport,
} from './topo-reports.js';
import {
  deriveBriefReport,
  deriveResourceDetail,
  deriveSignalDetail,
  deriveSurveyList,
  deriveTrailDetail,
} from './topo-reports.js';
import type {
  ActivationEdgeReport,
  ActivationGraphReport,
  ActivationSourceReport,
} from './topo-activation.js';
import { deriveActivationGraph } from './topo-activation.js';
import type { TopoSummaryReport, TopoVerifyReport } from './topo-support.js';
import { deriveRootDir, LOCK_PATH } from './topo-support.js';
import { deriveCurrentTopoExport } from './topo-store-support.js';

export interface CurrentTrailDetail {
  readonly activatedBy: readonly string[];
  readonly activates: readonly string[];
  readonly activationChains: readonly {
    readonly consumer: string;
    readonly producer: string;
    readonly signal: string;
  }[];
  readonly activationEdges: readonly ActivationEdgeReport[];
  readonly activationSources: readonly ActivationSourceReport[];
  readonly composedLayers: {
    readonly topo: readonly string[];
    readonly trail: readonly string[];
    readonly surface: {
      readonly cli: readonly string[];
      readonly http: readonly string[];
      readonly mcp: readonly string[];
    };
  };
  readonly crosses: readonly string[];
  readonly description: string | null;
  readonly detours:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | null;
  readonly examples: readonly unknown[];
  readonly fires: readonly string[];
  readonly id: string;
  readonly intent: 'destroy' | 'read' | 'write';
  readonly kind: 'trail';
  readonly on: readonly string[];
  readonly pattern: string | null;
  readonly resources: readonly string[];
  readonly safety: string;
}

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

// ---------------------------------------------------------------------------
// Public read-only consumers
// ---------------------------------------------------------------------------

export const buildTopoSummary = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSummaryReport => {
  const rootDir = deriveRootDir(options?.rootDir);
  const trailsDir = deriveTrailsDir({ rootDir });
  return {
    app: deriveBriefReport(app),
    dbPath: deriveTrailsDbPath({ rootDir }),
    list: deriveSurveyList(app),
    lockExists: hasCommittedLock(trailsDir),
    lockPath: LOCK_PATH,
  };
};

export const buildCurrentTopoBrief = (
  app: Topo,
  _options?: { readonly rootDir?: string }
): BriefReport => deriveBriefReport(app);

export const buildCurrentTopoList = (
  app: Topo,
  _options?: { readonly rootDir?: string }
): SurveyListReport => deriveSurveyList(app);

export const buildCurrentGuideEntries = (
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
      exampleCount: trail.examples?.length ?? 0,
      id: trail.id,
      kind: 'trail' as const,
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

export const buildCurrentTrailDetail = (
  app: Topo,
  id: string,
  options?: CurrentTopoReadOptions
): CurrentTrailDetail | undefined => {
  const trail = app.get(id);
  return trail === undefined
    ? undefined
    : deriveTrailDetail(trail, app, undefined, {
        surfaceLayerNames: options?.surfaceLayerNames,
      });
};

export const buildCurrentResourceDetail = (
  app: Topo,
  id: string,
  _options?: { readonly rootDir?: string }
): CurrentResourceDetail | undefined =>
  app.getResource(id) === undefined
    ? undefined
    : (deriveResourceDetail(app, id) as CurrentResourceDetail);

export const buildCurrentSignalDetail = (
  app: Topo,
  id: string,
  _options?: { readonly rootDir?: string }
): SignalDetailReport | undefined => deriveSignalDetail(app, id);

export const buildCurrentTopoDetail = (
  app: Topo,
  id: string,
  options?: CurrentTopoReadOptions
): CurrentTopoDetail | undefined =>
  buildCurrentTrailDetail(app, id, options) ??
  buildCurrentResourceDetail(app, id) ??
  buildCurrentSignalDetail(app, id);

export const buildCurrentTopoMatches = (
  app: Topo,
  id: string,
  options?: CurrentTopoReadOptions
): readonly CurrentTopoMatch[] => {
  const matches: CurrentTopoMatch[] = [];
  let activationGraph: ActivationGraphReport | undefined;
  const getActivationGraph = (): ActivationGraphReport =>
    (activationGraph ??= deriveActivationGraph(app));

  const trail = app.get(id);
  if (trail !== undefined) {
    matches.push({
      detail: deriveTrailDetail(trail, app, getActivationGraph(), {
        surfaceLayerNames: options?.surfaceLayerNames,
      }),
      kind: 'trail',
    });
  }

  const resource = buildCurrentResourceDetail(app, id);
  if (resource !== undefined) {
    matches.push({ detail: resource, kind: 'resource' });
  }

  const signal = deriveSignalDetail(app, id, activationGraph);
  if (signal !== undefined) {
    matches.push({ detail: signal, kind: 'signal' });
  }

  return matches;
};

export const verifyCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoVerifyReport, Error>> => {
  const rootDir = deriveRootDir(options?.rootDir);
  let lockManifest: Awaited<ReturnType<typeof readLockManifest>>;
  try {
    lockManifest = await readLockManifest({
      dir: deriveTrailsDir({ rootDir }),
    });
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

  if (lockManifest === null) {
    return Result.err(
      new NotFoundError(
        'No committed trails.lock found. Run `trails topo compile` first.'
      )
    );
  }

  const currentExport = deriveCurrentTopoExport(app, { rootDir });
  if (currentExport.isErr()) {
    return currentExport;
  }
  const currentHash = currentExport.value.topoGraphHash;
  const topoArtifact = lockManifest.artifacts.find(
    (artifact) => artifact.role === 'topo' && artifact.path === 'topo.lock'
  );
  if (topoArtifact === undefined) {
    return Result.err(
      new NotFoundError(
        'No topo.lock artifact found in trails.lock. Run `trails topo compile` first.'
      )
    );
  }

  if (topoArtifact.sha256 !== currentHash) {
    return Result.err(
      new ConflictError(
        'trails.lock is stale. Run `trails topo compile` to refresh it.'
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
