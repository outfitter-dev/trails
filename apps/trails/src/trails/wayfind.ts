import { Result, ValidationError, trail } from '@ontrails/core';
import type { Result as TrailResult, TrailContext } from '@ontrails/core';
import {
  wayfinderIncludeSchema,
  wayfinderResolverSchema,
  wayfinderSourceModeSchema,
  wayfinderViewSchema,
} from '@ontrails/topography';
import type {
  WayfinderInclude,
  WayfinderResolver,
  WayfinderView,
} from '@ontrails/topography';
import { z } from 'zod';

const wayfindInputSchema = z
  .object({
    adapter: z
      .string()
      .optional()
      .describe('Filter graph facts delivered through an adapter package'),
    contract: z
      .boolean()
      .default(false)
      .describe('Render the contract view for the selected target'),
    deps: z
      .boolean()
      .default(false)
      .describe('Resolve upstream dependencies for the selected target'),
    depth: z
      .number()
      .int()
      .positive()
      .max(10)
      .default(2)
      .describe('Maximum graph traversal depth for relational views'),
    describe: z
      .boolean()
      .default(false)
      .describe('Render the describe view for the selected target'),
    entities: z.boolean().default(false).describe('Resolve entity facts'),
    errors: z.boolean().default(false).describe('Resolve trail error facts'),
    impact: z
      .boolean()
      .default(false)
      .describe('Resolve downstream impact for the selected target'),
    include: z
      .array(wayfinderIncludeSchema)
      .default([])
      .describe('Attach bounded fact families to the selected result'),
    intent: z
      .enum(['destroy', 'read', 'write'])
      .optional()
      .describe('Filter trails by intent'),
    limit: z.number().int().positive().max(500).default(100),
    map: z
      .boolean()
      .default(false)
      .describe('Render the map view for the selected target'),
    module: z
      .string()
      .optional()
      .describe('Workspace-relative app module for live source reads'),
    outline: z
      .boolean()
      .default(false)
      .describe('Render the outline view for a source file target'),
    overlay: z
      .string()
      .optional()
      .describe(
        'Read a namespaced fact overlay from the saved graph (e.g. --overlay cloudflare)'
      ),
    overview: z
      .boolean()
      .default(false)
      .describe('Render the graph overview view'),
    resources: z.boolean().default(false).describe('Resolve resource facts'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    signals: z.boolean().default(false).describe('Resolve signal facts'),
    source: wayfinderSourceModeSchema
      .default('locked')
      .describe('Graph source to read'),
    surfaces: z.boolean().default(false).describe('Resolve surface facts'),
    target: z
      .string()
      .optional()
      .describe('Graph entity ID or source file path to inspect'),
    trailheads: z
      .boolean()
      .default(false)
      .describe('Resolve surface trailhead facts'),
    trails: z.boolean().default(false).describe('Resolve trail facts'),
    view: wayfinderViewSchema
      .default('list')
      .describe('View to render for the resolved target or population'),
  })
  .strict()
  .refine((input) => !(input.deps && input.impact), {
    message: 'Provide only one relation flag: --deps or --impact.',
    path: ['deps'],
  })
  .refine(
    (input) => !(input.deps || input.impact) || input.target !== undefined,
    {
      message: 'Relation flags require a Wayfinder target.',
      path: ['target'],
    }
  )
  .refine(
    (input) =>
      [
        input.contract,
        input.describe,
        input.map,
        input.outline,
        input.overview,
      ].filter(Boolean).length <= 1,
    {
      message: 'Provide only one view shortcut flag.',
      path: ['view'],
    }
  )
  .refine(
    (input) =>
      ![
        input.contract,
        input.describe,
        input.map,
        input.outline,
        input.overview,
      ].some(Boolean) || input.view === 'list',
    {
      message: 'Use either --view or one view shortcut flag, not both.',
      path: ['view'],
    }
  )
  .refine(
    (input) =>
      input.target === undefined ||
      input.deps ||
      input.impact ||
      (input.adapter === undefined &&
        !input.entities &&
        !input.errors &&
        !input.trailheads &&
        input.intent === undefined &&
        !input.resources &&
        !input.signals &&
        !input.surfaces &&
        !input.trails),
    {
      message:
        'Target lookup cannot be combined with population selector flags. Use --include for bounded fact attachments.',
      path: ['target'],
    }
  )
  .refine(
    (input) =>
      input.include.length === 0 ||
      (input.source !== 'live' && !input.deps && !input.impact),
    {
      message:
        '--include attaches facts to a target or filtered population from locked artifacts; impact/deps and live-source includes are not supported yet.',
      path: ['include'],
    }
  )
  .refine(
    (input) =>
      input.overlay === undefined ||
      (input.target === undefined &&
        !input.deps &&
        !input.impact &&
        input.include.length === 0 &&
        input.adapter === undefined &&
        !input.entities &&
        !input.errors &&
        !input.trailheads &&
        input.intent === undefined &&
        !input.resources &&
        !input.signals &&
        !input.surfaces &&
        !input.trails),
    {
      message:
        'The --overlay flag reads one lock overlay and cannot be combined with targets, population selectors, or includes.',
      path: ['overlay'],
    }
  )
  .refine((input) => input.overlay === undefined || input.source !== 'live', {
    message:
      '--overlay reads namespaced overlays from locked artifacts; live source does not carry lock overlays.',
    path: ['overlay'],
  });

const wayfindComposeInputSchema = z
  .object({
    resolver: wayfinderResolverSchema.optional(),
  })
  .strict();

const wayfindOutputSchema = z.object({
  includes: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown(),
  source: wayfinderSourceModeSchema,
  target: z.string().optional(),
  view: wayfinderViewSchema,
});

type WayfindInput = z.output<typeof wayfindInputSchema> & {
  readonly resolver?: WayfinderResolver | undefined;
};
type TrailContextWithCompose = TrailContext & {
  readonly compose: NonNullable<TrailContext['compose']>;
};

const sourceInput = (
  input: WayfindInput
): { readonly rootDir?: string | undefined } =>
  input.rootDir === undefined ? {} : { rootDir: input.rootDir };

const liveSourceError = (message: string): ValidationError =>
  new ValidationError(message);

const liveModuleInput = (
  input: WayfindInput
): {
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
} => ({
  ...(input.module === undefined ? {} : { module: input.module }),
  ...sourceInput(input),
});

const hasLiveTypedFilter = (input: WayfindInput): boolean =>
  input.adapter !== undefined ||
  input.entities ||
  input.errors ||
  input.trailheads ||
  input.intent !== undefined ||
  input.resources ||
  input.signals ||
  input.surfaces ||
  input.trails;

const populationFilters = (
  input: WayfindInput
): {
  readonly intent?: WayfindInput['intent'];
  readonly kind?:
    | readonly (
        | 'entity'
        | 'trailhead'
        | 'resource'
        | 'signal'
        | 'surface'
        | 'trail'
      )[]
    | 'entity'
    | 'trailhead'
    | 'resource'
    | 'signal'
    | 'surface'
    | 'trail'
    | undefined;
  readonly query?: string | undefined;
  readonly surface?: readonly string[] | string | undefined;
} => {
  const kinds = [
    ...(input.entities ? ['entity' as const] : []),
    ...(input.trailheads ? ['trailhead' as const] : []),
    ...(input.resources ? ['resource' as const] : []),
    ...(input.signals ? ['signal' as const] : []),
    ...(input.surfaces ? ['surface' as const] : []),
    ...(input.trails ? ['trail' as const] : []),
  ];
  return {
    ...(input.intent === undefined ? {} : { intent: input.intent }),
    ...(kinds.length === 0
      ? {}
      : { kind: kinds.length === 1 ? kinds[0] : kinds }),
    ...(input.resolver === 'query' && input.target !== undefined
      ? { query: input.target }
      : {}),
  };
};

const targetLooksLikeFile = (target: string): boolean =>
  target.includes('/') || /\.[cm]?[jt]sx?$/.test(target);

const targetLooksLikePattern = (target: string): boolean =>
  target.includes('*') || target.includes('?');

const targetFilter = (input: WayfindInput) => {
  if (input.target === undefined) {
    return populationFilters(input);
  }
  if (input.resolver === 'pattern') {
    return { idGlob: input.target };
  }
  if (input.resolver === 'query') {
    return { query: input.target };
  }
  return { id: input.target };
};

const includeResultKey = (include: WayfinderInclude): string => include;

const includeInput = (input: WayfindInput) => ({
  filters: targetFilter(input),
  limit: input.limit,
  ...sourceInput(input),
});

const composeInclude = (
  include: WayfinderInclude,
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  switch (include) {
    case 'adapters': {
      return ctx.compose('wayfind.adapters', {
        ...(input.adapter === undefined
          ? {}
          : { filters: { packageName: input.adapter } }),
        limit: input.limit,
        ...sourceInput(input),
      });
    }
    case 'errors': {
      return ctx.compose('wayfind.errors', includeInput(input));
    }
    case 'examples': {
      return ctx.compose('wayfind.examples', includeInput(input));
    }
    case 'surfaces': {
      return ctx.compose('wayfind.surfaces', includeInput(input));
    }
    case 'versions': {
      return ctx.compose('wayfind.versions', includeInput(input));
    }
    default: {
      return Result.err(
        new ValidationError(`Unsupported Wayfinder include: ${include}`)
      );
    }
  }
};

const resolveIncludes = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  if (input.include.length === 0) {
    return Result.ok();
  }
  const includes: Record<string, unknown> = {};
  for (const include of input.include) {
    const result = await composeInclude(include, input, ctx);
    if (result.isErr()) {
      return Result.err(result.error);
    }
    includes[includeResultKey(include)] = result.value;
  }
  return Result.ok(includes);
};

