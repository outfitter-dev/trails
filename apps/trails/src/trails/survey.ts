/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, looks up trails/resources/signals, and diffs against previous
 * versions.
 */

import { extname, join } from 'node:path';

import type { Topo } from '@ontrails/core';
import {
  createTopoStore,
  deriveSafePath,
  NotFoundError,
  Result,
  trail,
  ValidationError,
} from '@ontrails/core';
import type { DiffEntry, DiffResult, SurfaceMap } from '@ontrails/schema';
import {
  deriveSurfaceMapDiff,
  deriveSurfaceMap,
  readSurfaceMap,
} from '@ontrails/schema';
import { z } from 'zod';

import { writeIsolatedExampleJsonFile } from '../local-state-io.js';

import { loadFreshAppLease } from './load-app.js';
import {
  buildCurrentTopoBrief,
  buildCurrentTopoList,
  buildCurrentTopoMatches,
  buildCurrentTrailDetail,
  buildCurrentResourceDetail,
  buildCurrentSignalDetail,
} from './topo-read-support.js';
import {
  resourceDetailOutput,
  signalDetailOutput,
  trailDetailOutput,
} from './topo-output-schemas.js';
import { createIsolatedExampleInput } from './topo-support.js';
import { briefReportSchema } from './topo-reports.js';

export {
  briefReportSchema,
  deriveBriefReport,
  deriveResourceDetail,
  deriveSignalDetail,
  deriveSurveyList,
  deriveTrailDetail,
} from './topo-reports.js';
export type {
  BriefReport,
  SignalDetailReport,
  SurveyListReport,
  TrailDetailReport,
} from './topo-reports.js';

// ---------------------------------------------------------------------------
// Survey diff helpers
// ---------------------------------------------------------------------------

interface SurveyDiffReport {
  readonly against: string;
  readonly breaking: readonly DiffEntry[];
  readonly hasBreaking: boolean;
  readonly info: readonly DiffEntry[];
  readonly mode: 'diff';
  readonly warnings: readonly DiffEntry[];
}

const formatDiff = (diff: DiffResult, against: string): SurveyDiffReport => ({
  against,
  breaking: diff.breaking,
  hasBreaking: diff.hasBreaking,
  info: diff.info,
  mode: 'diff',
  warnings: diff.warnings,
});

const createDiffExampleInput = (): {
  readonly against: string;
  readonly module: string;
  readonly rootDir: string;
} => {
  const input = createIsolatedExampleInput('survey-diff');
  writeIsolatedExampleJsonFile(input.rootDir, 'baseline/_surface.json', {
    entries: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    version: '1.0',
  } satisfies SurfaceMap);
  return { ...input, against: 'baseline' };
};

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

