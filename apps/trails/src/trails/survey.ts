/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, shows detail for individual trails, generates trailhead maps,
 * and diffs against previous versions.
 */

import type { Topo } from '@ontrails/core';
import { NotFoundError, Result, trail } from '@ontrails/core';
import type { DiffResult } from '@ontrails/schema';
import {
  deriveSurfaceMapDiff,
  deriveOpenApiSpec,
  deriveSurfaceMap,
  readTrailheadMap,
} from '@ontrails/schema';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import {
  buildCurrentTopoBrief,
  buildCurrentTopoDetail,
  buildCurrentTopoList,
} from './topo-read-support.js';
import { exportCurrentTopo } from './topo-store-support.js';

export {
  formatResourceDetail,
  generateBriefReport,
  generateSurveyList,
  generateTrailDetail,
} from './topo-reports.js';
export type {
  BriefReport,
  SurveyListReport,
  TrailDetailReport,
} from './topo-reports.js';

// ---------------------------------------------------------------------------
// Brief report (formerly scout)
// ---------------------------------------------------------------------------

const formatDiff = (diff: DiffResult): object => ({
  breaking: diff.breaking,
  hasBreaking: diff.hasBreaking,
  info: diff.info,
  warnings: diff.warnings,
});

const buildSurveyDiff = async (
  app: Topo,
  breakingOnly: boolean
): Promise<Result<object, Error>> => {
  const currentMap = deriveSurfaceMap(app);
  const previousMap = await readTrailheadMap();
  if (!previousMap) {
    return Result.err(
      new NotFoundError(
        'No previous trailhead map found. Run `trails topo export` first.'
      )
    );
  }

  const diff = deriveSurfaceMapDiff(previousMap, currentMap);
  return Result.ok(
    breakingOnly
      ? formatDiff({
          ...diff,
          entries: diff.breaking,
          info: [],
          warnings: [],
        })
      : formatDiff(diff)
  );
};

const buildSurveyDetail = (
  app: Topo,
  trailId: string,
  rootDir: string
): Result<object, Error> => {
  const detail = buildCurrentTopoDetail(app, trailId, { rootDir });
  if (detail !== undefined) {
    return Result.ok(detail);
  }
  return Result.err(
    new NotFoundError(`Trail or resource not found: ${trailId}`)
  );
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
  brief: boolean;
  diff?: string | undefined;
  generate: boolean;
  openapi: boolean;
  trailId?: string | undefined;
}

type SurveyMode = 'brief' | 'detail' | 'diff' | 'generate' | 'list' | 'openapi';

/** Ordered mode checks — first truthy predicate wins, otherwise 'list'. */
const modeChecks: readonly [(input: SurveyInput) => boolean, SurveyMode][] = [
  [(i) => i.brief, 'brief'],
  [(i) => Boolean(i.diff), 'diff'],
  [(i) => Boolean(i.trailId), 'detail'],
  [(i) => i.generate, 'generate'],
  [(i) => i.openapi, 'openapi'],
];

/** Determine which survey mode was requested, falling back to 'list'. */
const resolveSurveyMode = (input: SurveyInput): SurveyMode =>
  modeChecks.find(([predicate]) => predicate(input))?.[1] ?? 'list';

type SurveyHandler = (
  app: Topo,
  input: SurveyInput,
  rootDir: string
) => Result<object, Error> | Promise<Result<object, Error>>;

/** Handlers keyed by survey mode. */
const surveyHandlers: Record<SurveyMode, SurveyHandler> = {
  brief: (app, _input, rootDir) =>
    Result.ok(buildCurrentTopoBrief(app, { rootDir })),
  detail: (app, input, rootDir) =>
    buildSurveyDetail(app, input.trailId ?? '', rootDir),
  diff: (app, input) => buildSurveyDiff(app, input.breakingOnly),
  generate: (app, _input, rootDir) => buildSurveyGenerate(app, rootDir),
  list: (app, _input, rootDir) =>
    Result.ok(buildCurrentTopoList(app, { rootDir })),
  openapi: (app) => Result.ok(deriveOpenApiSpec(app)),
};

/** Dispatch to the appropriate survey sub-command based on input flags. */
const dispatchSurvey = (
  app: Topo,
  input: SurveyInput,
  rootDir: string
): Result<object, Error> | Promise<Result<object, Error>> => {
  const mode = resolveSurveyMode(input);
  const handler = surveyHandlers[mode];
  return handler(app, input, rootDir);
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const surveyTrail = trail('survey', {
  blaze: async (input, ctx) => {
    const rootDir = ctx.cwd ?? '.';
    const app = await loadApp(input.module, rootDir);
    return dispatchSurvey(app, input, rootDir);
  },
  description: 'Full topo introspection',
  examples: [
    {
      description: 'Lists all registered trails with safety and trailhead info',
      input: { module: './src/app.ts' },
      name: 'List all trails',
    },
    {
      description: 'Quick capability summary with counts and feature flags',
      input: { brief: true, module: './src/app.ts' },
      name: 'Brief capability report',
    },
    {
      description: 'Generate an OpenAPI 3.1 specification for the topo',
      input: { module: './src/app.ts', openapi: true },
      name: 'OpenAPI spec',
    },
  ],
  input: z.object({
    breakingOnly: z
      .boolean()
      .default(false)
      .describe('Only show breaking changes'),
    brief: z.boolean().default(false).describe('Quick capability summary'),
    diff: z.string().optional().describe('Diff against a git ref'),
    generate: z
      .boolean()
      .default(false)
      .describe('Generate trailhead map and lock file'),
    module: z.string().optional().describe('Path to the app module'),
    openapi: z.boolean().default(false).describe('Output OpenAPI 3.1 spec'),
    trailId: z.string().optional().describe('Trail ID for detail view'),
  }),
  intent: 'read',
  output: z.union([
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
    }),
    z.object({
      contractVersion: z.string(),
      features: z.object({
        detours: z.boolean(),
        examples: z.boolean(),
        outputSchemas: z.boolean(),
        resources: z.boolean(),
        signals: z.boolean(),
      }),
      name: z.string(),
      resources: z.number(),
      signals: z.number(),
      trails: z.number(),
      version: z.string(),
    }),
    z.object({
      breaking: z.array(z.unknown()),
      hasBreaking: z.boolean(),
      info: z.array(z.unknown()),
      warnings: z.array(z.unknown()),
    }),
    z.object({
      crosses: z.array(z.string()),
      description: z.unknown().nullable(),
      detours: z.unknown().nullable(),
      examples: z.array(z.unknown()),
      id: z.string(),
      intent: z.enum(['read', 'write', 'destroy']),
      kind: z.string(),
      resources: z.array(z.string()),
      safety: z.string(),
    }),
    z.object({
      description: z.string().nullable(),
      health: z.enum(['available', 'none']),
      id: z.string(),
      kind: z.literal('resource'),
      lifetime: z.literal('singleton'),
      usedBy: z.array(z.string()),
    }),
    z.object({
      hash: z.string(),
      lockPath: z.string(),
      mapPath: z.string(),
    }),
    z.object({
      components: z.object({
        schemas: z.record(z.string(), z.unknown()),
      }),
      info: z.object({
        description: z.string().optional(),
        title: z.string(),
        version: z.string(),
      }),
      openapi: z.literal('3.1.0'),
      paths: z.record(z.string(), z.record(z.string(), z.unknown())),
      servers: z
        .array(
          z.object({
            description: z.string().optional(),
            url: z.string(),
          })
        )
        .optional(),
    }),
  ]),
});
