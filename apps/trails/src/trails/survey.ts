/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, looks up trails/resources/signals, generates surface maps,
 * and diffs against previous versions.
 */

import { join } from 'node:path';

import type { Topo } from '@ontrails/core';
import { NotFoundError, Result, trail, ValidationError } from '@ontrails/core';
import type { DiffResult } from '@ontrails/schema';
import {
  deriveSurfaceMapDiff,
  deriveSurfaceMap,
  readSurfaceMap,
} from '@ontrails/schema';
import { z } from 'zod';

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
import { exportCurrentTopo } from './topo-store-support.js';

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

const formatDiff = (diff: DiffResult): object => ({
  breaking: diff.breaking,
  hasBreaking: diff.hasBreaking,
  info: diff.info,
  warnings: diff.warnings,
});

const buildSurveyDiff = async (
  app: Topo,
  rootDir: string,
  breakingOnly: boolean
): Promise<Result<object, Error>> => {
  const currentMap = deriveSurfaceMap(app);
  const previousMap = await readSurfaceMap({ dir: join(rootDir, '.trails') });
  if (!previousMap) {
    return Result.err(
      new NotFoundError(
        'No saved surface map found. Run `trails topo export` first.'
      )
    );
  }

  const diff = deriveSurfaceMapDiff(previousMap, currentMap);
  return Result.ok(
    breakingOnly
      ? formatDiff({ ...diff, info: [], warnings: [] })
      : formatDiff(diff)
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

const buildSurveyGenerate = async (
  app: Topo,
  rootDir: string
): Promise<Result<object, Error>> => {
  const exported = await exportCurrentTopo(app, { rootDir });
  if (exported.isErr()) {
    return exported;
  }
  return Result.ok({
    hash: exported.value.hash,
    lockPath: exported.value.lockPath,
    mapPath: exported.value.mapPath,
  });
};

interface SurveyInput {
  breakingOnly: boolean;
  diffSaved: boolean;
  generate: boolean;
  id?: string | undefined;
  module?: string | undefined;
  rootDir?: string | undefined;
}

type SurveyMode = 'diff' | 'generate' | 'lookup' | 'overview';

type SurveyEnvelope = { readonly mode: SurveyMode } & Record<string, unknown>;

/** Ordered mode checks — first truthy predicate wins, otherwise 'overview'. */
const modeChecks: readonly [(input: SurveyInput) => boolean, SurveyMode][] = [
  [(i) => i.diffSaved, 'diff'],
  [(i) => Boolean(i.id), 'lookup'],
  [(i) => i.generate, 'generate'],
];

/** Determine which survey mode was requested, falling back to 'overview'. */
const deriveSurveyMode = (input: SurveyInput): SurveyMode =>
  modeChecks.find(([predicate]) => predicate(input))?.[1] ?? 'overview';

type SurveyHandler = (
  app: Topo,
  input: SurveyInput,
  rootDir: string
) => Result<object, Error> | Promise<Result<object, Error>>;

/** Handlers keyed by survey mode. */
const surveyHandlers: Record<SurveyMode, SurveyHandler> = {
  diff: (app, input, rootDir) =>
    buildSurveyDiff(app, rootDir, input.breakingOnly),
  generate: (app, _input, rootDir) => buildSurveyGenerate(app, rootDir),
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
    breakingOnly: z
      .boolean()
      .default(false)
      .describe('Only show breaking changes'),
    diffSaved: z
      .boolean()
      .default(false)
      .describe('Diff against the saved local surface map'),
    generate: z
      .boolean()
      .default(false)
      .describe('Generate surface map and lock file'),
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
    z.object({
      breaking: z.array(z.unknown()),
      hasBreaking: z.boolean(),
      info: z.array(z.unknown()),
      mode: z.literal('diff'),
      warnings: z.array(z.unknown()),
    }),
    z.object({
      hash: z.string(),
      lockPath: z.string(),
      mapPath: z.string(),
      mode: z.literal('generate'),
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
