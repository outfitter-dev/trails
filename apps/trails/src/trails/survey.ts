/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, shows detail for individual trails, generates surface maps,
 * and diffs against previous versions.
 */

import type { Topo, Trail } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
import type { DiffResult } from '@ontrails/schema';
import {
  diffSurfaceMaps,
  generateOpenApiSpec,
  generateSurfaceMap,
  hashSurfaceMap,
  readSurfaceMap,
  writeSurfaceLock,
  writeSurfaceMap,
} from '@ontrails/schema';
import { z } from 'zod';

import { loadApp } from './load-app.js';

// ---------------------------------------------------------------------------
// Brief report (formerly scout)
// ---------------------------------------------------------------------------

export interface BriefReport {
  readonly name: string;
  readonly version: string;
  readonly contractVersion: string;
  readonly features: {
    readonly outputSchemas: boolean;
    readonly examples: boolean;
    readonly detours: boolean;
    readonly events: boolean;
  };
  readonly trails: number;
  readonly events: number;
}

/** Check if a trail has a specific feature. */
const trailHas = (raw: Record<string, unknown>, key: string): boolean => {
  if (key === 'examples') {
    return Array.isArray(raw[key]) && (raw[key] as unknown[]).length > 0;
  }
  return Boolean(raw[key]);
};

/** Detect which features are used across trails. */
const detectFeatures = (
  app: Topo
): { hasDetours: boolean; hasExamples: boolean; hasOutputSchemas: boolean } => {
  const trails = [...app.trails.values()].map(
    (item) => item as unknown as Record<string, unknown>
  );
  return {
    hasDetours: trails.some((r) => trailHas(r, 'detours')),
    hasExamples: trails.some((r) => trailHas(r, 'examples')),
    hasOutputSchemas: trails.some((r) => trailHas(r, 'output')),
  };
};

/** Generate a compact capability report for the given topo. */
export const generateBriefReport = (app: Topo): BriefReport => {
  const { hasDetours, hasExamples, hasOutputSchemas } = detectFeatures(app);

  return {
    contractVersion: '2026-03',
    events: app.events.size,
    features: {
      detours: hasDetours,
      events: app.events.size > 0,
      examples: hasExamples,
      outputSchemas: hasOutputSchemas,
    },
    name: app.name,
    trails: app.trails.size,
    version: '0.1.0',
  };
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const safetyLabel = (entry: {
  intent?: 'read' | 'write' | 'destroy';
}): string => {
  if (entry.intent === 'destroy') {
    return 'destroy';
  }
  if (entry.intent === 'read') {
    return 'read';
  }
  return '-';
};

const formatTrailList = (app: Topo): object => {
  const items = app.list();
  const entries = items.map((item) => {
    const safety = safetyLabel(
      item as unknown as { intent?: 'read' | 'write' | 'destroy' }
    );
    const examples = Array.isArray(
      (item as unknown as { examples?: unknown[] }).examples
    )
      ? (item as unknown as { examples: unknown[] }).examples.length
      : 0;

    return {
      examples,
      id: item.id,
      kind: item.kind,
      safety,
    };
  });

  return { count: items.length, entries };
};

/**
 * Build a human-readable detail view for a single trail.
 *
 * Overlaps with `trailToEntry` in `@ontrails/schema` which builds the
 * surface-map entry. The two serve different audiences (human display vs
 * machine-diffable surface map) so they are kept separate.
 */
const formatTrailDetail = (item: Trail<unknown, unknown>): object => {
  const safety = safetyLabel(
    item as unknown as { intent?: 'read' | 'write' | 'destroy' }
  );

  return {
    description: item.description ?? null,
    detours: item.detours ?? null,
    examples: item.examples ?? [],
    id: item.id,
    kind: item.kind,
    safety,
  };
};

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
  const currentMap = generateSurfaceMap(app);
  const previousMap = await readSurfaceMap();
  if (!previousMap) {
    return Result.err(
      new Error(
        'No previous surface map found. Run `trails survey generate` first.'
      )
    );
  }

  const diff = diffSurfaceMaps(previousMap, currentMap);
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
  trailId: string
): Result<object, Error> => {
  const item = app.get(trailId);
  if (!item) {
    return Result.err(new Error(`Trail not found: ${trailId}`));
  }
  return Result.ok(formatTrailDetail(item as Trail<unknown, unknown>));
};

const buildSurveyGenerate = async (
  app: Topo
): Promise<Result<object, Error>> => {
  const surfaceMap = generateSurfaceMap(app);
  const mapPath = await writeSurfaceMap(surfaceMap);
  const hash = hashSurfaceMap(surfaceMap);
  const lockPath = await writeSurfaceLock(hash);
  return Result.ok({ hash, lockPath, mapPath });
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
  input: SurveyInput
) => Result<object, Error> | Promise<Result<object, Error>>;

/** Handlers keyed by survey mode. */
const surveyHandlers: Record<SurveyMode, SurveyHandler> = {
  brief: (app) => Result.ok(generateBriefReport(app)),
  detail: (app, input) => buildSurveyDetail(app, input.trailId ?? ''),
  diff: (app, input) => buildSurveyDiff(app, input.breakingOnly),
  generate: (app) => buildSurveyGenerate(app),
  list: (app) => Result.ok(formatTrailList(app)),
  openapi: (app) => Result.ok(generateOpenApiSpec(app)),
};

/** Dispatch to the appropriate survey sub-command based on input flags. */
const dispatchSurvey = (
  app: Topo,
  input: SurveyInput
): Result<object, Error> | Promise<Result<object, Error>> => {
  const mode = resolveSurveyMode(input);
  const handler = surveyHandlers[mode];
  return handler(app, input);
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const surveyTrail = trail('survey', {
  description: 'Full topo introspection',
  examples: [
    {
      description: 'Lists all registered trails with safety and surface info',
      input: {},
      name: 'List all trails',
    },
    {
      description: 'Quick capability summary with counts and feature flags',
      input: { brief: true },
      name: 'Brief capability report',
    },
    {
      description: 'Generate an OpenAPI 3.1 specification for the topo',
      input: { openapi: true },
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
      .describe('Generate surface map and lock file'),
    module: z
      .string()
      .default('./src/app.ts')
      .describe('Path to the app module'),
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
    }),
    z.object({
      contractVersion: z.string(),
      events: z.number(),
      features: z.object({
        detours: z.boolean(),
        events: z.boolean(),
        examples: z.boolean(),
        outputSchemas: z.boolean(),
      }),
      name: z.string(),
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
      description: z.unknown().nullable(),
      detours: z.unknown().nullable(),
      examples: z.array(z.unknown()),
      id: z.string(),
      kind: z.string(),
      safety: z.string(),
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
  run: async (input, ctx) => {
    const app = await loadApp(input.module, ctx.cwd ?? '.');
    return dispatchSurvey(app, input);
  },
});
