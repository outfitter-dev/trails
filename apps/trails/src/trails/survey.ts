/**
 * `survey` trail -- Full topo introspection.
 *
 * Lists trails, looks up trails/resources/signals, and diffs against previous
 * versions.
 */

import { basename, extname, join } from 'node:path';

import type { Topo } from '@ontrails/core';
import {
  deriveSafePath,
  NotFoundError,
  Result,
  trail,
  ValidationError,
} from '@ontrails/core';
import type {
  DiffEntry,
  DiffResult,
  TopoGraph,
  TopoGraphOverlayRegistration,
} from '@ontrails/topography';
import {
  createTopoStore,
  deriveTopoGraphDiff,
  deriveTopoGraph,
  resolveTopoGraphVersionReference,
  TOPO_GRAPH_SCHEMA_VERSION,
  readTopoGraph,
} from '@ontrails/topography';
import { z } from 'zod';

import { writeIsolatedExampleJsonFile } from '../local-state-io.js';

import { withFreshAppLease, withOperatorRootDir } from './operator-context.js';
import {
  deriveCurrentTopoBrief,
  deriveCurrentTopoList,
  deriveCurrentTopoMatches,
  deriveCurrentTrailDetail,
  deriveCurrentResourceDetail,
  deriveCurrentSignalDetail,
  readSurfaceLayerNamesFromContext,
} from './topo-read-support.js';
import {
  activationOverviewOutput,
  resourceDetailOutput,
  shippedSurfaceInventoryOutput,
  signalDetailOutput,
  trailDetailOutput,
} from './topo-output-schemas.js';
import { createIsolatedExampleInput } from './topo-support.js';
import {
  briefReportSchema,
  deriveShippedSurfaceInventory,
} from './topo-reports.js';
import type { SurfaceLayerNames } from './topo-reports.js';

export {
  briefReportSchema,
  deriveBriefReport,
  deriveResourceDetail,
  deriveShippedSurfaceInventory,
  deriveSignalDetail,
  deriveSurveyList,
  deriveTrailDetail,
} from './topo-reports.js';
export type {
  BriefReport,
  ShippedSurfaceInventoryReport,
  ShippedSurfaceDerived,
  SignalDetailReport,
  SurfaceLayerNames,
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

interface DiffInput {
  readonly against?: string | undefined;
  readonly breakingOnly?: boolean | undefined;
  readonly breaks?: boolean | undefined;
  readonly forces?: boolean | undefined;
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
  readonly target?: string | undefined;
}

interface ParsedDiffTarget {
  readonly id: string;
  readonly versions?: ReadonlySet<number> | undefined;
}

const formatDiff = (diff: DiffResult, against: string): SurveyDiffReport => ({
  against,
  breaking: diff.breaking,
  hasBreaking: diff.hasBreaking,
  info: diff.info,
  mode: 'diff',
  warnings: diff.warnings,
});

const partitionDiffEntries = (entries: readonly DiffEntry[]): DiffResult => {
  const sorted = [...entries].toSorted((left, right) =>
    left.id.localeCompare(right.id)
  );
  const breaking = sorted.filter((entry) => entry.severity === 'breaking');
  const warnings = sorted.filter((entry) => entry.severity === 'warning');
  const info = sorted.filter((entry) => entry.severity === 'info');

  return {
    breaking,
    entries: sorted,
    hasBreaking: breaking.length > 0,
    info,
    warnings,
  };
};

const parseVersionRange = (
  reference: string
): ReadonlySet<number> | undefined => {
  const match = /^(\d+)\.\.(\d+)$/.exec(reference);
  if (match === null) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) {
    throw new ValidationError(
      `Diff version range must use ascending positive versions: ${reference}`
    );
  }

  return new Set(
    Array.from({ length: end - start + 1 }, (_value, index) => start + index)
  );
};

const findDiffTargetEntry = (
  previous: TopoGraph,
  current: TopoGraph,
  id: string
) =>
  current.entries.find((entry) => entry.id === id) ??
  previous.entries.find((entry) => entry.id === id);