const readSurfaceMapFile = async (
  filePath: string
): Promise<SurfaceMap | null> => {
  try {
    return (await Bun.file(filePath).json()) as SurfaceMap;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
};

const readStoredSurfaceMap = (
  rootDir: string,
  against: string
): SurfaceMap | undefined => {
  try {
    const store = createTopoStore({ rootDir });
    const stored =
      store.exports.get({ pin: against }) ??
      store.exports.get({ snapshotId: against });
    return stored === undefined
      ? undefined
      : (JSON.parse(stored.surfaceMapJson) as SurfaceMap);
  } catch (error: unknown) {
    if (error instanceof NotFoundError) {
      return undefined;
    }
    throw error;
  }
};

const readPathSurfaceMap = async (
  rootDir: string,
  against: string
): Promise<Result<SurfaceMap | null, Error>> => {
  const safePath = deriveSafePath(rootDir, against);
  if (safePath.isErr()) {
    return safePath;
  }

  return Result.ok(
    extname(safePath.value) === '.json'
      ? await readSurfaceMapFile(safePath.value)
      : await readSurfaceMap({ dir: safePath.value })
  );
};

const readAgainstSurfaceMap = async (
  rootDir: string,
  against?: string | undefined
): Promise<Result<{ against: string; map: SurfaceMap }, Error>> => {
  if (against === undefined || against === 'saved') {
    const map = await readSurfaceMap({ dir: join(rootDir, '.trails') });
    return map === null
      ? Result.err(
          new NotFoundError(
            'No saved surface map found. Run `trails topo compile` first.'
          )
        )
      : Result.ok({ against: 'saved', map });
  }

  // Treat explicit filesystem targets as the most local user intent; stored
  // pins and snapshot ids are fallback references when no path exists.
  const pathMap = await readPathSurfaceMap(rootDir, against);
  if (pathMap.isErr()) {
    return pathMap;
  }
  if (pathMap.value !== null) {
    return Result.ok({ against, map: pathMap.value });
  }

  const storedMap = readStoredSurfaceMap(rootDir, against);
  if (storedMap !== undefined) {
    return Result.ok({ against, map: storedMap });
  }

  return Result.err(new NotFoundError(`No surface map found for: ${against}`));
};

const buildSurveyDiff = async (
  app: Topo,
  rootDir: string,
  breakingOnly: boolean,
  against?: string | undefined
): Promise<Result<SurveyDiffReport, Error>> => {
  const currentMap = deriveSurfaceMap(app);
  const previous = await readAgainstSurfaceMap(rootDir, against);
  if (previous.isErr()) {
    return previous;
  }

  const diff = deriveSurfaceMapDiff(previous.value.map, currentMap);
  return Result.ok(
    breakingOnly
      ? formatDiff({ ...diff, info: [], warnings: [] }, previous.value.against)
      : formatDiff(diff, previous.value.against)
  );
};

const buildSurveyLookup = (
  app: Topo,
  entityId: string,
  rootDir: string
): Result<object, Error> => {
  const matches = buildCurrentTopoMatches(app, entityId, { rootDir });
  return Result.ok({ matches });
};

const buildSurveyTrailDetail = (
  app: Topo,
  id: string,
  rootDir: string
): Result<object, Error> => {
  const detail = buildCurrentTrailDetail(app, id, { rootDir });
  return detail === undefined
    ? Result.err(new NotFoundError(`Trail not found: ${id}`))
    : Result.ok(detail);
};

const buildSurveyResourceDetail = (
  app: Topo,
  id: string,
  rootDir: string
): Result<object, Error> => {
  const detail = buildCurrentResourceDetail(app, id, { rootDir });
  return detail === undefined
    ? Result.err(new NotFoundError(`Resource not found: ${id}`))
    : Result.ok(detail);
};

const buildSurveySignalDetail = (
  app: Topo,
  id: string,
  rootDir: string
): Result<object, Error> => {
  const detail = buildCurrentSignalDetail(app, id, { rootDir });
  return detail === undefined
    ? Result.err(new NotFoundError(`Signal not found: ${id}`))
    : Result.ok(detail);
};

interface SurveyInput {
  id?: string | undefined;
  module?: string | undefined;
  rootDir?: string | undefined;
}

type SurveyMode = 'lookup' | 'overview';

type SurveyEnvelope = { readonly mode: SurveyMode } & Record<string, unknown>;

/** Determine which survey mode was requested, falling back to 'overview'. */
const deriveSurveyMode = (input: SurveyInput): SurveyMode =>
  input.id === undefined || input.id === '' ? 'overview' : 'lookup';

type SurveyHandler = (
  app: Topo,
  input: SurveyInput,
  rootDir: string
) => Result<object, Error> | Promise<Result<object, Error>>;

/** Handlers keyed by survey mode. */
const surveyHandlers: Record<SurveyMode, SurveyHandler> = {
  lookup: (app, input, rootDir) =>
    input.id === undefined || input.id === ''
      ? Result.err(new ValidationError('Survey lookup requires an id'))
      : buildSurveyLookup(app, input.id, rootDir),
  overview: (app, _input, rootDir) =>
    Result.ok(buildCurrentTopoList(app, { rootDir })),
};

const envelopeSurveyValue = (
  mode: SurveyMode,
  value: object
): SurveyEnvelope => ({ ...value, mode });

/** Dispatch to the appropriate survey sub-command based on input flags. */
const dispatchSurvey = async (
  app: Topo,
  input: SurveyInput,
  rootDir: string
): Promise<Result<SurveyEnvelope, Error>> => {
  const mode = deriveSurveyMode(input);
  const handler = surveyHandlers[mode];
  const result = await handler(app, input, rootDir);
  if (result.isErr()) {
    return result;
  }
  return Result.ok(envelopeSurveyValue(mode, result.value));
};

const detailInputSchema = z.object({
  id: z.string().describe('Trail, resource, or signal ID'),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const resolveRootDir = (
  input: { readonly rootDir?: string | undefined },
  cwd?: string | undefined
): string => input.rootDir ?? cwd ?? process.cwd();

const withFreshSurveyApp = async <T>(
  input: { readonly module?: string | undefined },
  rootDir: string,
  consume: (app: Topo) => Promise<Result<T, Error>> | Result<T, Error>
): Promise<Result<T, Error>> => {
  const lease = await loadFreshAppLease(input.module, rootDir);
  try {
    return await consume(lease.app);
  } finally {
    lease.release();
  }
};

const moduleInputSchema = z.object({
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const diffEntryOutput = z.object({
  change: z.enum(['added', 'removed', 'modified']),
  details: z.array(z.string()).readonly(),
  id: z.string(),
  kind: z.enum(['contour', 'trail', 'signal', 'resource']),
  severity: z.enum(['info', 'warning', 'breaking']),
});

const diffOutput = z.object({
  against: z.string(),
  breaking: z.array(diffEntryOutput),
  hasBreaking: z.boolean(),
  info: z.array(diffEntryOutput),
  mode: z.literal('diff'),
  warnings: z.array(diffEntryOutput),
});

const surveyMatchOutput = z.discriminatedUnion('kind', [
  z.object({
    detail: trailDetailOutput,
    kind: z.literal('trail'),
  }),
  z.object({
    detail: resourceDetailOutput,
    kind: z.literal('resource'),
  }),
  z.object({
    detail: signalDetailOutput,
    kind: z.literal('signal'),
  }),
]);

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const surveyTrail = trail('survey', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDir = resolveRootDir(input, ctx.cwd);
    return withFreshSurveyApp(input, rootDir, (app) =>
      dispatchSurvey(app, input, rootDir)
    );
  },
  description: 'Full topo introspection',
  examples: [
    {
      description: 'Show all registered trails, resources, and signals',
      input: createIsolatedExampleInput('survey-overview'),
      name: 'Overview',
    },
    {
      description: 'Find every trail, resource, or signal with a matching ID',
      input: { ...createIsolatedExampleInput('survey-lookup'), id: 'survey' },
      name: 'Lookup by ID',
    },
  ],
  input: z.object({
    id: z
      .string()
      .optional()
      .describe('Trail, resource, or signal ID to look up'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.discriminatedUnion('mode', [
    z.object({
      count: z.number(),
      entries: z.array(
        z.object({
          examples: z.number(),
          id: z.string(),
          kind: z.string(),
          safety: z.string(),
        })
      ),
      mode: z.literal('overview'),
      resourceCount: z.number(),
      resources: z.array(
        z.object({
          description: z.string().nullable(),
          health: z.enum(['available', 'none']),
          id: z.string(),
          kind: z.literal('resource'),
          lifetime: z.literal('singleton'),
          usedBy: z.array(z.string()),
        })
      ),
      signalCount: z.number(),
      signals: z.array(
        z.object({
          consumers: z.array(z.string()).readonly(),
          description: z.string().nullable(),
          examples: z.number(),
          from: z.array(z.string()).readonly(),
          id: z.string(),
          kind: z.literal('signal'),
          payloadSchema: z.boolean(),
          producers: z.array(z.string()).readonly(),
        })
      ),
    }),
    z.object({
      matches: z.array(surveyMatchOutput),
      mode: z.literal('lookup'),
    }),
  ]),
});

export const surveyBriefTrail = trail('survey.brief', {
  blaze: async (input, ctx) => {
    const rootDir = resolveRootDir(input, ctx.cwd);
    return withFreshSurveyApp(input, rootDir, (app) =>
      Result.ok(buildCurrentTopoBrief(app, { rootDir }))
    );
  },
  description: 'Summarize topo capabilities',
  examples: [
    {
      description: 'Show counts and feature flags',
      input: createIsolatedExampleInput('survey-brief'),
      name: 'Brief capability report',
    },
  ],
  input: moduleInputSchema,
  intent: 'read',
  output: briefReportSchema,
});

export const surveyDiffTrail = trail('survey.diff', {
  blaze: async (input, ctx) => {
    const rootDir = resolveRootDir(input, ctx.cwd);
    return withFreshSurveyApp(input, rootDir, (app) =>
      buildSurveyDiff(app, rootDir, input.breakingOnly, input.against)
    );
  },
  description: 'Diff the current topo against a saved surface map',
  examples: [
    {
      description: 'Compare current topo to a saved surface map directory',
      input: createDiffExampleInput(),
      name: 'Diff against baseline',
    },
    {
      description: 'Reject an empty saved map target',
      error: 'ValidationError',
      input: { against: '' },
      name: 'Reject empty diff target',
    },
    {
      description: 'Reject an empty target before filtering breaking drift',
      error: 'ValidationError',
      input: {
        against: '',
        breakingOnly: true,
      },
      name: 'Reject empty breaking-only target',
    },
  ],
  input: z.object({
    against: z
      .string()
      .min(1)
      .optional()
      .describe('Saved map target: "saved", a pin/snapshot id, or a path'),
    breakingOnly: z
      .boolean()
      .default(false)
      .describe('Only show breaking changes'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: diffOutput,
});

export const surveyTrailDetailTrail = trail('survey.trail', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDir = resolveRootDir(input, ctx.cwd);
    return withFreshSurveyApp(input, rootDir, (app) =>
      buildSurveyTrailDetail(app, input.id, rootDir)
    );
  },
  description: 'Inspect one trail by ID',
  examples: [
    {
      description: 'Show trail contract detail',
      input: {
        ...createIsolatedExampleInput('survey-trail-detail'),
        id: 'survey',
      },
      name: 'Trail detail',
    },
  ],
  input: detailInputSchema,
  intent: 'read',
  output: trailDetailOutput,
});

export const surveyResourceTrail = trail('survey.resource', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDir = resolveRootDir(input, ctx.cwd);
    return withFreshSurveyApp(input, rootDir, (app) =>
      buildSurveyResourceDetail(app, input.id, rootDir)
    );
  },
  description: 'Inspect one resource by ID',
  examples: [
    {
      description: 'Show resource usage detail',
      error: 'NotFoundError',
      input: {
        ...createIsolatedExampleInput('survey-resource-detail'),
        id: 'db.main',
      },
      name: 'Resource detail',
    },
  ],
  input: detailInputSchema,
  intent: 'read',
  output: resourceDetailOutput,
});

export const surveySignalTrail = trail('survey.signal', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDir = resolveRootDir(input, ctx.cwd);
    return withFreshSurveyApp(input, rootDir, (app) =>
      buildSurveySignalDetail(app, input.id, rootDir)
    );
  },
  description: 'Inspect one signal by ID',
  examples: [
    {
      description: 'Show signal producer and consumer detail',
      error: 'NotFoundError',
      input: {
        ...createIsolatedExampleInput('survey-signal-detail'),
        id: 'hello.greeted',
      },
      name: 'Signal detail',
    },
  ],
  input: detailInputSchema,
  intent: 'read',
  output: signalDetailOutput,
});