const envelopeFor = async (
  result: Awaited<ReturnType<TrailContextWithCompose['compose']>>,
  input: WayfindInput,
  ctx: TrailContextWithCompose,
  view: WayfinderView
): Promise<TrailResult<z.output<typeof wayfindOutputSchema>, Error>> => {
  if (result.isErr()) {
    return Result.err(result.error);
  }
  const includes = await resolveIncludes(input, ctx);
  if (includes.isErr()) {
    return Result.err(includes.error);
  }
  return Result.ok({
    ...(includes.value === undefined ? {} : { includes: includes.value }),
    result: result.value,
    source: input.source,
    ...(input.target === undefined ? {} : { target: input.target }),
    view,
  });
};

const viewFor = (input: WayfindInput): WayfinderView => {
  if (input.contract) {
    return 'contract';
  }
  if (input.describe) {
    return 'describe';
  }
  if (input.map) {
    return 'map';
  }
  if (input.outline) {
    return 'outline';
  }
  if (input.overview) {
    return 'overview';
  }
  return input.view;
};

const viewLiveSource = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  const view = viewFor(input);
  if (input.deps || input.impact) {
    return {
      result: Result.err(
        liveSourceError(
          '`trails wayfind --source live` supports overview and ID lookup; use locked artifacts for relational graph views.'
        )
      ),
      view,
    };
  }
  if (hasLiveTypedFilter(input)) {
    return {
      result: Result.err(
        liveSourceError(
          '`trails wayfind --source live` supports overview and ID lookup; use locked artifacts for typed filters.'
        )
      ),
      view,
    };
  }
  if (input.target !== undefined && targetLooksLikeFile(input.target)) {
    return {
      result: Result.err(
        liveSourceError(
          '`trails wayfind --source live` does not support source file targets; use locked artifacts for file outlines.'
        )
      ),
      view,
    };
  }
  if (view === 'contract' || view === 'map' || view === 'outline') {
    return {
      result: Result.err(
        liveSourceError(
          '`trails wayfind --source live` supports overview and ID lookup; use locked artifacts for this view.'
        )
      ),
      view,
    };
  }
  return {
    result: ctx.compose('survey', {
      ...(input.target === undefined ? {} : { id: input.target }),
      ...liveModuleInput(input),
    }),
    view:
      input.target === undefined
        ? ('overview' as const)
        : ('describe' as const),
  };
};

