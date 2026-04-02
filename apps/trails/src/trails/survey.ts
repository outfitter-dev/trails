/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, shows detail for individual trails, generates trailhead maps,
 * and diffs against previous versions.
 */

import type { Topo, Trail } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
import type { DiffResult } from '@ontrails/schema';
import {
  diffTrailheadMaps,
  generateOpenApiSpec,
  generateTrailheadMap,
  hashTrailheadMap,
  readTrailheadMap,
  writeTrailheadLock,
  writeTrailheadMap,
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
    readonly provisions: boolean;
    readonly outputSchemas: boolean;
    readonly examples: boolean;
    readonly detours: boolean;
    readonly signals: boolean;
  };
  readonly trails: number;
  readonly signals: number;
  readonly provisions: number;
}

export interface SurveyListReport {
  readonly count: number;
  readonly entries: readonly {
    readonly examples: number;
    readonly id: string;
    readonly kind: string;
    readonly safety: string;
  }[];
  readonly provisionCount: number;
  readonly provisions: readonly {
    readonly description: string | null;
    readonly health: 'available' | 'none';
    readonly id: string;
    readonly kind: 'provision';
    readonly lifetime: 'singleton';
    readonly usedBy: readonly string[];
  }[];
}

export interface TrailDetailReport {
  readonly description: string | null;
  readonly detours: Trail<unknown, unknown>['detours'] | null;
  readonly examples: readonly unknown[];
  readonly crosses: readonly string[];
  readonly id: string;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly kind: string;
  readonly safety: string;
  readonly provisions: readonly string[];
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
): {
  hasDetours: boolean;
  hasExamples: boolean;
  hasOutputSchemas: boolean;
  hasProvisions: boolean;
} => {
  const trails = [...app.trails.values()].map(
    (item) => item as unknown as Record<string, unknown>
  );
  return {
    hasDetours: trails.some((r) => trailHas(r, 'detours')),
    hasExamples: trails.some((r) => trailHas(r, 'examples')),
    hasOutputSchemas: trails.some((r) => trailHas(r, 'output')),
    hasProvisions: trails.some(
      (r) =>
        Array.isArray(r['provisions']) &&
        (r['provisions'] as unknown[]).length > 0
    ),
  };
};

/** Generate a compact capability report for the given topo. */
export const generateBriefReport = (app: Topo): BriefReport => {
  const { hasDetours, hasExamples, hasOutputSchemas, hasProvisions } =
    detectFeatures(app);

  return {
    contractVersion: '2026-03',
    features: {
      detours: hasDetours,
      examples: hasExamples,
      outputSchemas: hasOutputSchemas,
      provisions: hasProvisions,
      signals: app.signals.size > 0,
    },
    name: app.name,
    provisions: app.provisions.size,
    signals: app.signals.size,
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

const buildProvisionUsage = (
  app: Topo
): ReadonlyMap<string, readonly string[]> => {
  const usage = new Map<string, string[]>();

  for (const trailDef of app.list()) {
    for (const declaredProvision of trailDef.provisions) {
      const users = usage.get(declaredProvision.id) ?? [];
      users.push(trailDef.id);
      usage.set(declaredProvision.id, users);
    }
  }

  return new Map(
    [...usage.entries()].map(([id, users]) => [id, users.toSorted()] as const)
  );
};

const provisionHealthStatus = (provision: {
  health?: unknown;
}): 'available' | 'none' =>
  provision.health === undefined ? 'none' : 'available';

const formatProvisionList = (app: Topo): SurveyListReport['provisions'] => {
  const usage = buildProvisionUsage(app);
  return app
    .listProvisions()
    .map((provision) => ({
      description: provision.description ?? null,
      health: provisionHealthStatus(provision),
      id: provision.id,
      kind: provision.kind,
      lifetime: 'singleton' as const,
      usedBy: usage.get(provision.id) ?? [],
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
};

export const generateSurveyList = (app: Topo): SurveyListReport => {
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

  const provisions = formatProvisionList(app);

  return {
    count: items.length,
    entries,
    provisionCount: provisions.length,
    provisions,
  };
};

/**
 * Build a human-readable detail view for a single trail.
 *
 * Overlaps with `trailToEntry` in `@ontrails/schema` which builds the
 * trailhead-map entry. The two serve different audiences (human display vs
 * machine-diffable trailhead map) so they are kept separate.
 */
export const generateTrailDetail = (
  item: Trail<unknown, unknown>
): TrailDetailReport => {
  const safety = safetyLabel(
    item as unknown as { intent?: 'read' | 'write' | 'destroy' }
  );

  return {
    crosses: item.crosses.toSorted(),
    description: item.description ?? null,
    detours: item.detours ?? null,
    examples: item.examples ?? [],
    id: item.id,
    intent: item.intent,
    kind: item.kind,
    provisions: item.provisions.map((provision) => provision.id).toSorted(),
    safety,
  };
};

const formatProvisionDetail = (app: Topo, provisionId: string): object => {
  const item = app.getProvision(provisionId);
  const usedBy = buildProvisionUsage(app).get(provisionId) ?? [];

  return {
    description: item?.description ?? null,
    health: item ? provisionHealthStatus(item) : 'none',
    id: provisionId,
    kind: 'provision',
    lifetime: 'singleton',
    usedBy,
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
  const currentMap = generateTrailheadMap(app);
  const previousMap = await readTrailheadMap();
  if (!previousMap) {
    return Result.err(
      new Error(
        'No previous trailhead map found. Run `trails survey generate` first.'
      )
    );
  }

  const diff = diffTrailheadMaps(previousMap, currentMap);
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
  if (item) {
    return Result.ok(generateTrailDetail(item as Trail<unknown, unknown>));
  }
  if (app.getProvision(trailId)) {
    return Result.ok(formatProvisionDetail(app, trailId));
  }
  return Result.err(new Error(`Trail or provision not found: ${trailId}`));
};

const buildSurveyGenerate = async (
  app: Topo
): Promise<Result<object, Error>> => {
  const trailheadMap = generateTrailheadMap(app);
  const mapPath = await writeTrailheadMap(trailheadMap);
  const hash = hashTrailheadMap(trailheadMap);
  const lockPath = await writeTrailheadLock(hash);
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
  list: (app) => Result.ok(generateSurveyList(app)),
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
  blaze: async (input, ctx) => {
    const app = await loadApp(input.module, ctx.cwd ?? '.');
    return dispatchSurvey(app, input);
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
      provisionCount: z.number(),
      provisions: z.array(
        z.object({
          description: z.string().nullable(),
          health: z.enum(['available', 'none']),
          id: z.string(),
          kind: z.literal('provision'),
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
        provisions: z.boolean(),
        signals: z.boolean(),
      }),
      name: z.string(),
      provisions: z.number(),
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
      provisions: z.array(z.string()),
      safety: z.string(),
    }),
    z.object({
      description: z.string().nullable(),
      health: z.enum(['available', 'none']),
      id: z.string(),
      kind: z.literal('provision'),
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
