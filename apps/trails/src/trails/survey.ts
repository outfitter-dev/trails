/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, shows detail for individual trails, generates surface maps,
 * and diffs against previous versions.
 */

import { join } from 'node:path';

import type { Topo } from '@ontrails/core';
import { NotFoundError, Result, trail } from '@ontrails/core';
import { deriveOpenApiSpec } from '@ontrails/http';
import type { DiffResult } from '@ontrails/schema';
import {
  deriveSurfaceMapDiff,
  deriveSurfaceMap,
  readSurfaceMap,
} from '@ontrails/schema';
import { z } from 'zod';

import { loadApp, loadFreshAppLease } from './load-app.js';
import {
  buildCurrentTopoBrief,
  buildCurrentTopoDetail,
  buildCurrentTopoList,
} from './topo-read-support.js';
import { topoDetailOutput } from './topo-output-schemas.js';
import { exportCurrentTopo } from './topo-store-support.js';

export {
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

const buildSurveyDetail = (
  app: Topo,
  entityId: string,
  rootDir: string
): Result<object, Error> => {
  const detail = buildCurrentTopoDetail(app, entityId, { rootDir });
  if (detail !== undefined) {
    return Result.ok(detail);
  }
  return Result.err(
    new NotFoundError(`Trail, resource, or signal not found: ${entityId}`)
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
  diffSaved: boolean;
  generate: boolean;
  openapi: boolean;
  trailId?: string | undefined;
}

type SurveyMode = 'brief' | 'detail' | 'diff' | 'generate' | 'list' | 'openapi';

type SurveyEnvelope = { readonly mode: SurveyMode } & Record<string, unknown>;

/** Ordered mode checks — first truthy predicate wins, otherwise 'list'. */
const modeChecks: readonly [(input: SurveyInput) => boolean, SurveyMode][] = [
  [(i) => i.brief, 'brief'],
  [(i) => i.diffSaved, 'diff'],
  [(i) => Boolean(i.trailId), 'detail'],
  [(i) => i.generate, 'generate'],
  [(i) => i.openapi, 'openapi'],
];

/** Determine which survey mode was requested, falling back to 'list'. */
const deriveSurveyMode = (input: SurveyInput): SurveyMode =>
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
  diff: (app, input, rootDir) =>
    buildSurveyDiff(app, rootDir, input.breakingOnly),
  generate: (app, _input, rootDir) => buildSurveyGenerate(app, rootDir),
  list: (app, _input, rootDir) =>
    Result.ok(buildCurrentTopoList(app, { rootDir })),
  openapi: (app) => Result.ok(deriveOpenApiSpec(app)),
};

const envelopeSurveyValue = (
  mode: SurveyMode,
  value: object
): SurveyEnvelope => {
  if (mode === 'detail') {
    return { detail: value, mode };
  }
  if (mode === 'openapi') {
    return { mode, spec: value };
  }
  return { ...value, mode };
};

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

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const surveyTrail = trail('survey', {
  blaze: async (input, ctx) => {
    const rootDir = ctx.cwd ?? '.';
    const mode = deriveSurveyMode(input);
    // Fresh load only for diffSaved: comparing against a previously-saved
    // surface map requires the current app's source state, not any cached
    // module graph that a prior import may have frozen. Other modes read
    // the in-memory topo and benefit from the standard import cache.
    //
    // For diff specifically, use a disposable lease rather than retained
    // fresh mirrors — the returned diff result is serialisable data, not
    // a Topo reference with deferred imports, so the mirror can be
    // released the moment dispatchSurvey returns. That keeps MCP/dev
    // sessions that poll diff repeatedly from growing .trails-tmp/
    // without bound.
    if (mode === 'diff') {
      const lease = await loadFreshAppLease(input.module, rootDir);
      try {
        return await dispatchSurvey(lease.app, input, rootDir);
      } finally {
        lease.release();
      }
    }

    const app = await loadApp(input.module, rootDir);
    return dispatchSurvey(app, input, rootDir);
  },
  description: 'Full topo introspection',
  examples: [
    {
      description: 'Lists all registered trails with safety and surface info',
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
    diffSaved: z
      .boolean()
      .default(false)
      .describe('Diff against the saved local surface map'),
    generate: z
      .boolean()
      .default(false)
      .describe('Generate surface map and lock file'),
    module: z.string().optional().describe('Path to the app module'),
    openapi: z.boolean().default(false).describe('Output OpenAPI 3.1 spec'),
    trailId: z
      .string()
      .optional()
      .describe('Trail, resource, or signal ID for detail view'),
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
      mode: z.literal('list'),
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
      contractVersion: z.string(),
      features: z.object({
        detours: z.boolean(),
        examples: z.boolean(),
        outputSchemas: z.boolean(),
        resources: z.boolean(),
        signals: z.boolean(),
      }),
      mode: z.literal('brief'),
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
      mode: z.literal('diff'),
      warnings: z.array(z.unknown()),
    }),
    z.object({
      detail: topoDetailOutput,
      mode: z.literal('detail'),
    }),
    z.object({
      hash: z.string(),
      lockPath: z.string(),
      mapPath: z.string(),
      mode: z.literal('generate'),
    }),
    z.object({
      mode: z.literal('openapi'),
      // OpenAPI 3.1 has many legal top-level and nested fields this schema
      // doesn't enumerate (security schemes, tags, externalDocs, info.contact
      // / info.license, etc.). Zod's default strip mode would silently drop
      // those when wrapWithOutputValidation parses the value, so we pass
      // extras through and let deriveOpenApiSpec's output reach callers
      // unchanged.
      spec: z
        .object({
          components: z
            .object({
              schemas: z.record(z.string(), z.unknown()),
            })
            .loose(),
          info: z
            .object({
              description: z.string().optional(),
              title: z.string(),
              version: z.string(),
            })
            .loose(),
          openapi: z.literal('3.1.0'),
          paths: z.record(z.string(), z.record(z.string(), z.unknown())),
          servers: z
            .array(
              z
                .object({
                  description: z.string().optional(),
                  url: z.string(),
                })
                .loose()
            )
            .optional(),
        })
        .loose(),
    }),
  ]),
});