const viewRelation = (input: WayfindInput, ctx: TrailContextWithCompose) => {
  if (input.target === undefined || !(input.deps || input.impact)) {
    return Promise.resolve();
  }
  if (
    targetLooksLikeFile(input.target) ||
    targetLooksLikePattern(input.target)
  ) {
    return {
      result: Result.err(
        new ValidationError('Relation flags require a graph entity target.')
      ),
      view: 'map' as const,
    };
  }
  return {
    result: ctx.compose('wayfind.impact', {
      direction: input.deps ? 'upstream' : 'downstream',
      filters: populationFilters(input),
      id: input.target,
      limit: input.limit,
      maxDepth: input.depth,
      ...sourceInput(input),
    }),
    view: 'map' as const,
  };
};

const explicitGlobError = (view: WayfinderView) => ({
  result: Result.err(
    new ValidationError(
      'Glob patterns require `trails wayfind pattern <glob>` so the selector is explicit.'
    )
  ),
  view,
});

const viewSelectorTarget = (
  input: WayfindInput,
  ctx: TrailContextWithCompose,
  resolver: WayfinderResolver,
  view: WayfinderView
) => {
  const { target } = input;
  if (target === undefined) {
    return null;
  }
  if (
    resolver !== 'file' &&
    resolver !== 'pattern' &&
    targetLooksLikePattern(target)
  ) {
    return explicitGlobError(view);
  }
  if (resolver === 'pattern') {
    return {
      result: ctx.compose('wayfind.search', {
        filters: { idGlob: target, ...populationFilters(input) },
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (resolver === 'query') {
    return {
      result: ctx.compose('wayfind.search', {
        filters: { query: target, ...populationFilters(input) },
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (resolver === 'file' && !targetLooksLikeFile(target)) {
    return {
      result: Result.err(
        new ValidationError(
          '`trails wayfind file` requires a source file path target.'
        )
      ),
      view: 'outline' as const,
    };
  }
  if (resolver === 'file') {
    return {
      result: ctx.compose('wayfind.outline', {
        all: false,
        contracts: false,
        file: target,
        review: false,
        source: false,
        ...sourceInput(input),
        surfaces: false,
      }),
      view: 'outline' as const,
    };
  }
  return null;
};

const viewTarget = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  const { target } = input;
  if (target === undefined) {
    return;
  }
  const view = viewFor(input);
  if (input.resolver === undefined && targetLooksLikePattern(target)) {
    return explicitGlobError(view);
  }
  const resolver =
    input.resolver ?? (targetLooksLikeFile(target) ? 'file' : 'id');
  const selectorView = viewSelectorTarget(input, ctx, resolver, view);
  if (selectorView !== null) {
    return selectorView;
  }
  if (resolver !== 'file' && view === 'outline') {
    return {
      result: Result.err(
        new ValidationError(
          'The outline view requires a source file path target. Use `trails wayfind file <file> --view outline` or pass a file-like target.'
        )
      ),
      view: 'outline' as const,
    };
  }
  if (view === 'overview') {
    return {
      result: Result.err(
        new ValidationError('The overview view does not accept a target.')
      ),
      view,
    };
  }
  if (view === 'contract') {
    return {
      result: ctx.compose('wayfind.contract', {
        id: target,
        ...sourceInput(input),
      }),
      view: 'contract' as const,
    };
  }
  if (view === 'describe' || view === 'summary') {
    return {
      result: ctx.compose('wayfind.describe', {
        id: target,
        ...sourceInput(input),
      }),
      view,
    };
  }
  if (view === 'map') {
    return {
      result: ctx.compose('wayfind.impact', {
        direction: 'both',
        filters: populationFilters(input),
        id: target,
        limit: input.limit,
        maxDepth: 1,
        ...sourceInput(input),
      }),
      view: 'map' as const,
    };
  }
  return {
    result: ctx.compose('wayfind.nearby', {
      id: target,
      ...sourceInput(input),
    }),
    view: 'summary' as const,
  };
};

const adapterSurfaceTargets = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
): Promise<TrailResult<readonly string[], Error>> => {
  if (input.adapter === undefined) {
    return Result.ok([]);
  }
  const facts = await ctx.compose('wayfind.adapters', {
    filters: { packageName: input.adapter },
    limit: input.limit,
    ...sourceInput(input),
  });
  if (facts.isErr()) {
    return facts;
  }
  const { adapters } = facts.value as { adapters?: unknown };
  if (!Array.isArray(adapters)) {
    return Result.ok([]);
  }
  return Result.ok(
    [
      ...new Set(
        adapters
          .map((fact) =>
            typeof fact === 'object' && fact !== null
              ? (fact as { target?: unknown }).target
              : undefined
          )
          .filter((target): target is string => typeof target === 'string')
      ),
    ].toSorted()
  );
};

const populationFiltersWithAdapter = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
): Promise<TrailResult<ReturnType<typeof populationFilters>, Error>> => {
  const filters = populationFilters(input);
  const adapterTargets = await adapterSurfaceTargets(input, ctx);
  if (adapterTargets.isErr()) {
    return adapterTargets;
  }
  if (adapterTargets.value.length === 0) {
    return Result.ok(
      input.adapter === undefined
        ? filters
        : { ...filters, surface: '__no_adapter_target__' }
    );
  }
  return Result.ok({ ...filters, surface: adapterTargets.value });
};

const viewPopulation = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  const filtersResult = await populationFiltersWithAdapter(input, ctx);
  if (filtersResult.isErr()) {
    return { result: filtersResult, view: 'list' as const };
  }
  const filters = filtersResult.value;
  const view = viewFor(input);
  if (view === 'overview') {
    return {
      result: ctx.compose('wayfind.overview', sourceInput(input)),
      view: 'overview' as const,
    };
  }
  if (input.resources) {
    return {
      result: ctx.compose('wayfind.resources', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.entities) {
    return {
      result: ctx.compose('wayfind.entities', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.signals) {
    return {
      result: ctx.compose('wayfind.signals', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.surfaces) {
    return {
      result: ctx.compose('wayfind.surfaces', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.trailheads) {
    return {
      result: ctx.compose('wayfind.trailheads', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.errors) {
    return {
      result: ctx.compose('wayfind.errors', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.trails || input.intent !== undefined) {
    return {
      result: ctx.compose('wayfind.trails', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  return {
    result: ctx.compose('wayfind.search', {
      filters,
      limit: input.limit,
      ...sourceInput(input),
    }),
    view: 'list' as const,
  };
};

export const wayfindTrail = trail('wayfind.navigate', {
  args: ['target'],
  cli: {
    path: 'wayfind',
  },
  composeInput: wayfindComposeInputSchema,
  composes: [
    'survey',
    'wayfind.adapters',
    'wayfind.contract',
    'wayfind.entities',
    'wayfind.describe',
    'wayfind.errors',
    'wayfind.examples',
    'wayfind.overlay',
    'wayfind.trailheads',
    'wayfind.impact',
    'wayfind.nearby',
    'wayfind.outline',
    'wayfind.overview',
    'wayfind.resources',
    'wayfind.search',
    'wayfind.signals',
    'wayfind.surfaces',
    'wayfind.trails',
    'wayfind.versions',
  ],
  description: 'Navigate Trails graph facts by target, filters, and view',
  examples: [
    {
      input: {},
      name: 'List graph entries',
    },
    {
      input: { contract: true, target: 'wayfind.search' },
      name: 'Inspect a trail contract',
    },
    {
      input: { target: 'wayfind.search' },
      name: 'Inspect nearby graph context',
    },
    {
      input: { map: true, target: 'wayfind.search' },
      name: 'Map nearby graph context',
    },
    {
      input: { target: 'apps/trails/src/trails/wayfind.ts' },
      name: 'Outline a source file',
    },
    {
      input: { resources: true },
      name: 'List resource facts',
    },
    {
      input: { entities: true },
      name: 'List entity facts',
    },
    {
      input: { signals: true },
      name: 'List signal facts',
    },
    {
      input: { surfaces: true },
      name: 'List surface facts',
    },
    {
      input: { trailheads: true },
      name: 'List trailhead facts',
    },
    {
      input: { overview: true },
      name: 'Show graph overview',
    },
    {
      input: { overlay: 'cloudflare' },
      name: 'Read a namespaced lock overlay',
    },
    {
      input: { include: ['examples'], target: 'wayfind.search' },
      name: 'Attach examples for a target',
    },
    {
      input: { include: ['versions'], target: 'wayfind.search' },
      name: 'Attach version facts for a target',
    },
    {
      input: { source: 'live', target: 'wayfind.search' },
      name: 'Inspect a live app entity',
    },
    {
      input: { impact: true, target: 'db.main' },
      name: 'Trace downstream graph impact',
    },
    {
      input: { deps: true, target: 'wayfind.search' },
      name: 'Inspect upstream dependencies',
    },
    {
      input: { intent: 'read', trails: true },
      name: 'List read trails',
    },
  ],
  implementation: async (input, ctx) => {
    if (input.source === 'live') {
      const dispatched = await viewLiveSource(input, ctx);
      if (dispatched !== undefined) {
        return envelopeFor(
          await dispatched.result,
          input,
          ctx,
          dispatched.view
        );
      }
    }
    if (input.overlay !== undefined) {
      return envelopeFor(
        await ctx.compose('wayfind.overlay', {
          namespace: input.overlay,
          ...sourceInput(input),
        }),
        input,
        ctx,
        'list'
      );
    }
    const dispatched =
      (await viewRelation(input, ctx)) ??
      (await (input.target === undefined
        ? viewPopulation(input, ctx)
        : viewTarget(input, ctx)));
    if (dispatched === undefined) {
      return Result.err(
        new ValidationError('Provide a Wayfinder target or population filter.')
      );
    }
    return envelopeFor(await dispatched.result, input, ctx, dispatched.view);
  },
  input: wayfindInputSchema,
  intent: 'read',
  output: wayfindOutputSchema,
  visibility: 'public',
});

const wayfindSelectorBaseInputSchema = (selectorDescription: string) =>
  z
    .object({
      limit: z.number().int().positive().max(500).default(100),
      rootDir: z.string().optional().describe('Workspace root directory'),
      selector: z.string().min(1).describe(selectorDescription),
    })
    .strict();

const wayfindPatternInputSchema = wayfindSelectorBaseInputSchema(
  'Wayfinder ID glob pattern'
);
const wayfindQueryInputSchema = wayfindSelectorBaseInputSchema(
  'Wayfinder indexed text query'
);
const wayfindFileInputSchema = wayfindSelectorBaseInputSchema(
  'Wayfinder source file path'
).extend({
  outline: z
    .boolean()
    .default(false)
    .describe('Render the outline view for a source file target'),
});

const selectorSourceInput = (
  input: Readonly<{ rootDir?: string | undefined }>
): { readonly rootDir?: string | undefined } =>
  input.rootDir === undefined ? {} : { rootDir: input.rootDir };

export const wayfindPatternTrail = trail('wayfind.pattern', {
  args: ['selector'],
  cli: {
    path: 'wayfind pattern',
  },
  composes: ['wayfind.navigate'],
  description: 'Find Wayfinder graph facts by explicit ID glob pattern',
  examples: [
    {
      input: { selector: 'wayfind.*' },
      name: 'Find Wayfinder trails',
    },
  ],
  implementation: (input, ctx) =>
    ctx.compose('wayfind.navigate', {
      limit: input.limit,
      resolver: 'pattern',
      target: input.selector,
      view: 'list',
      ...selectorSourceInput(input),
    }),
  input: wayfindPatternInputSchema,
  intent: 'read',
  meta: {
    internal: true,
  },
  output: wayfindOutputSchema,
  visibility: 'internal',
});

export const wayfindQueryTrail = trail('wayfind.query', {
  args: ['selector'],
  cli: {
    path: 'wayfind query',
  },
  composes: ['wayfind.navigate'],
  description: 'Find Wayfinder graph facts by explicit text query',
  examples: [
    {
      input: { selector: 'release drift' },
      name: 'Find release drift facts',
    },
  ],
  implementation: (input, ctx) =>
    ctx.compose('wayfind.navigate', {
      limit: input.limit,
      resolver: 'query',
      target: input.selector,
      view: 'list',
      ...selectorSourceInput(input),
    }),
  input: wayfindQueryInputSchema,
  intent: 'read',
  meta: {
    internal: true,
  },
  output: wayfindOutputSchema,
  visibility: 'internal',
});

export const wayfindFileTrail = trail('wayfind.file', {
  args: ['selector'],
  cli: {
    path: 'wayfind file',
  },
  composes: ['wayfind.navigate'],
  description: 'Outline one source file through Wayfinder',
  examples: [
    {
      input: { selector: 'apps/trails/src/app.ts' },
      name: 'Outline the Trails app module',
    },
  ],
  implementation: (input, ctx) =>
    ctx.compose('wayfind.navigate', {
      limit: input.limit,
      outline: input.outline,
      resolver: 'file',
      target: input.selector,
      view: 'outline',
      ...selectorSourceInput(input),
    }),
  input: wayfindFileInputSchema,
  intent: 'read',
  meta: {
    internal: true,
  },
  output: wayfindOutputSchema,
  visibility: 'internal',
});