const parseDiffTarget = (
  previous: TopoGraph,
  current: TopoGraph,
  target: string | undefined
): Result<ParsedDiffTarget | undefined, Error> => {
  if (target === undefined || target.length === 0) {
    return Result.ok();
  }

  const separator = target.lastIndexOf('@');
  const id = separator === -1 ? target : target.slice(0, separator);
  const reference =
    separator === -1 ? undefined : target.slice(separator + 1).trim();
  if (id.length === 0 || reference === '') {
    return Result.err(
      new ValidationError('Diff target must use trail.id or trail.id@version')
    );
  }

  const entry = findDiffTargetEntry(previous, current, id);
  if (entry === undefined) {
    return Result.err(new NotFoundError(`Trail not found for diff: ${id}`));
  }

  if (reference === undefined) {
    return Result.ok({ id });
  }

  try {
    const range = parseVersionRange(reference);
    if (range !== undefined) {
      return Result.ok({ id, versions: range });
    }

    return Result.ok({
      id,
      versions: new Set([
        resolveTopoGraphVersionReference(entry, reference).version,
      ]),
    });
  } catch (error: unknown) {
    return Result.err(
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

const detailVersions = (detail: string): readonly number[] => {
  const match = /^(?:Live version|Version) (\d+)\b/.exec(detail);
  if (match !== null) {
    return [Number(match[1])];
  }

  const supportMatch = /^Supported versions (?:added|removed): (.+)$/.exec(
    detail
  );
  if (supportMatch === null) {
    return [];
  }

  return (supportMatch[1] ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((version) => Number.isInteger(version) && version > 0);
};

type DiffSeverity = DiffEntry['severity'];

const severityRank: Record<DiffSeverity, number> = {
  breaking: 2,
  info: 0,
  warning: 1,
};

const higherSeverity = (
  left: DiffSeverity,
  right: DiffSeverity
): DiffSeverity => (severityRank[right] > severityRank[left] ? right : left);

const versionStatus = (detail: string): string | undefined =>
  /^Version \d+ (?:added|removed) \(([^)]+)\)$/.exec(detail)?.[1];

const visibleDetailSeverity = (detail: string): DiffSeverity => {
  if (detail.startsWith('Force event ')) {
    return 'warning';
  }
  if (detail.startsWith('Supported versions removed: ')) {
    return 'breaking';
  }
  if (detail.startsWith('Supported versions added: ')) {
    return 'info';
  }
  if (
    /^Live version \d+ (?:added without examples|example coverage removed)$/.test(
      detail
    )
  ) {
    return 'warning';
  }
  if (detail.startsWith('Live version ') && detail.includes(' examples: ')) {
    return 'info';
  }
  if (/^Version \d+ status changed: .+ -> archived$/.test(detail)) {
    return 'warning';
  }
  if (detail.startsWith('Version ') && detail.includes(' status changed: ')) {
    return 'info';
  }

  const status = versionStatus(detail);
  if (detail.startsWith('Version ') && detail.includes(' removed (')) {
    return status === 'archived' ? 'warning' : 'breaking';
  }
  if (detail.startsWith('Version ') && detail.includes(' added (')) {
    return status === 'archived' ? 'info' : 'warning';
  }
  if (
    /^Version \d+ (?:kind changed:|Required (?:input|entity) field ".+" added|(?:Input|Output|Entity) field ".+" (?:removed|type changed:|changed from optional to required))/.test(
      detail
    )
  ) {
    return 'breaking';
  }
  if (
    /^Version \d+ (?:marker changed:|Optional (?:input|entity) field ".+" added|Output field ".+" added)/.test(
      detail
    )
  ) {
    return 'info';
  }

  return 'info';
};

const visibleDetailsSeverity = (details: readonly string[]): DiffSeverity => {
  let severity: DiffSeverity = 'info';
  for (const detail of details) {
    severity = higherSeverity(severity, visibleDetailSeverity(detail));
  }
  return severity;
};

const detailsChanged = (
  previous: readonly string[],
  next: readonly string[]
): boolean =>
  previous.length !== next.length ||
  previous.some((detail, index) => detail !== next[index]);

const filterDetails = (
  details: readonly string[],
  target: ParsedDiffTarget | undefined,
  forcesOnly: boolean
): readonly string[] => {
  const visible = forcesOnly
    ? details.filter((detail) => detail.startsWith('Force event '))
    : [...details];
  if (target?.versions === undefined || forcesOnly) {
    return visible;
  }

  return visible.filter((detail) => {
    const versions = detailVersions(detail);
    return versions.some((version) => target.versions?.has(version));
  });
};

const filterDiff = (
  diff: DiffResult,
  target: ParsedDiffTarget | undefined,
  options: Pick<DiffInput, 'breakingOnly' | 'breaks' | 'forces'>
): DiffResult => {
  const entries = diff.entries.flatMap((entry): DiffEntry[] => {
    if (target !== undefined && entry.id !== target.id) {
      return [];
    }
    const details = filterDetails(
      entry.details,
      target,
      options.forces === true
    );
    if (details.length === 0) {
      return [];
    }
    return [
      {
        ...entry,
        details,
        severity: detailsChanged(entry.details, details)
          ? visibleDetailsSeverity(details)
          : entry.severity,
      },
    ];
  });

  const partitioned = partitionDiffEntries(entries);
  return options.breakingOnly === true || options.breaks === true
    ? partitionDiffEntries(partitioned.breaking)
    : partitioned;
};

const createDiffExampleInput = (): {
  readonly against: string;
  readonly module: string;
  readonly rootDir: string;
} => {
  const input = createIsolatedExampleInput('survey-diff');
  writeIsolatedExampleJsonFile(input.rootDir, 'baseline/topo.lock', {
    activationGraph: {
      edgeCount: 0,
      edges: [],
      sourceCount: 0,
      sourceKeys: [],
      trailIds: [],
    },
    activationSources: {},
    entries: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
  } satisfies TopoGraph);
  return { ...input, against: 'baseline' };
};

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

const readTopoGraphFile = async (
  filePath: string
): Promise<TopoGraph | null> => {
  try {
    return (await Bun.file(filePath).json()) as TopoGraph;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
};

const readStoredTopoGraph = (
  rootDir: string,
  against: string
): TopoGraph | undefined => {
  try {
    const store = createTopoStore({ rootDir });
    const stored =
      store.exports.get({ pin: against }) ??
      store.exports.get({ snapshotId: against });
    return stored === undefined
      ? undefined
      : (JSON.parse(stored.topoGraphJson) as TopoGraph);
  } catch (error: unknown) {
    if (error instanceof NotFoundError) {
      return undefined;
    }
    throw error;
  }
};

const readPathTopoGraph = async (
  rootDir: string,
  against: string
): Promise<Result<TopoGraph | null, Error>> => {
  const safePath = deriveSafePath(rootDir, against);
  if (safePath.isErr()) {
    return safePath;
  }

  return Result.ok(
    basename(safePath.value) === 'topo.lock' ||
      extname(safePath.value) === '.json'
      ? await readTopoGraphFile(safePath.value)
      : await readTopoGraph({ dir: safePath.value })
  );
};

const describeAgainstPathTarget = (against: string): string =>
  basename(against) === 'topo.lock' || extname(against) === '.json'
    ? 'workspace-relative TopoGraph file'
    : 'workspace-relative directory containing trails.lock or topo.lock';

const topoGraphNotFound = (against: string): NotFoundError =>
  new NotFoundError(
    `No TopoGraph found for: ${against}. Tried ${describeAgainstPathTarget(
      against
    )}, then topo-store pin and snapshot references.`
  );

const readAgainstTopoGraph = async (
  rootDir: string,
  against?: string | undefined
): Promise<Result<{ against: string; map: TopoGraph }, Error>> => {
  if (against === undefined || against === 'saved') {
    const map =
      (await readTopoGraph({ dir: rootDir })) ??
      (await readTopoGraph({ dir: join(rootDir, '.trails') }));
    return map === null
      ? Result.err(
          new NotFoundError(
            'No saved TopoGraph found. Run `trails compile` first.'
          )
        )
      : Result.ok({ against: 'saved', map });
  }

  // Treat explicit filesystem targets as the most local user intent; stored
  // pins and snapshot ids are fallback references when no path exists.
  const pathMap = await readPathTopoGraph(rootDir, against);
  if (pathMap.isErr()) {
    return pathMap;
  }
  if (pathMap.value !== null) {
    return Result.ok({ against, map: pathMap.value });
  }

  const storedMap = readStoredTopoGraph(rootDir, against);
  if (storedMap !== undefined) {
    return Result.ok({ against, map: storedMap });
  }

  return Result.err(topoGraphNotFound(against));
};

const buildSurveyDiff = async (
  app: Topo,
  rootDir: string,
  input: DiffInput
): Promise<Result<SurveyDiffReport, Error>> => {
  const currentMap = deriveTopoGraph(app);
  const previous = await readAgainstTopoGraph(rootDir, input.against);
  if (previous.isErr()) {
    return previous;
  }

  const target = parseDiffTarget(previous.value.map, currentMap, input.target);
  if (target.isErr()) {
    return target;
  }

  const diff = filterDiff(
    deriveTopoGraphDiff(previous.value.map, currentMap),
    target.value,
    input
  );
  return Result.ok(formatDiff(diff, previous.value.against));
};

const buildSurveyLookup = (
  app: Topo,
  entityId: string,
  rootDir: string,
  overlays: readonly TopoGraphOverlayRegistration[] | undefined,
  surfaceLayerNames?: Partial<SurfaceLayerNames> | undefined
): Result<object, Error> => {
  const matches = deriveCurrentTopoMatches(app, entityId, {
    overlays,
    rootDir,
    surfaceLayerNames,
  });
  return Result.ok({ matches });
};

const buildSurveyTrailDetail = (
  app: Topo,
  id: string,
  rootDir: string,
  overlays: readonly TopoGraphOverlayRegistration[] | undefined,
  surfaceLayerNames?: Partial<SurfaceLayerNames> | undefined
): Result<object, Error> => {
  const detail = deriveCurrentTrailDetail(app, id, {
    overlays,
    rootDir,
    surfaceLayerNames,
  });
  return detail === undefined
    ? Result.err(new NotFoundError(`Trail not found: ${id}`))
    : Result.ok(detail);
};

const buildSurveyResourceDetail = (
  app: Topo,
  id: string,
  rootDir: string
): Result<object, Error> => {
  const detail = deriveCurrentResourceDetail(app, id, { rootDir });
  return detail === undefined
    ? Result.err(new NotFoundError(`Resource not found: ${id}`))
    : Result.ok(detail);
};

const buildSurveySignalDetail = (
  app: Topo,
  id: string,
  rootDir: string
): Result<object, Error> => {
  const detail = deriveCurrentSignalDetail(app, id, { rootDir });
  return detail === undefined
    ? Result.err(new NotFoundError(`Signal not found: ${id}`))
    : Result.ok(detail);
};

const buildSurveySurfaceInventory = (app: Topo): Result<object, Error> =>
  Result.ok(deriveShippedSurfaceInventory(app));

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
  rootDir: string,
  overlays: readonly TopoGraphOverlayRegistration[] | undefined,
  surfaceLayerNames?: Partial<SurfaceLayerNames> | undefined
) => Result<object, Error> | Promise<Result<object, Error>>;

/** Handlers keyed by survey mode. */
const surveyHandlers: Record<SurveyMode, SurveyHandler> = {
  lookup: (app, input, rootDir, overlays, surfaceLayerNames) =>
    input.id === undefined || input.id === ''
      ? Result.err(new ValidationError('Survey lookup requires an id'))
      : buildSurveyLookup(app, input.id, rootDir, overlays, surfaceLayerNames),
  overview: (app, _input, rootDir) =>
    Result.ok(deriveCurrentTopoList(app, { rootDir })),
};

const envelopeSurveyValue = (
  mode: SurveyMode,
  value: object
): SurveyEnvelope => ({ ...value, mode });

/** Dispatch to the appropriate survey sub-command based on input flags. */
const dispatchSurvey = async (
  app: Topo,
  input: SurveyInput,
  rootDir: string,
  overlays: readonly TopoGraphOverlayRegistration[] | undefined,
  surfaceLayerNames?: Partial<SurfaceLayerNames> | undefined
): Promise<Result<SurveyEnvelope, Error>> => {
  const mode = deriveSurveyMode(input);
  const handler = surveyHandlers[mode];
  const result = await handler(
    app,
    input,
    rootDir,
    overlays,
    surfaceLayerNames
  );
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

const withFreshSurveyApp = async <T>(
  input: { readonly module?: string | undefined },
  rootDir: string,
  consume: (
    app: Topo,
    overlays: readonly TopoGraphOverlayRegistration[] | undefined
  ) => Promise<Result<T, Error>> | Result<T, Error>
): Promise<Result<T, Error>> =>
  withFreshAppLease(input.module, rootDir, (lease) =>
    consume(lease.app, lease.overlays)
  );

const withResolvedSurveyApp = async <T>(
  input: {
    readonly module?: string | undefined;
    readonly rootDir?: string | undefined;
  },
  cwd: string | undefined,
  consume: (
    app: Topo,
    rootDir: string,
    overlays: readonly TopoGraphOverlayRegistration[] | undefined
  ) => Promise<Result<T, Error>> | Result<T, Error>
): Promise<Result<T, Error>> =>
  withOperatorRootDir(input, { cwd }, (rootDir) =>
    withFreshSurveyApp(input, rootDir, (app, overlays) =>
      consume(app, rootDir, overlays)
    )
  );

const moduleInputSchema = z.object({
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const diffEntryOutput = z.object({
  change: z.enum(['added', 'removed', 'modified']),
  details: z.array(z.string()).readonly(),
  id: z.string(),
  kind: z.enum(['entity', 'trail', 'signal', 'resource']),
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

const diffInputSchema = z.object({
  against: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Saved TopoGraph target: "saved", a workspace path (topo.lock, .json file, or directory with topo.lock), then a pin/snapshot id'
    ),
  breakingOnly: z
    .boolean()
    .default(false)
    .describe('Legacy alias for --breaks; only show breaking changes'),
  breaks: z.boolean().default(false).describe('Only show breaking changes'),
  forces: z
    .boolean()
    .default(false)
    .describe('Only show graph force audit events'),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
  target: z
    .string()
    .min(1)
    .optional()
    .describe('Trail or trail version target, such as user.create@1..2'),
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
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app, rootDir, overlays) =>
      dispatchSurvey(
        app,
        input,
        rootDir,
        overlays,
        readSurfaceLayerNamesFromContext(ctx)
      )
    ),
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
      activation: activationOverviewOutput,
      count: z.number(),
      entries: z.array(
        z.object({
          activatedBy: z.array(z.string()).readonly(),
          activates: z.array(z.string()).readonly(),
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
  description: 'Summarize topo capabilities',
  examples: [
    {
      description: 'Show counts and feature flags',
      input: createIsolatedExampleInput('survey-brief'),
      name: 'Brief capability report',
    },
  ],
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app, rootDir) =>
      Result.ok(deriveCurrentTopoBrief(app, { rootDir }))
    ),
  input: moduleInputSchema,
  intent: 'read',
  output: briefReportSchema,
});

export const surveySurfacesTrail = trail('survey.surfaces', {
  description: 'Inventory shipped surface derived facts',
  examples: [
    {
      description: 'Show CLI, MCP, and HTTP derived facts for public trails',
      input: createIsolatedExampleInput('survey-surfaces'),
      name: 'Shipped surface inventory',
    },
  ],
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app) =>
      buildSurveySurfaceInventory(app)
    ),
  input: moduleInputSchema,
  intent: 'read',
  output: shippedSurfaceInventoryOutput,
});

export const surveyDiffTrail = trail('survey.diff', {
  args: ['target'],
  description: 'Diff the current topo against a saved TopoGraph',
  examples: [
    {
      description: 'Compare current topo to a saved TopoGraph directory',
      input: createDiffExampleInput(),
      name: 'Diff against baseline',
    },
    {
      description: 'Show only breaking contract drift',
      input: { ...createDiffExampleInput(), breaks: true },
      name: 'Breaking changes',
    },
    {
      description: 'Show graph-only force audit events',
      input: { ...createDiffExampleInput(), forces: true },
      name: 'Force audit events',
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
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app, rootDir) =>
      buildSurveyDiff(app, rootDir, input)
    ),
  input: diffInputSchema,
  intent: 'read',
  output: diffOutput,
});

export const surveyTrailDetailTrail = trail('survey.trail', {
  args: ['id'],
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
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app, rootDir, overlays) =>
      buildSurveyTrailDetail(
        app,
        input.id,
        rootDir,
        overlays,
        readSurfaceLayerNamesFromContext(ctx)
      )
    ),
  input: detailInputSchema,
  intent: 'read',
  output: trailDetailOutput,
});

export const surveyResourceTrail = trail('survey.resource', {
  args: ['id'],
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
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app, rootDir) =>
      buildSurveyResourceDetail(app, input.id, rootDir)
    ),
  input: detailInputSchema,
  intent: 'read',
  output: resourceDetailOutput,
});

export const surveySignalTrail = trail('survey.signal', {
  args: ['id'],
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
  implementation: async (input, ctx) =>
    withResolvedSurveyApp(input, ctx.cwd, (app, rootDir) =>
      buildSurveySignalDetail(app, input.id, rootDir)
    ),
  input: detailInputSchema,
  intent: 'read',
  output: signalDetailOutput,
});
